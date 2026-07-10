'use strict'

/**
 * bootstrap-runner.cjs
 *
 * Drives apps/desktop's first-launch install of Hermes Agent by spawning
 * scripts/install.ps1 stage-by-stage and streaming progress events back to
 * the renderer.
 *
 * Wired from electron/main.cjs:
 *   const { runBootstrap } = require('./bootstrap-runner.cjs')
 *   const result = await runBootstrap({
 *     installStamp,        // INSTALL_STAMP from main.cjs (may be null in dev)
 *     activeRoot,          // ACTIVE_HERMES_ROOT
 *     sourceRepoRoot,      // SOURCE_REPO_ROOT (for dev install.ps1 lookup)
 *     hermesHome,          // HERMES_HOME
 *     logRoot,             // HERMES_HOME/logs
 *     emit: ev => {...}    // event sink (sender.send or similar)
 *   })
 *
 * Emits events with shape:
 *   { type: 'manifest',  stages: [{name, title, category, needs_user_input}, ...] }
 *   { type: 'stage',     name, state: 'running'|'succeeded'|'skipped'|'failed',
 *                        json?, durationMs?, error? }
 *   { type: 'log',       stage?, line, stream: 'stdout'|'stderr' } // raw line from install.ps1
 *   { type: 'complete',  marker: <written marker payload> }
 *   { type: 'failed',    stage?, error }     // bootstrap aborted
 *
 * Resolves with the same shape as the final 'complete' or 'failed' event so
 * callers can await either way.
 *
 * NOT implemented yet (deferred to Phase 1E / 1F):
 *   - User-facing retry / cancel from the renderer (event channels exist;
 *     no UI consumes them yet)
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const https = require('node:https')
const { spawn } = require('node:child_process')

const IS_WINDOWS = process.platform === 'win32'

// 运行内核的国内镜像(Gitee)。首启从 GitHub 下东西在国内会被重置/限速,这里
// 统一指向 Gitee 镜像:①从 Gitee raw 下 install 脚本 ②git clone 内核换源到 Gitee。
const RUNTIME_MIRROR_OWNER_REPO = 'Gitsongsong/hermes-agent'
const RUNTIME_MIRROR_GIT = `https://gitee.com/${RUNTIME_MIRROR_OWNER_REPO}.git`
const RUNTIME_UPSTREAM_HTTPS = 'https://github.com/NousResearch/hermes-agent.git'
const RUNTIME_UPSTREAM_SSH = 'git@github.com:NousResearch/hermes-agent.git'

// 国内镜像加速:首启时 install.ps1/sh 用 uv/pip 装 Python 依赖、npm 装 node 依赖、
// uv 下 Python 解释器、git clone 运行内核,默认全走境外源,在国内慢/被重置。这里
// 把各工具认的标准环境变量指向国内可达镜像。只在用户没自己设过时才注入(海外/CI
// 可覆盖)。清华/npmmirror 是全量镜像,sha256 与上游一致,uv sync --locked 照样过。
function chinaMirrorEnv() {
  const out = {}
  // GitHub 大文件(uv/python 等)统一走的加速前缀;可用 TORCH_GH_PROXY 覆盖。
  const ghProxy = (process.env.TORCH_GH_PROXY || 'https://gh-proxy.com').replace(/\/+$/, '')
  const simple = {
    UV_INDEX_URL: 'https://pypi.tuna.tsinghua.edu.cn/simple',
    PIP_INDEX_URL: 'https://pypi.tuna.tsinghua.edu.cn/simple',
    PIP_TRUSTED_HOST: 'pypi.tuna.tsinghua.edu.cn',
    npm_config_registry: 'https://registry.npmmirror.com',
    // Electron 二进制 + electron-builder 工具(nsis/winCodeSign 等)走 npmmirror。
    ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/',
    ELECTRON_BUILDER_BINARIES_MIRROR: 'https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
    // Playwright 浏览器内核走 npmmirror。
    PLAYWRIGHT_DOWNLOAD_HOST: 'https://cdn.npmmirror.com/binaries/playwright'
  }
  for (const [k, v] of Object.entries(simple)) {
    if (!process.env[k]) out[k] = v
  }
  // uv 二进制:astral 独立安装器(irm astral.sh/uv/install.ps1)默认从 github releases
  // 下 uv 本体,国内被重置/慢。改走 GitHub 加速前缀。
  if (!process.env.UV_INSTALLER_GITHUB_BASE_URL) {
    out.UV_INSTALLER_GITHUB_BASE_URL = `${ghProxy}/https://github.com`
  }
  // Python 解释器:uv 从 github 的 python-build-standalone 下。走加速;可用
  // TORCH_UV_PYTHON_MIRROR 覆盖成你自己 COS 上的镜像。
  if (!process.env.UV_PYTHON_INSTALL_MIRROR) {
    out.UV_PYTHON_INSTALL_MIRROR =
      process.env.TORCH_UV_PYTHON_MIRROR ||
      `${ghProxy}/https://github.com/astral-sh/python-build-standalone/releases/download`
  }
  // 运行内核 clone 换源:git 的 insteadOf 把上游 github 仓库地址改写成 Gitee 镜像,
  // install 脚本里 clone/fetch origin 会自动走 Gitee。用 GIT_CONFIG_* 注入,不改全局配置。
  if (!process.env.GIT_CONFIG_COUNT) {
    out.GIT_CONFIG_COUNT = '2'
    out.GIT_CONFIG_KEY_0 = `url.${RUNTIME_MIRROR_GIT}.insteadOf`
    out.GIT_CONFIG_VALUE_0 = RUNTIME_UPSTREAM_HTTPS
    out.GIT_CONFIG_KEY_1 = `url.${RUNTIME_MIRROR_GIT}.insteadOf`
    out.GIT_CONFIG_VALUE_1 = RUNTIME_UPSTREAM_SSH
  }
  return out
}

function hiddenWindowsChildOptions(options = {}) {
  if (!IS_WINDOWS || Object.prototype.hasOwnProperty.call(options, 'windowsHide')) {
    return options
  }
  return { ...options, windowsHide: true }
}

const STAMP_COMMIT_RE = /^[0-9a-f]{7,40}$/i

// Stages flagged needs_user_input=true in the manifest are skipped by the
// runner (passed -NonInteractive to install.ps1, which the install script
// itself handles by emitting skipped=true frames). The renderer / 1E onboarding
// overlay takes over for those concerns (API keys, model, persona, gateway).
// We let install.ps1's own -NonInteractive logic drive this rather than
// filtering client-side -- single source of truth.

// ---------------------------------------------------------------------------
// install.ps1 source resolution
// ---------------------------------------------------------------------------

function installScriptName() {
  return process.platform === 'win32' ? 'install.ps1' : 'install.sh'
}

function installScriptKind() {
  return process.platform === 'win32' ? 'powershell' : 'posix'
}

function resolveLocalInstallScript(sourceRepoRoot) {
  if (!sourceRepoRoot) return null
  const candidate = path.join(sourceRepoRoot, 'scripts', installScriptName())
  try {
    fs.accessSync(candidate, fs.constants.R_OK)
    return candidate
  } catch {
    return null
  }
}

function bootstrapCacheDir(hermesHome) {
  return path.join(hermesHome, 'bootstrap-cache')
}

// The install.sh / install.ps1 that ships inside the already-installed agent
// checkout under ~/.hermes/hermes-agent. Used as a last-resort fallback when
// the pinned commit can't be fetched from GitHub (e.g. a locally-built desktop
// app stamped to an unpushed HEAD).
function installedAgentInstallScript(hermesHome) {
  if (!hermesHome) return null
  const candidate = path.join(hermesHome, 'hermes-agent', 'scripts', installScriptName())
  try {
    fs.accessSync(candidate, fs.constants.R_OK)
    return candidate
  } catch {
    return null
  }
}

function cachedScriptPath(hermesHome, commit) {
  return path.join(bootstrapCacheDir(hermesHome), `install-${commit}.${process.platform === 'win32' ? 'ps1' : 'sh'}`)
}

// Download a URL to destPath, following redirects (Gitee raw 302-redirects to
// raw.giteeusercontent.com with a signed URL, so multi-hop is required).
function httpDownload(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    const tmpPath = destPath + '.tmp'
    https
      .get(url, res => {
        const code = res.statusCode
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume()
          if (redirectsLeft <= 0) {
            reject(new Error(`too many redirects for ${url}`))
            return
          }
          const next = new URL(res.headers.location, url).toString()
          httpDownload(next, destPath, redirectsLeft - 1).then(resolve, reject)
          return
        }
        if (code !== 200) {
          res.resume()
          reject(new Error(`HTTP ${code} from ${url}`))
          return
        }
        const out = fs.createWriteStream(tmpPath)
        res.pipe(out)
        out.on('finish', () => {
          out.close(() => {
            try {
              fs.renameSync(tmpPath, destPath)
              resolve(destPath)
            } catch (err) {
              reject(err)
            }
          })
        })
        out.on('error', err => {
          try {
            fs.unlinkSync(tmpPath)
          } catch {
            void 0
          }
          reject(err)
        })
      })
      .on('error', err => {
        try {
          fs.unlinkSync(tmpPath)
        } catch {
          void 0
        }
        reject(err)
      })
  })
}

async function downloadInstallScript(commit, destPath) {
  // Fetch the install script at the pinned commit. The raw URL with a SHA is
  // immutable, so no integrity check beyond the caller's syntax probe.
  // Gitee mirror first (国内可达), GitHub raw as fallback (海外/镜像未同步时).
  const scriptName = installScriptName()
  const candidates = [
    `https://gitee.com/${RUNTIME_MIRROR_OWNER_REPO}/raw/${commit}/scripts/${scriptName}`,
    `https://raw.githubusercontent.com/NousResearch/hermes-agent/${commit}/scripts/${scriptName}`
  ]
  let lastErr
  for (const url of candidates) {
    try {
      return await httpDownload(url, destPath)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error(`Failed to download ${scriptName}`)
}

async function resolveInstallScript({
  installStamp,
  sourceRepoRoot,
  hermesHome,
  emit,
  _download = downloadInstallScript
}) {
  // 1. Dev shortcut: prefer a local checkout's installer so we can iterate
  //    without pushing. SOURCE_REPO_ROOT comes from main.cjs (path.resolve
  //    of APP_ROOT/../..).
  const localScript = resolveLocalInstallScript(sourceRepoRoot)
  if (localScript) {
    emit({ type: 'log', line: `[bootstrap] using local ${installScriptName()} at ${localScript}` })
    return { path: localScript, source: 'local', kind: installScriptKind() }
  }

  // 2. Packaged path: download from GitHub at the pinned commit (1B's stamp).
  if (!installStamp || !installStamp.commit || !STAMP_COMMIT_RE.test(installStamp.commit)) {
    throw new Error(
      `Cannot resolve ${installScriptName()}: no SOURCE_REPO_ROOT and no install stamp. ` +
        'This packaged build was produced without a valid build-time stamp.'
    )
  }

  const cached = cachedScriptPath(hermesHome, installStamp.commit)
  try {
    await fsp.access(cached, fs.constants.R_OK)
    emit({
      type: 'log',
      line: `[bootstrap] using cached ${installScriptName()} for ${installStamp.commit.slice(0, 12)}`
    })
    return { path: cached, source: 'cache', commit: installStamp.commit, kind: installScriptKind() }
  } catch {
    // not cached; download
  }

  emit({
    type: 'log',
    line: `[bootstrap] fetching ${installScriptName()} for ${installStamp.commit.slice(0, 12)} from GitHub`
  })
  try {
    await _download(installStamp.commit, cached)
    emit({ type: 'log', line: `[bootstrap] saved to ${cached}` })
    return { path: cached, source: 'download', commit: installStamp.commit, kind: installScriptKind() }
  } catch (err) {
    // The pinned commit may not be fetchable from GitHub -- most commonly a
    // locally-built desktop app stamped to an unpushed HEAD (see
    // write-build-stamp.cjs fromLocalGit). Fall back to the installer that
    // ships inside the already-installed agent checkout so dev/self-builds can
    // still bootstrap instead of dying with a fatal 404.
    const installed = installedAgentInstallScript(hermesHome)
    if (installed) {
      emit({
        type: 'log',
        line:
          `[bootstrap] GitHub fetch failed (${err.message}); ` +
          `falling back to installed agent ${installScriptName()} at ${installed}`
      })
      try {
        fs.mkdirSync(path.dirname(cached), { recursive: true })
        fs.copyFileSync(installed, cached)
        return { path: cached, source: 'installed-agent', commit: installStamp.commit, kind: installScriptKind() }
      } catch {
        // Cache copy failed (read-only FS, etc.) -- use the source path directly.
        return { path: installed, source: 'installed-agent', commit: installStamp.commit, kind: installScriptKind() }
      }
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// powershell wrapper
// ---------------------------------------------------------------------------

// Canonical PowerShell 5.1 location under a Windows root (%SystemRoot%).
function powershellUnderRoot(root) {
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

// Resolve the PowerShell interpreter to spawn.
//
// Spawning bare 'powershell.exe' trusts PATH to contain
// %SystemRoot%\System32\WindowsPowerShell\v1.0. On machines whose PATH was
// trimmed, truncated, or stored as a non-expanding REG_SZ (so %SystemRoot%
// never expands), that lookup fails and the spawn dies with ENOENT before
// install.ps1 ever runs — the installer stalls at "0 of 0 steps". Resolve by
// absolute path first, then fall back to PATH (powershell 5.1, then pwsh 7),
// then a bare name as a last resort.
function resolveWindowsPowerShell() {
  for (const v of ['SystemRoot', 'windir']) {
    const root = process.env[v]
    if (root) {
      const candidate = powershellUnderRoot(root)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        void 0
      }
    }
  }
  const pathDirs = (process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean)
  for (const exe of ['powershell.exe', 'pwsh.exe']) {
    for (const dir of pathDirs) {
      const candidate = path.join(dir, exe)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        void 0
      }
    }
  }
  return 'powershell.exe'
}

function spawnPowerShell(scriptPath, args, { emit, stageName, abortSignal, hermesHome } = {}) {
  return new Promise((resolve, reject) => {
    const ps = process.platform === 'win32' ? resolveWindowsPowerShell() : 'pwsh'
    const fullArgs = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...args]

    const child = spawn(
      ps,
      fullArgs,
      hiddenWindowsChildOptions({
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...chinaMirrorEnv(),
          // Pass HERMES_HOME through so install.ps1 respects the caller's
          // choice rather than re-computing the default.
          HERMES_HOME: hermesHome || process.env.HERMES_HOME || ''
        }
      })
    )

    let stdout = ''
    let stderr = ''
    let killed = false

    const onAbort = () => {
      killed = true
      try {
        child.kill('SIGTERM')
      } catch {
        void 0
      }
    }
    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort()
      } else {
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    // Stream stdout line-by-line so the renderer sees progress in real time.
    let stdoutBuf = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      stdoutBuf += chunk
      let nl
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).replace(/\r$/, '')
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (line) emit && emit({ type: 'log', stage: stageName, line, stream: 'stdout' })
      }
    })

    let stderrBuf = ''
    child.stderr.on('data', chunk => {
      stderr += chunk
      stderrBuf += chunk
      let nl
      while ((nl = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, nl).replace(/\r$/, '')
        stderrBuf = stderrBuf.slice(nl + 1)
        if (line) emit && emit({ type: 'log', stage: stageName, line, stream: 'stderr' })
      }
    })

    child.on('error', err => {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort)
      reject(err)
    })

    child.on('close', (code, signal) => {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort)
      // Flush any trailing bytes
      if (stdoutBuf) emit && emit({ type: 'log', stage: stageName, line: stdoutBuf, stream: 'stdout' })
      if (stderrBuf) emit && emit({ type: 'log', stage: stageName, line: stderrBuf, stream: 'stderr' })
      resolve({ stdout, stderr, code, signal, killed })
    })
  })
}

function spawnBash(scriptPath, args, { emit, stageName, abortSignal, hermesHome } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...chinaMirrorEnv(),
        HERMES_HOME: hermesHome || process.env.HERMES_HOME || ''
      }
    })

    let stdout = ''
    let stderr = ''
    let killed = false

    const onAbort = () => {
      killed = true
      try {
        child.kill('SIGTERM')
      } catch {
        void 0
      }
    }
    if (abortSignal) {
      if (abortSignal.aborted) {
        onAbort()
      } else {
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    let stdoutBuf = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      stdoutBuf += chunk
      let nl
      while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, nl).replace(/\r$/, '')
        stdoutBuf = stdoutBuf.slice(nl + 1)
        if (line) emit && emit({ type: 'log', stage: stageName, line, stream: 'stdout' })
      }
    })

    let stderrBuf = ''
    child.stderr.on('data', chunk => {
      stderr += chunk
      stderrBuf += chunk
      let nl
      while ((nl = stderrBuf.indexOf('\n')) !== -1) {
        const line = stderrBuf.slice(0, nl).replace(/\r$/, '')
        stderrBuf = stderrBuf.slice(nl + 1)
        if (line) emit && emit({ type: 'log', stage: stageName, line, stream: 'stderr' })
      }
    })

    child.on('error', err => {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort)
      reject(err)
    })

    child.on('close', (code, signal) => {
      if (abortSignal) abortSignal.removeEventListener('abort', onAbort)
      if (stdoutBuf) emit && emit({ type: 'log', stage: stageName, line: stdoutBuf, stream: 'stdout' })
      if (stderrBuf) emit && emit({ type: 'log', stage: stageName, line: stderrBuf, stream: 'stderr' })
      resolve({ stdout, stderr, code, signal, killed })
    })
  })
}

// ---------------------------------------------------------------------------
// Manifest + stage dispatch
// ---------------------------------------------------------------------------

// Build the install.ps1 pin args (-Commit / -Branch) from the install-stamp
// so the repository stage clones the exact SHA the .exe was tested with
// instead of falling back to install.ps1's default ($Branch = "main").
function buildPinArgs(installStamp) {
  const args = []
  if (installStamp && installStamp.commit) {
    args.push('-Commit', installStamp.commit)
  }
  if (installStamp && installStamp.branch) {
    args.push('-Branch', installStamp.branch)
  }
  return args
}

function buildPosixPinArgs({ installStamp, activeRoot, hermesHome }) {
  const args = ['--dir', activeRoot, '--hermes-home', hermesHome]
  if (installStamp && installStamp.branch) {
    args.push('--branch', installStamp.branch)
  }
  if (installStamp && installStamp.commit) {
    args.push('--commit', installStamp.commit)
  }
  return args
}

async function fetchManifest({ scriptPath, installerKind, emit, hermesHome, activeRoot, installStamp }) {
  const isPosix = installerKind === 'posix'
  const args = isPosix
    ? ['--manifest', ...buildPosixPinArgs({ installStamp, activeRoot, hermesHome })]
    : ['-Manifest', ...buildPinArgs(installStamp)]
  const result = await (isPosix ? spawnBash : spawnPowerShell)(scriptPath, args, {
    emit,
    stageName: '__manifest__',
    hermesHome
  })
  if (result.code !== 0) {
    throw new Error(
      `${isPosix ? 'install.sh --manifest' : 'install.ps1 -Manifest'} failed: exit ${result.code}\n${result.stderr || result.stdout}`
    )
  }
  // The manifest is the LAST JSON line on stdout (install.ps1 may print
  // banner / info lines first depending on Console.OutputEncoding effects).
  // Find the last line that parses as JSON with a `stages` field.
  const lines = result.stdout.split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if (parsed && Array.isArray(parsed.stages)) {
        return parsed
      }
    } catch {
      void 0
    }
  }
  throw new Error(
    `${isPosix ? 'install.sh --manifest' : 'install.ps1 -Manifest'} produced no parseable JSON payload\n${result.stdout}`
  )
}

// Parse the JSON result frame from a stage run. The protocol guarantees
// exactly one JSON line per stage in -Json or -Stage mode (post #27224 fix
// for the double-emit bug we addressed in the install.ps1 PR).
function parseStageResult(stdout) {
  const lines = stdout.split(/\r?\n/).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if (parsed && typeof parsed.ok === 'boolean' && typeof parsed.stage === 'string') {
        return parsed
      }
    } catch {
      void 0
    }
  }
  return null
}

async function runStage({ scriptPath, installerKind, stage, emit, hermesHome, activeRoot, abortSignal, installStamp }) {
  const startedAt = Date.now()
  emit({ type: 'stage', name: stage.name, state: 'running' })

  const isPosix = installerKind === 'posix'
  const args = isPosix
    ? [
        '--stage',
        stage.name,
        '--non-interactive',
        '--json',
        ...buildPosixPinArgs({ installStamp, activeRoot, hermesHome })
      ]
    : ['-Stage', stage.name, '-NonInteractive', '-Json', ...buildPinArgs(installStamp)]
  const result = await (isPosix ? spawnBash : spawnPowerShell)(scriptPath, args, {
    emit,
    stageName: stage.name,
    abortSignal,
    hermesHome
  })

  const durationMs = Date.now() - startedAt

  if (result.killed) {
    const ev = { type: 'stage', name: stage.name, state: 'failed', durationMs, error: 'cancelled by user' }
    emit(ev)
    return ev
  }

  const json = parseStageResult(result.stdout)

  if (!json) {
    const ev = {
      type: 'stage',
      name: stage.name,
      state: 'failed',
      durationMs,
      error: `${isPosix ? 'install.sh --stage' : 'install.ps1 -Stage'} ${stage.name} produced no JSON result frame (exit=${result.code})`,
      json: null
    }
    emit(ev)
    return ev
  }

  if (json.ok && json.skipped) {
    const ev = { type: 'stage', name: stage.name, state: 'skipped', durationMs, json }
    emit(ev)
    return ev
  }
  if (json.ok) {
    const ev = { type: 'stage', name: stage.name, state: 'succeeded', durationMs, json }
    emit(ev)
    return ev
  }
  const ev = {
    type: 'stage',
    name: stage.name,
    state: 'failed',
    durationMs,
    json,
    error: json.reason || `exit code ${result.code}`
  }
  emit(ev)
  return ev
}

// ---------------------------------------------------------------------------
// Per-run log file
// ---------------------------------------------------------------------------

function openRunLog(logRoot) {
  fs.mkdirSync(logRoot, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = path.join(logRoot, `bootstrap-${ts}.log`)
  const stream = fs.createWriteStream(logPath, { flags: 'a' })
  return { path: logPath, stream }
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

async function runBootstrap(opts) {
  const {
    installStamp,
    activeRoot,
    sourceRepoRoot,
    hermesHome,
    logRoot,
    onEvent,
    abortSignal,
    writeMarker // callback to write the bootstrap-complete marker; main.cjs provides
  } = opts

  // Bail before spawning anything if the user already cancelled — otherwise an
  // already-aborted signal would still fetch the manifest (a spawn) before the
  // in-loop abort check fires.
  if (abortSignal && abortSignal.aborted) {
    if (typeof onEvent === 'function') {
      try {
        onEvent({ type: 'failed', error: 'bootstrap cancelled by user' })
      } catch {
        void 0
      }
    }
    return { ok: false, cancelled: true }
  }

  const runLog = openRunLog(logRoot || path.join(hermesHome, 'logs'))

  // Tee every event to the runLog AND the caller's onEvent. This gives us a
  // forensic trail per bootstrap run AND lets the renderer subscribe live.
  const emit = ev => {
    try {
      runLog.stream.write(JSON.stringify(ev) + '\n')
    } catch {
      void 0
    }
    try {
      if (typeof onEvent === 'function') onEvent(ev)
    } catch (err) {
      // Don't let a subscriber bug crash the bootstrap
      runLog.stream.write(`emit error: ${err && err.message}\n`)
    }
  }

  emit({
    type: 'log',
    line:
      `[bootstrap] starting at ${new Date().toISOString()}; ` +
      `activeRoot=${activeRoot}; ` +
      `stamp=${installStamp ? installStamp.commit.slice(0, 12) : '<none>'}; ` +
      `runLog=${runLog.path}`
  })

  try {
    // 1. Resolve the platform installer.
    const scriptInfo = await resolveInstallScript({ installStamp, sourceRepoRoot, hermesHome, emit })
    const installerKind = scriptInfo.kind || 'powershell'

    // 2. Fetch manifest
    const manifest = await fetchManifest({
      scriptPath: scriptInfo.path,
      installerKind,
      emit,
      hermesHome,
      activeRoot,
      installStamp
    })
    emit({
      type: 'manifest',
      stages: manifest.stages,
      protocolVersion: manifest.protocol_version || manifest.protocolVersion || null
    })

    // 3. Iterate stages in order. Stages flagged needs_user_input are still
    //    invoked -- install.ps1's own -NonInteractive handler in those stages
    //    emits skipped=true. We trust the protocol rather than filtering
    //    client-side.
    for (const stage of manifest.stages) {
      if (abortSignal && abortSignal.aborted) {
        emit({ type: 'failed', error: 'bootstrap cancelled by user' })
        return { ok: false, cancelled: true }
      }
      const ev = await runStage({
        scriptPath: scriptInfo.path,
        installerKind,
        stage,
        emit,
        hermesHome,
        activeRoot,
        abortSignal,
        installStamp
      })
      if (ev.state === 'failed') {
        emit({ type: 'failed', stage: stage.name, error: ev.error || 'stage failed' })
        return { ok: false, failedStage: stage.name, error: ev.error }
      }
    }

    // 4. Write the bootstrap-complete marker.
    const markerPayload = {
      pinnedCommit: installStamp ? installStamp.commit : null,
      pinnedBranch: installStamp ? installStamp.branch : null
    }
    const marker = typeof writeMarker === 'function' ? writeMarker(markerPayload) : markerPayload
    emit({ type: 'complete', marker })
    return { ok: true, marker }
  } catch (err) {
    emit({ type: 'failed', error: err.message || String(err) })
    return { ok: false, error: err.message || String(err) }
  } finally {
    try {
      runLog.stream.end()
    } catch {
      void 0
    }
  }
}

module.exports = {
  runBootstrap,
  // Exposed for testability
  parseStageResult,
  resolveLocalInstallScript,
  resolveInstallScript,
  installedAgentInstallScript,
  cachedScriptPath
}
