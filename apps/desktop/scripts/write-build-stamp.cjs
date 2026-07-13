"use strict"

/**
 * Writes apps/desktop/build/install-stamp.json with the git ref the desktop
 * .exe should pin to at first-launch bootstrap time.  This file ships inside
 * the packaged app via electron-builder's extraResources entry and is read
 * by electron/main.cjs to drive the install.ps1 stage bootstrap flow.
 *
 * Schema (subject to bump via STAMP_SCHEMA_VERSION):
 *   {
 *     "schemaVersion": 1,
 *     "commit":        "<40-char SHA>",
 *     "branch":        "<branch name>",
 *     "builtAt":       "<ISO 8601 UTC timestamp>",
 *     "dirty":         true|false,
 *     "source":        "ci" | "local",
 *     "updateManifestUrl": "<COS manifest URL>" | null
 *   }
 *
 * Source preference order:
 *   1. CI env vars ($GITHUB_SHA / $GITHUB_REF_NAME) -- avoid edge cases with
 *      shallow clones, detached HEADs, etc. in CI.
 *   2. Local `git rev-parse` against the parent repo (../..).
 *
 * Dev / out-of-repo builds without git produce an explicit error rather than
 * silently writing an unstamped manifest -- the packaged app refuses to
 * bootstrap without a stamp.
 */

const fs = require("fs")
const path = require("path")
const { execSync } = require("child_process")

const STAMP_SCHEMA_VERSION = 1

const DESKTOP_ROOT = path.resolve(__dirname, "..")
const REPO_ROOT = path.resolve(DESKTOP_ROOT, "..", "..")
const OUT_DIR = path.join(DESKTOP_ROOT, "build")
const OUT_FILE = path.join(OUT_DIR, "install-stamp.json")

function tryExec(cmd, opts) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts }).trim()
  } catch {
    return null
  }
}

// Explicit override: pin first-launch bootstrap to a specific upstream ref
// regardless of which repo/commit this desktop shell was built from. Used by
// the Torch desktop packaging workflow so a white-label build (built from a
// private fork) still installs the public upstream Hermes runtime at a real,
// fetchable commit. Highest precedence.
function fromOverride() {
  const commit = String(process.env.TORCH_RUNTIME_COMMIT || "").trim()
  if (!commit) return null
  const branch = String(process.env.TORCH_RUNTIME_BRANCH || "").trim() || null
  return {
    commit: commit,
    branch: branch,
    dirty: false,
    source: "override"
  }
}

function fromCI() {
  const sha = process.env.GITHUB_SHA
  if (!sha) return null
  const branch = process.env.GITHUB_REF_NAME || process.env.GITHUB_HEAD_REF || null
  return {
    commit: sha,
    branch: branch,
    dirty: false, // CI builds from a checkout-of-ref by definition
    source: "ci"
  }
}

function fromLocalGit() {
  const sha = tryExec("git rev-parse HEAD", { cwd: REPO_ROOT })
  if (!sha) return null
  const branch = tryExec("git rev-parse --abbrev-ref HEAD", { cwd: REPO_ROOT })
  // `git status --porcelain -uno` is empty iff tracked files match HEAD.
  // We exclude untracked files (-uno) intentionally: a developer who's
  // checked out an installer scratch dir alongside the repo shouldn't
  // poison every local build with a [DIRTY] stamp.  We DO care about
  // tracked-but-modified files because those mean the .exe content
  // differs from the commit being pinned.
  const status = tryExec("git status --porcelain -uno", { cwd: REPO_ROOT })
  const dirty = status !== null && status.length > 0
  return {
    commit: sha,
    branch: branch === "HEAD" ? null : branch, // detached HEAD -> null
    dirty: dirty,
    source: "local"
  }
}

// Mirror .github/scripts/torch_publish_cos.py::_base_url so the baked manifest
// URL points at exactly where the publish step uploads manifest.json.
function cosManifestUrl() {
  let base = String(process.env.COS_BASE_URL || "").trim().replace(/\/+$/, "")
  if (!base) {
    const bucket = String(process.env.COS_BUCKET || "").trim()
    const region = String(process.env.COS_REGION || "").trim()
    if (bucket && region) {
      base = `https://${bucket}.cos.${region}.myqcloud.com`
    }
  }
  return base ? base + "/clients/latest/manifest.json" : null
}

function main() {
  const stamp = fromOverride() || fromCI() || fromLocalGit()
  if (!stamp || !stamp.commit) {
    console.error(
      "[write-build-stamp] ERROR: could not determine git commit.\n" +
        "  - $GITHUB_SHA not set\n" +
        "  - `git rev-parse HEAD` failed at " +
        REPO_ROOT +
        "\n" +
        "Packaged builds require a git ref to pin first-launch install.ps1\n" +
        "against. Run from a git checkout or set $GITHUB_SHA explicitly."
    )
    process.exit(1)
  }

  if (stamp.dirty) {
    console.warn(
      "[write-build-stamp] WARNING: working tree is dirty.\n" +
        "  Pinning to " +
        stamp.commit.slice(0, 12) +
        " but the packaged code may differ from that commit.\n" +
        "  Commit your changes before publishing this build."
    )
  }

  // Optional: the URL of the download manifest published to COS. Baked here so
  // the packaged app can check for a newer INSTALLER (the Electron shell, which
  // can't self-update via git like the kernel does). This MUST resolve to the
  // same base torch_publish_cos.py uploads to (_base_url): $COS_BASE_URL if
  // set, else the default bucket URL from $COS_BUCKET/$COS_REGION. A local/dev
  // build with none of these set leaves it null and the check no-ops.
  const updateManifestUrl = cosManifestUrl()

  const payload = {
    schemaVersion: STAMP_SCHEMA_VERSION,
    commit: stamp.commit,
    branch: stamp.branch,
    builtAt: new Date().toISOString(),
    dirty: stamp.dirty,
    source: stamp.source,
    updateManifestUrl: updateManifestUrl
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8")
  console.log(
    "[write-build-stamp] wrote " +
      path.relative(REPO_ROOT, OUT_FILE) +
      " -> " +
      stamp.commit.slice(0, 12) +
      (stamp.branch ? " (" + stamp.branch + ")" : "") +
      (stamp.dirty ? " [DIRTY]" : "")
  )
}

main()
