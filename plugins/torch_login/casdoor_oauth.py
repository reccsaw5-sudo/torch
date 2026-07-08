"""Casdoor OAuth2 authorization-code + PKCE login for the branded client.

Self-contained so it can be unit-tested without argparse or the plugin loader.
The client is a public OAuth client: it uses PKCE and a loopback redirect, so
no client secret needs to ship in the distributed app. A secret may still be
supplied via ``TORCH_CLIENT_SECRET`` for Casdoor deployments configured to
require one.

Credentials are stored in ``<HERMES_HOME>/torch_auth.json`` (0600), separate
from Hermes' own ``auth.json`` so this brand integration never has to reach
into that module's private internals.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import stat
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlencode, urlparse, parse_qs

import httpx

from hermes_constants import get_hermes_home

# ---------------------------------------------------------------------------
# Config (env-overridable so a fork/deploy can repoint without code edits)
# ---------------------------------------------------------------------------

CASDOOR_ENDPOINT = os.getenv("TORCH_CASDOOR_ENDPOINT", "http://127.0.0.1:8000").rstrip("/")
CLIENT_ID = os.getenv("TORCH_CLIENT_ID", "7bf6939df630bebfac72")
CLIENT_SECRET = os.getenv("TORCH_CLIENT_SECRET", "")
REDIRECT_PORT = int(os.getenv("TORCH_REDIRECT_PORT", "53682"))
REDIRECT_PATH = "/callback"
SCOPE = os.getenv("TORCH_SCOPE", "openid profile email")

AUTHORIZE_PATH = "/login/oauth/authorize"
TOKEN_PATH = "/api/login/oauth/access_token"
USERINFO_PATH = "/api/userinfo"

CRED_FILENAME = "torch_auth.json"


def redirect_uri() -> str:
    return f"http://127.0.0.1:{REDIRECT_PORT}{REDIRECT_PATH}"


def _endpoint_is_loopback() -> bool:
    host = (urlparse(CASDOOR_ENDPOINT).hostname or "").lower()
    return host in {"127.0.0.1", "localhost", "::1"}


def _http_client(timeout: float) -> httpx.Client:
    """httpx client that bypasses ambient proxies for loopback endpoints.

    On macOS the system proxy config is picked up by ``trust_env=True`` and can
    502 loopback POSTs; for a real brand domain we keep proxy support so users
    behind a corporate proxy still reach the server. Force either way via
    ``TORCH_TRUST_ENV``.
    """
    override = os.getenv("TORCH_TRUST_ENV")
    if override is not None:
        trust_env = override.strip().lower() in {"1", "true", "yes", "on"}
    else:
        trust_env = not _endpoint_is_loopback()
    return httpx.Client(trust_env=trust_env, timeout=timeout)


# ---------------------------------------------------------------------------
# PKCE
# ---------------------------------------------------------------------------

def make_pkce_pair() -> Tuple[str, str]:
    """Return (code_verifier, code_challenge) using S256."""
    verifier = secrets.token_urlsafe(64)[:96]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


def build_authorize_url(state: str, code_challenge: str) -> str:
    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": redirect_uri(),
        "scope": SCOPE,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{CASDOOR_ENDPOINT}{AUTHORIZE_PATH}?{urlencode(params)}"


# ---------------------------------------------------------------------------
# Loopback capture of the redirect
# ---------------------------------------------------------------------------

_SUCCESS_HTML = (
    "<!doctype html><html><head><meta charset='utf-8'><title>Login</title></head>"
    "<body style='font-family:system-ui;text-align:center;padding-top:20vh'>"
    "<h2>登录成功 / Signed in</h2><p>可以关闭本页面，返回客户端。</p></body></html>"
)
_ERROR_HTML = (
    "<!doctype html><html><head><meta charset='utf-8'><title>Login</title></head>"
    "<body style='font-family:system-ui;text-align:center;padding-top:20vh'>"
    "<h2>登录失败 / Sign-in failed</h2><p>{msg}</p></body></html>"
)


def _make_handler(expected_state: str, sink: Dict[str, Any], done: threading.Event):
    class _Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):  # silence default stderr logging
            return

        def do_GET(self):  # noqa: N802 (http.server API)
            parsed = urlparse(self.path)
            if parsed.path != REDIRECT_PATH:
                self.send_response(404)
                self.end_headers()
                return
            qs = parse_qs(parsed.query)
            code = (qs.get("code") or [""])[0]
            state = (qs.get("state") or [""])[0]
            err = (qs.get("error") or [""])[0]
            if err:
                sink["error"] = err
            elif not code:
                sink["error"] = "missing_code"
            elif state != expected_state:
                sink["error"] = "state_mismatch"
            else:
                sink["code"] = code

            body = (
                _SUCCESS_HTML
                if sink.get("code")
                else _ERROR_HTML.format(msg=sink.get("error", "unknown"))
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            done.set()

    return _Handler


def wait_for_code(expected_state: str, timeout: float = 300.0) -> str:
    """Start the loopback server, block until the redirect delivers a code."""
    sink: Dict[str, Any] = {}
    done = threading.Event()
    handler = _make_handler(expected_state, sink, done)
    server = HTTPServer(("127.0.0.1", REDIRECT_PORT), handler)
    thread = threading.Thread(
        target=server.serve_forever, kwargs={"poll_interval": 0.2}, daemon=True
    )
    thread.start()
    try:
        if not done.wait(timeout=timeout):
            raise TimeoutError("Timed out waiting for browser authorization")
    finally:
        server.shutdown()
        server.server_close()
    if sink.get("error"):
        raise RuntimeError(f"Authorization failed: {sink['error']}")
    return sink["code"]


# ---------------------------------------------------------------------------
# Token exchange + userinfo
# ---------------------------------------------------------------------------

def exchange_code(code: str, code_verifier: str, timeout: float = 20.0) -> Dict[str, Any]:
    data = {
        "grant_type": "authorization_code",
        "client_id": CLIENT_ID,
        "code": code,
        "redirect_uri": redirect_uri(),
        "code_verifier": code_verifier,
    }
    if CLIENT_SECRET:
        data["client_secret"] = CLIENT_SECRET
    with _http_client(timeout) as client:
        resp = client.post(f"{CASDOOR_ENDPOINT}{TOKEN_PATH}", data=data)
    resp.raise_for_status()
    payload = resp.json()
    if "access_token" not in payload:
        raise RuntimeError(
            f"Token endpoint did not return access_token: {payload.get('error') or payload}"
        )
    return payload


def fetch_userinfo(access_token: str, timeout: float = 20.0) -> Dict[str, Any]:
    with _http_client(timeout) as client:
        resp = client.get(
            f"{CASDOOR_ENDPOINT}{USERINFO_PATH}",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    resp.raise_for_status()
    return resp.json()


# ---------------------------------------------------------------------------
# Credential storage (<HERMES_HOME>/torch_auth.json, 0600)
# ---------------------------------------------------------------------------

def _cred_path() -> Path:
    return get_hermes_home() / CRED_FILENAME


def store_credentials(token_payload: Dict[str, Any], userinfo: Dict[str, Any]) -> Path:
    now = int(time.time())
    expires_in = int(token_payload.get("expires_in") or 0)
    record = {
        "endpoint": CASDOOR_ENDPOINT,
        "client_id": CLIENT_ID,
        "access_token": token_payload.get("access_token", ""),
        "refresh_token": token_payload.get("refresh_token", ""),
        "id_token": token_payload.get("id_token", ""),
        "token_type": token_payload.get("token_type", "Bearer"),
        "scope": token_payload.get("scope", SCOPE),
        "expires_at": (now + expires_in) if expires_in > 0 else 0,
        "user": {
            "sub": userinfo.get("sub", ""),
            "name": userinfo.get("name", ""),
            "preferred_username": userinfo.get("preferred_username", ""),
            "email": userinfo.get("email", ""),
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    path = _cred_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp.{os.getpid()}")
    fd = os.open(str(tmp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, stat.S_IRUSR | stat.S_IWUSR)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
    os.replace(tmp, path)
    try:
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    except OSError:
        pass
    return path


def load_credentials() -> Optional[Dict[str, Any]]:
    path = _cred_path()
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def logout() -> bool:
    path = _cred_path()
    if path.exists():
        path.unlink()
        return True
    return False


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def login(open_browser: bool = True, timeout: float = 300.0) -> Dict[str, Any]:
    """Run the full browser authorization-code + PKCE login.

    Returns the stored credential record. Raises on failure/timeout.
    """
    verifier, challenge = make_pkce_pair()
    state = secrets.token_urlsafe(16)
    url = build_authorize_url(state, challenge)

    print("请在浏览器中登录（若未自动打开，请手动访问下面的链接）：")
    print(f"  {url}")
    if open_browser:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    code = wait_for_code(state, timeout=timeout)
    token_payload = exchange_code(code, verifier)
    access_token = token_payload["access_token"]
    try:
        userinfo = fetch_userinfo(access_token)
    except Exception:
        userinfo = {}
    record = store_credentials(token_payload, userinfo)
    return load_credentials() or {}
