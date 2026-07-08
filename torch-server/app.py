"""Torch business backend — standalone service (the customer-facing server).

This is NOT a Hermes plugin. It is your own product server that the branded
client talks to. Run it separately from Hermes' internal dashboard:

    python torch-server/app.py            # 127.0.0.1:8080
    # or: uvicorn app:app --app-dir torch-server --port 8080

Storage: PostgreSQL (both the client-facing "前台" endpoints and the admin
"后台" endpoints share this one database).

Responsibilities:
- Store: users / api_keys / credits ledger / model catalog / brand config
- Auth endpoints: register/login (email + password) -> issues an inference key
- OpenAI-compatible metering proxy: /v1/models, /v1/chat/completions
  (verify inference key -> check credits -> forward upstream -> deduct)
- Admin endpoints (X-Admin-Token): model catalog CRUD, users, credits, brand
- Brand center: /brand (public read) + /admin/brand (write)

Env overrides (no code change needed):
  TORCH_DATABASE_URL       default postgresql://torch:torch@127.0.0.1:5433/torch
  TORCH_ADMIN_TOKEN        default dev-admin
  TORCH_SIGNUP_CREDITS     default 1000
  TORCH_PUBLIC_BASE        default http://127.0.0.1:8080
  TORCH_HOST / TORCH_PORT  default 127.0.0.1 / 8080
  TORCH_TRUST_ENV          force httpx proxy on/off (default: off for loopback)
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from contextlib import contextmanager
from typing import Optional
from urllib.parse import parse_qsl, quote, urlparse

import httpx
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response, StreamingResponse
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

import payments

DATABASE_URL = os.getenv(
    "TORCH_DATABASE_URL", "postgresql://torch:torch@127.0.0.1:5433/torch"
)
ADMIN_TOKEN = os.getenv("TORCH_ADMIN_TOKEN", "dev-admin")
SIGNUP_CREDITS = int(os.getenv("TORCH_SIGNUP_CREDITS", "1000"))
PUBLIC_BASE = os.getenv("TORCH_PUBLIC_BASE", "http://127.0.0.1:8080").rstrip("/")
INFERENCE_BASE = f"{PUBLIC_BASE}/v1"

# Brand center — every value here is editable from the admin API and read by
# the client (icon/name/version) and the official website (site name/links).
# The desktop packaging pipeline reads /brand to stamp the built app.
_BRAND_DEFAULTS: dict[str, str] = {
    "app_name": "Torch",
    "app_display_name": "Torch",
    "app_version": "0.1.0",
    "app_icon_url": "",
    "bundle_id": "com.torch.desktop",
    "website_name": "Torch",
    "website_url": "",
    "download_url_mac": "",
    "download_url_win": "",
    "support_email": "",
    "primary_color": "#000000",
}
_BRAND_KEYS = set(_BRAND_DEFAULTS)

# Payment / recharge config — every value editable from the admin API. Inert
# until `enabled=1` and a provider's own `*_enabled=1` + credentials are set.
# Amounts are in RMB fen (整数分) everywhere to avoid float rounding.
PAYMENT_DEFAULTS: dict[str, str] = {
    "enabled": "0",
    "currency": "CNY",
    # Public base the payment providers can reach for async notifications.
    # Empty -> falls back to PUBLIC_BASE. MUST be a public HTTPS URL in prod.
    "notify_base": "",
    # WeChat Pay (Native / 扫码支付, API v3)
    "wechat_enabled": "0",
    "wechat_appid": "",
    "wechat_mchid": "",
    "wechat_cert_serial_no": "",
    "wechat_api_v3_key": "",
    "wechat_private_key": "",
    # Alipay (当面付 / precreate)
    "alipay_enabled": "0",
    "alipay_appid": "",
    "alipay_app_private_key": "",
    "alipay_public_key": "",
    "alipay_sandbox": "0",
}
_PAYMENT_KEYS = set(PAYMENT_DEFAULTS)
# Never echoed back in plaintext by the admin read endpoint.
_PAYMENT_SECRET_KEYS = {
    "wechat_api_v3_key",
    "wechat_private_key",
    "alipay_app_private_key",
}

# WeChat scan-to-login (微信开放平台「网站应用」/ 扫码登录). Editable from admin.
# Inert until enabled=1 with an AppID + AppSecret. `redirect` must be a public
# HTTPS URL under a domain registered on the WeChat Open Platform app; empty
# falls back to PUBLIC_BASE + /auth/wechat/callback.
WECHAT_LOGIN_DEFAULTS: dict[str, str] = {
    "wechat_login_enabled": "0",
    "wechat_login_appid": "",
    "wechat_login_secret": "",
    "wechat_login_redirect": "",
}
_AUTH_KEYS = set(WECHAT_LOGIN_DEFAULTS)
_AUTH_SECRET_KEYS = {"wechat_login_secret"}

# Desktop client packaging — editable from admin. The admin "客户端构建" page
# uses this to remote-trigger the GitHub Actions packaging workflow and to show
# the download links published to Tencent COS (方式 B: COS keys live as GitHub
# Secrets, the build machine uploads directly to COS, the server only triggers
# builds + reads the published manifest).
#   github_repo   owner/repo of the private packaging repo
#   github_token  PAT with actions:write (masked); triggers workflow_dispatch
#   github_workflow  workflow file name
#   github_ref    branch/tag to run the workflow on
#   cos_base_url  public COS base (or CDN domain) where manifest.json lives
BUILD_DEFAULTS: dict[str, str] = {
    "github_repo": "",
    "github_token": "",
    "github_workflow": "torch-desktop.yml",
    "github_ref": "main",
    "cos_base_url": "",
}
_BUILD_KEYS = set(BUILD_DEFAULTS)
_BUILD_SECRET_KEYS = {"github_token"}

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
# WeChat Pay v3 caches downloaded platform certificates here.
_WECHAT_CERT_DIR = os.path.join(_DATA_DIR, "wechat_certs")

_pool = ConnectionPool(
    DATABASE_URL, min_size=1, max_size=10, open=True, kwargs={"row_factory": dict_row}
)


@contextmanager
def _db():
    # pool.connection() commits on clean exit, rolls back on exception.
    with _pool.connection() as conn:
        yield conn


_DDL = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        username TEXT,
        balance INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS api_keys (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        api_key TEXT UNIQUE NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_apikeys_key ON api_keys(api_key)",
    """
    CREATE TABLE IF NOT EXISTS credits_ledger (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        delta INTEGER NOT NULL,
        reason TEXT,
        created_at BIGINT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_ledger_user ON credits_ledger(user_id)",
    """
    CREATE TABLE IF NOT EXISTS model_catalog (
        id SERIAL PRIMARY KEY,
        model TEXT UNIQUE NOT NULL,
        upstream_base_url TEXT NOT NULL,
        upstream_model TEXT,
        upstream_api_key TEXT,
        price INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL
    )
    """,
    "CREATE TABLE IF NOT EXISTS brand_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')",
    """
    CREATE TABLE IF NOT EXISTS brand_assets (
        name TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at BIGINT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS suggestions (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS skills (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL
    )
    """,
    "CREATE TABLE IF NOT EXISTS payment_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')",
    """
    CREATE TABLE IF NOT EXISTS recharge_packages (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        amount_fen INTEGER NOT NULL,
        credits INTEGER NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at BIGINT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        out_trade_no TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id),
        package_id INTEGER,
        provider TEXT NOT NULL,
        amount_fen INTEGER NOT NULL,
        credits INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        transaction_id TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL,
        paid_at BIGINT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)",
    "CREATE TABLE IF NOT EXISTS auth_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')",
    "CREATE TABLE IF NOT EXISTS build_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '')",
    """
    CREATE TABLE IF NOT EXISTS wechat_login_states (
        state TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        created_at BIGINT NOT NULL
    )
    """,
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS wx_openid TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS wx_unionid TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wx_openid ON users(wx_openid)"
    " WHERE wx_openid IS NOT NULL",
]

# Default home-screen task cards + marketplace skills, seeded on first run so a
# fresh install already looks like the finished product. All editable from admin.
_SEED_SUGGESTIONS = [
    ("快速开始自动化周报", "浏览本周所有会话，用 weekly-report 技能生成 Word 周报。",
     "请浏览我本周的所有会话，然后使用 weekly-report 技能，总结本周工作并生成一份 Word 周报。", 10),
    ("查询天气", "帮我查询一下今天的天气。", "帮我查询一下今天的天气情况。", 20),
    ("整理今日待办", "把今天要做的事整理成清单。", "帮我把今天要做的事情整理成一个清晰的待办清单。", 30),
    ("解释一段代码", "粘贴代码，我来讲清它做了什么。", "我会粘贴一段代码，请帮我逐步解释它做了什么。", 40),
]
_SEED_SKILLS = [
    ("weekly-report", "周报生成", "浏览会话并生成 Word 周报。", "办公",
     "# weekly-report\n\n浏览最近的会话记录，汇总本周完成的工作，生成结构化的 Word 周报。", 10),
    ("daily-standup", "每日站会", "整理昨日进展与今日计划。", "办公",
     "# daily-standup\n\n整理昨天的进展、今天的计划和遇到的阻碍，输出适合站会的简报。", 20),
    ("code-review", "代码审查", "对给定代码做结构化审查。", "开发",
     "# code-review\n\n对提供的代码做结构化审查：可读性、边界情况、安全性与性能建议。", 30),
]

# Default recharge packages (amount in RMB fen). Editable from admin.
_SEED_PACKAGES = [
    ("入门包", 990, 1000, 10),
    ("标准包", 4900, 6000, 20),
    ("专业包", 9900, 13000, 30),
]


def _init_db() -> None:
    with _db() as conn:
        for stmt in _DDL:
            conn.execute(stmt)
        row = conn.execute("SELECT COUNT(*) AS n FROM model_catalog").fetchone()
        if row["n"] == 0:
            conn.execute(
                "INSERT INTO model_catalog(model, upstream_base_url, upstream_model,"
                " upstream_api_key, price, enabled, created_at)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s)",
                ("torch-mock", "mock", "torch-mock", "", 1, 1, int(time.time())),
            )
        for k, v in _BRAND_DEFAULTS.items():
            conn.execute(
                "INSERT INTO brand_config(key, value) VALUES (%s,%s)"
                " ON CONFLICT (key) DO NOTHING",
                (k, v),
            )
        for k, v in PAYMENT_DEFAULTS.items():
            conn.execute(
                "INSERT INTO payment_config(key, value) VALUES (%s,%s)"
                " ON CONFLICT (key) DO NOTHING",
                (k, v),
            )
        for k, v in WECHAT_LOGIN_DEFAULTS.items():
            conn.execute(
                "INSERT INTO auth_config(key, value) VALUES (%s,%s)"
                " ON CONFLICT (key) DO NOTHING",
                (k, v),
            )
        for k, v in BUILD_DEFAULTS.items():
            conn.execute(
                "INSERT INTO build_config(key, value) VALUES (%s,%s)"
                " ON CONFLICT (key) DO NOTHING",
                (k, v),
            )
        if conn.execute("SELECT COUNT(*) AS n FROM recharge_packages").fetchone()["n"] == 0:
            for title, amount_fen, credits, order in _SEED_PACKAGES:
                conn.execute(
                    "INSERT INTO recharge_packages(title, amount_fen, credits,"
                    " sort_order, enabled, created_at) VALUES (%s,%s,%s,%s,1,%s)",
                    (title, amount_fen, credits, order, int(time.time())),
                )
        if conn.execute("SELECT COUNT(*) AS n FROM suggestions").fetchone()["n"] == 0:
            for title, subtitle, prompt, order in _SEED_SUGGESTIONS:
                conn.execute(
                    "INSERT INTO suggestions(title, subtitle, prompt, sort_order,"
                    " enabled, created_at) VALUES (%s,%s,%s,%s,1,%s)",
                    (title, subtitle, prompt, order, int(time.time())),
                )
        if conn.execute("SELECT COUNT(*) AS n FROM skills").fetchone()["n"] == 0:
            for slug, name, desc, cat, content, order in _SEED_SKILLS:
                conn.execute(
                    "INSERT INTO skills(slug, name, description, category, content,"
                    " sort_order, enabled, created_at) VALUES (%s,%s,%s,%s,%s,%s,1,%s)",
                    (slug, name, desc, cat, content, order, int(time.time())),
                )


def _grant(conn, user_id: int, delta: int, reason: str) -> None:
    conn.execute(
        "INSERT INTO credits_ledger(user_id, delta, reason, created_at) VALUES (%s,%s,%s,%s)",
        (user_id, delta, reason, int(time.time())),
    )
    conn.execute("UPDATE users SET balance = balance + %s WHERE id = %s", (delta, user_id))


def _user_by_key(conn, api_key: str):
    return conn.execute(
        "SELECT u.* FROM users u JOIN api_keys k ON k.user_id = u.id"
        " WHERE k.api_key = %s AND k.revoked = 0",
        (api_key,),
    ).fetchone()


def _payment_all(conn) -> dict:
    rows = conn.execute("SELECT key, value FROM payment_config").fetchall()
    data = {r["key"]: r["value"] for r in rows}
    for k, v in PAYMENT_DEFAULTS.items():
        data.setdefault(k, v)
    return data


def _mask_payment(cfg: dict) -> dict:
    """Replace stored secrets with a sentinel so the admin UI never sees them."""
    return {
        k: ("***" if k in _PAYMENT_SECRET_KEYS and v else v) for k, v in cfg.items()
    }


def _auth_all(conn) -> dict:
    rows = conn.execute("SELECT key, value FROM auth_config").fetchall()
    data = {r["key"]: r["value"] for r in rows}
    for k, v in WECHAT_LOGIN_DEFAULTS.items():
        data.setdefault(k, v)
    return data


def _mask_auth(cfg: dict) -> dict:
    return {k: ("***" if k in _AUTH_SECRET_KEYS and v else v) for k, v in cfg.items()}


def _build_all(conn) -> dict:
    rows = conn.execute("SELECT key, value FROM build_config").fetchall()
    data = {r["key"]: r["value"] for r in rows}
    for k, v in BUILD_DEFAULTS.items():
        data.setdefault(k, v)
    return data


def _mask_build(cfg: dict) -> dict:
    return {k: ("***" if k in _BUILD_SECRET_KEYS and v else v) for k, v in cfg.items()}


def _github_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "torch-server",
    }


def _wechat_login_enabled(cfg: dict) -> bool:
    return (
        cfg.get("wechat_login_enabled") == "1"
        and bool(cfg.get("wechat_login_appid"))
        and bool(cfg.get("wechat_login_secret"))
    )


def _wechat_redirect(cfg: dict) -> str:
    return (cfg.get("wechat_login_redirect") or "").strip() or f"{PUBLIC_BASE}/auth/wechat/callback"


def _wechat_html(msg: str) -> Response:
    body = (
        "<!doctype html><html lang='zh'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<title>微信登录</title><style>body{margin:0;height:100vh;display:flex;"
        "align-items:center;justify-content:center;font-family:system-ui,-apple-system,"
        "'PingFang SC',sans-serif;background:#fff;color:#111}div{text-align:center}"
        "p{font-size:15px;color:#444}</style></head><body><div>"
        f"<p>{msg}</p></div></body></html>"
    )
    return Response(content=body, media_type="text/html")


def _wechat_get_or_create_user(conn, openid: str, unionid: str, nickname: str):
    user = conn.execute(
        "SELECT * FROM users WHERE wx_openid = %s", (openid,)
    ).fetchone()
    if user is not None:
        return user
    email = f"wx_{openid}@wechat.local"
    username = (nickname or "").strip() or f"微信用户{openid[-6:]}"
    pw = _hash_password(secrets.token_hex(16))
    user_id = conn.execute(
        "INSERT INTO users(email, password_hash, username, balance, created_at,"
        " wx_openid, wx_unionid) VALUES (%s,%s,%s,0,%s,%s,%s) RETURNING id",
        (email, pw, username, int(time.time()), openid, unionid or None),
    ).fetchone()["id"]
    _grant(conn, user_id, SIGNUP_CREDITS, "signup_grant:wechat")
    return conn.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()


def _credit_paid_order(
    out_trade_no: str, provider: str, paid_amount_fen: int, transaction_id: str
) -> bool:
    """Atomically mark an order paid and grant its credits — exactly once.

    Returns True if the order is (now or already) paid. All the money-safety
    lives here: row-locked lookup, provider match, amount check, and an
    idempotency guard so a provider retrying the same notification can never
    double-credit an account.
    """
    with _db() as conn:
        order = conn.execute(
            "SELECT * FROM orders WHERE out_trade_no = %s FOR UPDATE", (out_trade_no,)
        ).fetchone()
        if order is None or order["provider"] != provider:
            return False
        if order["status"] == "paid":
            return True
        if paid_amount_fen and int(paid_amount_fen) != int(order["amount_fen"]):
            conn.execute(
                "UPDATE orders SET status = 'failed' WHERE id = %s", (order["id"],)
            )
            return False
        conn.execute(
            "UPDATE orders SET status = 'paid', transaction_id = %s, paid_at = %s"
            " WHERE id = %s",
            (transaction_id, int(time.time()), order["id"]),
        )
        _grant(
            conn,
            order["user_id"],
            int(order["credits"]),
            f"recharge:{provider}:{out_trade_no}",
        )
    return True


# --------------------------------------------------------------------------
# HTTP helpers
# --------------------------------------------------------------------------
def _client(url: str, timeout: float = 60.0) -> httpx.Client:
    host = (urlparse(url).hostname or "").lower()
    loopback = host in {"127.0.0.1", "localhost", "::1"}
    override = os.getenv("TORCH_TRUST_ENV")
    if override is not None:
        trust = override.strip().lower() in {"1", "true", "yes", "on"}
    else:
        trust = not loopback
    return httpx.Client(trust_env=trust, timeout=timeout)


def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return f"pbkdf2_sha256$200000${salt}${dk.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        _algo, iters, salt, digest = stored.split("$")
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), int(iters)
        )
        return hmac.compare_digest(dk.hex(), digest)
    except Exception:
        return False


def _bearer(authorization: Optional[str]) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    return authorization.split(" ", 1)[1].strip()


def _require_admin(x_admin_token: Optional[str]) -> None:
    if not x_admin_token or not secrets.compare_digest(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(status_code=403, detail="invalid admin token")


# --------------------------------------------------------------------------
# App
# --------------------------------------------------------------------------
_init_db()

app = FastAPI(title="Torch Backend", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    # Auth is via headers (X-Admin-Token / Bearer key), not cookies, so we can
    # allow any origin — the desktop client (Electron, custom origin) and the
    # website both call this API. allow_credentials must be False with "*".
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "torch-server", "inference_base": INFERENCE_BASE}


# --------------------------------------------------------------------------
# Brand center (public read; admin write)
# --------------------------------------------------------------------------
def _brand_all(conn) -> dict:
    rows = conn.execute("SELECT key, value FROM brand_config").fetchall()
    data = {r["key"]: r["value"] for r in rows}
    for k, v in _BRAND_DEFAULTS.items():
        data.setdefault(k, v)
    return data


@app.get("/brand")
def get_brand() -> dict:
    """Public brand config — read by the client and the official website."""
    with _db() as conn:
        return _brand_all(conn)


@app.get("/admin/brand")
def admin_get_brand(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        return _brand_all(conn)


@app.post("/admin/brand")
def admin_set_brand(
    payload: dict, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    unknown = set(payload) - _BRAND_KEYS
    if unknown:
        raise HTTPException(status_code=400, detail=f"unknown keys: {sorted(unknown)}")
    with _db() as conn:
        for k, v in payload.items():
            conn.execute(
                "INSERT INTO brand_config(key, value) VALUES (%s,%s)"
                " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                (k, str(v)),
            )
        return _brand_all(conn)


class LogoUpload(BaseModel):
    content_type: str
    data_base64: str


@app.post("/admin/brand/logo")
def admin_upload_logo(
    payload: LogoUpload, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    """Store an uploaded logo image and point app_icon_url at /brand/logo."""
    _require_admin(x_admin_token)
    ctype = payload.content_type.strip() or "image/png"
    if not ctype.startswith("image/"):
        raise HTTPException(status_code=400, detail="content_type must be an image/*")
    try:
        base64.b64decode(payload.data_base64, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="invalid base64") from exc
    now = int(time.time())
    with _db() as conn:
        conn.execute(
            "INSERT INTO brand_assets(name, content_type, data, updated_at)"
            " VALUES ('logo',%s,%s,%s) ON CONFLICT (name) DO UPDATE SET"
            " content_type = EXCLUDED.content_type, data = EXCLUDED.data,"
            " updated_at = EXCLUDED.updated_at",
            (ctype, payload.data_base64, now),
        )
        icon_url = f"{PUBLIC_BASE}/brand/logo?v={now}"
        conn.execute(
            "INSERT INTO brand_config(key, value) VALUES ('app_icon_url',%s)"
            " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (icon_url,),
        )
        return _brand_all(conn)


@app.get("/brand/logo")
def get_brand_logo():
    with _db() as conn:
        row = conn.execute(
            "SELECT content_type, data FROM brand_assets WHERE name = 'logo'"
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="no logo uploaded")
    return Response(
        content=base64.b64decode(row["data"]),
        media_type=row["content_type"],
        headers={"Cache-Control": "public, max-age=60"},
    )


# --------------------------------------------------------------------------
# Home task-card suggestions (public read; admin CRUD)
# --------------------------------------------------------------------------
class SuggestionUpsert(BaseModel):
    id: Optional[int] = None
    title: str
    subtitle: str = ""
    prompt: str
    sort_order: int = 0
    enabled: int = 1


@app.get("/suggestions")
def list_suggestions() -> dict:
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, title, subtitle, prompt FROM suggestions"
            " WHERE enabled = 1 ORDER BY sort_order, id"
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@app.get("/admin/suggestions")
def admin_list_suggestions(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, title, subtitle, prompt, sort_order, enabled FROM suggestions"
            " ORDER BY sort_order, id"
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@app.post("/admin/suggestions")
def admin_upsert_suggestion(
    payload: SuggestionUpsert, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        if payload.id is None:
            conn.execute(
                "INSERT INTO suggestions(title, subtitle, prompt, sort_order, enabled,"
                " created_at) VALUES (%s,%s,%s,%s,%s,%s)",
                (payload.title, payload.subtitle, payload.prompt, payload.sort_order,
                 payload.enabled, int(time.time())),
            )
        else:
            conn.execute(
                "UPDATE suggestions SET title=%s, subtitle=%s, prompt=%s,"
                " sort_order=%s, enabled=%s WHERE id=%s",
                (payload.title, payload.subtitle, payload.prompt, payload.sort_order,
                 payload.enabled, payload.id),
            )
    return {"ok": True}


@app.delete("/admin/suggestions/{sid}")
def admin_delete_suggestion(
    sid: int, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        conn.execute("DELETE FROM suggestions WHERE id = %s", (sid,))
    return {"ok": True}


# --------------------------------------------------------------------------
# Skill marketplace (public read; admin CRUD)
# --------------------------------------------------------------------------
class SkillUpsert(BaseModel):
    id: Optional[int] = None
    slug: str
    name: str
    description: str = ""
    category: str = ""
    content: str = ""
    sort_order: int = 0
    enabled: int = 1


@app.get("/skills")
def list_skills() -> dict:
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, slug, name, description, category FROM skills"
            " WHERE enabled = 1 ORDER BY sort_order, id"
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@app.get("/skills/{slug}")
def get_skill(slug: str) -> dict:
    with _db() as conn:
        row = conn.execute(
            "SELECT slug, name, description, category, content FROM skills"
            " WHERE slug = %s AND enabled = 1",
            (slug,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="skill not found")
    return dict(row)


@app.get("/admin/skills")
def admin_list_skills(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, slug, name, description, category, content, sort_order, enabled"
            " FROM skills ORDER BY sort_order, id"
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@app.post("/admin/skills")
def admin_upsert_skill(
    payload: SkillUpsert, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        if payload.id is None:
            conn.execute(
                "INSERT INTO skills(slug, name, description, category, content,"
                " sort_order, enabled, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)"
                " ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name,"
                " description=EXCLUDED.description, category=EXCLUDED.category,"
                " content=EXCLUDED.content, sort_order=EXCLUDED.sort_order,"
                " enabled=EXCLUDED.enabled",
                (payload.slug, payload.name, payload.description, payload.category,
                 payload.content, payload.sort_order, payload.enabled, int(time.time())),
            )
        else:
            conn.execute(
                "UPDATE skills SET slug=%s, name=%s, description=%s, category=%s,"
                " content=%s, sort_order=%s, enabled=%s WHERE id=%s",
                (payload.slug, payload.name, payload.description, payload.category,
                 payload.content, payload.sort_order, payload.enabled, payload.id),
            )
    return {"ok": True}


@app.delete("/admin/skills/{sid}")
def admin_delete_skill(
    sid: int, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        conn.execute("DELETE FROM skills WHERE id = %s", (sid,))
    return {"ok": True}


# --------------------------------------------------------------------------
# Auth (email + password) — issues an inference key + signup credits
# --------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    email: str
    password: str
    username: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _ensure_key(conn, user_id: int) -> str:
    row = conn.execute(
        "SELECT api_key FROM api_keys WHERE user_id = %s AND revoked = 0"
        " ORDER BY id LIMIT 1",
        (user_id,),
    ).fetchone()
    if row is not None:
        return row["api_key"]
    api_key = "torch-" + secrets.token_hex(24)
    conn.execute(
        "INSERT INTO api_keys(user_id, api_key, created_at) VALUES (%s,%s,%s)",
        (user_id, api_key, int(time.time())),
    )
    return api_key


def _session_result(conn, user) -> dict:
    api_key = _ensure_key(conn, user["id"])
    return {
        "api_key": api_key,
        "base_url": INFERENCE_BASE,
        "credits": user["balance"],
        "user": {"username": user["username"], "email": user["email"]},
    }


@app.post("/auth/register")
def auth_register(payload: RegisterRequest) -> dict:
    email = _normalize_email(payload.email)
    if "@" not in email or "." not in email:
        raise HTTPException(status_code=400, detail="invalid email")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="password too short (min 6)")
    username = (payload.username or email.split("@")[0]).strip()
    with _db() as conn:
        if conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone():
            raise HTTPException(status_code=409, detail="email already registered")
        user_id = conn.execute(
            "INSERT INTO users(email, password_hash, username, balance, created_at)"
            " VALUES (%s,%s,%s,0,%s) RETURNING id",
            (email, _hash_password(payload.password), username, int(time.time())),
        ).fetchone()["id"]
        _grant(conn, user_id, SIGNUP_CREDITS, "signup_grant")
        user = conn.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()
        return _session_result(conn, user)


@app.post("/auth/login")
def auth_login(payload: LoginRequest) -> dict:
    email = _normalize_email(payload.email)
    with _db() as conn:
        user = conn.execute("SELECT * FROM users WHERE email = %s", (email,)).fetchone()
        if user is None or not _verify_password(payload.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="invalid email or password")
        return _session_result(conn, user)


@app.get("/account/info")
def account_info(authorization: Optional[str] = Header(default=None)) -> dict:
    api_key = _bearer(authorization)
    with _db() as conn:
        user = _user_by_key(conn, api_key)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid api key")
        ledger = conn.execute(
            "SELECT delta, reason, created_at FROM credits_ledger"
            " WHERE user_id = %s ORDER BY id DESC LIMIT 20",
            (user["id"],),
        ).fetchall()
    return {
        "user": {"username": user["username"], "email": user["email"]},
        "credits": user["balance"],
        "ledger": [dict(r) for r in ledger],
    }


class PasswordChange(BaseModel):
    old_password: str
    new_password: str


class UsernameChange(BaseModel):
    username: str


@app.post("/account/password")
def change_password(
    payload: PasswordChange, authorization: Optional[str] = Header(default=None)
) -> dict:
    api_key = _bearer(authorization)
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="password too short (min 6)")
    with _db() as conn:
        user = _user_by_key(conn, api_key)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid api key")
        if not _verify_password(payload.old_password, user["password_hash"]):
            raise HTTPException(status_code=400, detail="旧密码不正确")
        conn.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s",
            (_hash_password(payload.new_password), user["id"]),
        )
    return {"ok": True}


@app.post("/account/username")
def change_username(
    payload: UsernameChange, authorization: Optional[str] = Header(default=None)
) -> dict:
    api_key = _bearer(authorization)
    name = (payload.username or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="用户名不能为空")
    if len(name) > 40:
        raise HTTPException(status_code=400, detail="用户名过长（最多 40 字）")
    with _db() as conn:
        user = _user_by_key(conn, api_key)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid api key")
        conn.execute(
            "UPDATE users SET username = %s WHERE id = %s", (name, user["id"])
        )
    return {"ok": True, "username": name}


# --------------------------------------------------------------------------
# WeChat scan-to-login (client-facing; server-mediated OAuth2 + polling)
# --------------------------------------------------------------------------
@app.get("/auth/wechat/config")
def wechat_login_config_public() -> dict:
    with _db() as conn:
        cfg = _auth_all(conn)
    return {"enabled": _wechat_login_enabled(cfg)}


@app.post("/auth/wechat/qr")
def wechat_login_qr() -> dict:
    with _db() as conn:
        cfg = _auth_all(conn)
        if not _wechat_login_enabled(cfg):
            raise HTTPException(status_code=400, detail="微信登录未开通")
        state = secrets.token_urlsafe(24)
        conn.execute(
            "INSERT INTO wechat_login_states(state, status, created_at)"
            " VALUES (%s,'pending',%s)",
            (state, int(time.time())),
        )
    redirect = _wechat_redirect(cfg)
    authorize_url = (
        "https://open.weixin.qq.com/connect/qrconnect?"
        f"appid={cfg['wechat_login_appid']}"
        f"&redirect_uri={quote(redirect, safe='')}"
        "&response_type=code&scope=snsapi_login"
        f"&state={state}#wechat_redirect"
    )
    return {"state": state, "authorize_url": authorize_url}


@app.get("/auth/wechat/callback")
def wechat_login_callback(
    code: Optional[str] = None, state: Optional[str] = None
) -> Response:
    if not code or not state:
        return _wechat_html("登录失败：缺少必要参数。")
    with _db() as conn:
        st = conn.execute(
            "SELECT * FROM wechat_login_states WHERE state = %s", (state,)
        ).fetchone()
        if st is None:
            return _wechat_html("登录失败：会话不存在或已过期。")
        cfg = _auth_all(conn)
    if not _wechat_login_enabled(cfg):
        return _wechat_html("登录失败：微信登录未开通。")
    appid = cfg["wechat_login_appid"]
    secret = cfg["wechat_login_secret"]
    try:
        with _client("https://api.weixin.qq.com") as client:
            tok = client.get(
                "https://api.weixin.qq.com/sns/oauth2/access_token",
                params={
                    "appid": appid,
                    "secret": secret,
                    "code": code,
                    "grant_type": "authorization_code",
                },
            )
            tok_data = json.loads(tok.text)
            access_token = tok_data.get("access_token")
            openid = tok_data.get("openid")
            unionid = tok_data.get("unionid", "")
            if not access_token or not openid:
                return _wechat_html(
                    f"登录失败：{tok_data.get('errmsg', '微信授权失败')}"
                )
            info = client.get(
                "https://api.weixin.qq.com/sns/userinfo",
                params={"access_token": access_token, "openid": openid},
            )
            info_data = json.loads(info.text)
            nickname = info_data.get("nickname") or ""
    except Exception:
        return _wechat_html("登录失败：无法连接微信服务器，请稍后重试。")
    with _db() as conn:
        user = _wechat_get_or_create_user(conn, openid, unionid, nickname)
        result = _session_result(conn, user)
        conn.execute(
            "UPDATE wechat_login_states SET status = 'done', result = %s"
            " WHERE state = %s",
            (json.dumps(result), state),
        )
    return _wechat_html("登录成功，请返回应用。")


@app.get("/auth/wechat/poll/{state}")
def wechat_login_poll(state: str) -> dict:
    now = int(time.time())
    with _db() as conn:
        st = conn.execute(
            "SELECT * FROM wechat_login_states WHERE state = %s", (state,)
        ).fetchone()
        if st is None:
            return {"status": "expired"}
        if st["status"] != "done" and now - int(st["created_at"]) > 600:
            conn.execute("DELETE FROM wechat_login_states WHERE state = %s", (state,))
            return {"status": "expired"}
        if st["status"] == "done" and st["result"]:
            result = json.loads(st["result"])
            conn.execute("DELETE FROM wechat_login_states WHERE state = %s", (state,))
            return {"status": "done", "result": result}
    return {"status": "pending"}


# --------------------------------------------------------------------------
# Recharge / payments (client-facing; Bearer inference key)
# --------------------------------------------------------------------------
class OrderCreate(BaseModel):
    package_id: int
    provider: str  # "wechat" | "alipay"


def _active_providers(cfg: dict) -> list[str]:
    if cfg.get("enabled") != "1":
        return []
    out = []
    if cfg.get("wechat_enabled") == "1":
        out.append("wechat")
    if cfg.get("alipay_enabled") == "1":
        out.append("alipay")
    return out


@app.get("/billing/config")
def billing_config(authorization: Optional[str] = Header(default=None)) -> dict:
    """What the client needs to render the recharge dialog: providers + packages."""
    api_key = _bearer(authorization)
    with _db() as conn:
        if _user_by_key(conn, api_key) is None:
            raise HTTPException(status_code=401, detail="invalid api key")
        cfg = _payment_all(conn)
        pkgs = conn.execute(
            "SELECT id, title, amount_fen, credits FROM recharge_packages"
            " WHERE enabled = 1 ORDER BY sort_order, id"
        ).fetchall()
    providers = _active_providers(cfg)
    packages = [dict(r) for r in pkgs]
    return {
        "enabled": bool(providers) and bool(packages),
        "providers": providers,
        "currency": cfg.get("currency", "CNY"),
        "packages": packages,
    }


@app.post("/billing/order")
def create_order(
    payload: OrderCreate, authorization: Optional[str] = Header(default=None)
) -> dict:
    """Create a pending order, ask the provider to precreate it, return a QR."""
    api_key = _bearer(authorization)
    provider = (payload.provider or "").strip()
    if provider not in {"wechat", "alipay"}:
        raise HTTPException(status_code=400, detail="unknown provider")
    with _db() as conn:
        user = _user_by_key(conn, api_key)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid api key")
        cfg = _payment_all(conn)
        if provider not in _active_providers(cfg):
            raise HTTPException(status_code=400, detail="payment provider not enabled")
        pkg = conn.execute(
            "SELECT * FROM recharge_packages WHERE id = %s AND enabled = 1",
            (payload.package_id,),
        ).fetchone()
        if pkg is None:
            raise HTTPException(status_code=404, detail="package not found")
        out_trade_no = "T" + str(int(time.time())) + secrets.token_hex(6)
        conn.execute(
            "INSERT INTO orders(out_trade_no, user_id, package_id, provider,"
            " amount_fen, credits, status, created_at) VALUES (%s,%s,%s,%s,%s,%s,'pending',%s)",
            (out_trade_no, user["id"], pkg["id"], provider, pkg["amount_fen"],
             pkg["credits"], int(time.time())),
        )
        amount_fen = int(pkg["amount_fen"])
        credits = int(pkg["credits"])
        title = pkg["title"]

    # Network call to the provider stays OUT of the DB transaction above.
    notify_base = (cfg.get("notify_base") or PUBLIC_BASE).rstrip("/")
    try:
        if provider == "wechat":
            qr_content = payments.wechat_native_order(
                cfg,
                out_trade_no=out_trade_no,
                amount_fen=amount_fen,
                description=title,
                notify_url=f"{notify_base}/billing/notify/wechat",
                cert_dir=_WECHAT_CERT_DIR,
            )
        else:
            qr_content = payments.alipay_precreate(
                cfg,
                out_trade_no=out_trade_no,
                amount_fen=amount_fen,
                subject=title,
                notify_url=f"{notify_base}/billing/notify/alipay",
            )
    except Exception as exc:
        with _db() as conn:
            conn.execute(
                "UPDATE orders SET status = 'failed' WHERE out_trade_no = %s",
                (out_trade_no,),
            )
        raise HTTPException(status_code=502, detail=f"下单失败：{exc}") from exc

    return {
        "out_trade_no": out_trade_no,
        "provider": provider,
        "amount_fen": amount_fen,
        "credits": credits,
        "qr_code_url": qr_content,
        "qr_image": payments.render_qr(qr_content),
    }


@app.get("/billing/order/{out_trade_no}")
def order_status(
    out_trade_no: str, authorization: Optional[str] = Header(default=None)
) -> dict:
    """Client polls this while the QR is on screen; flips to 'paid' post-webhook."""
    api_key = _bearer(authorization)
    with _db() as conn:
        user = _user_by_key(conn, api_key)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid api key")
        order = conn.execute(
            "SELECT * FROM orders WHERE out_trade_no = %s", (out_trade_no,)
        ).fetchone()
        if order is None or order["user_id"] != user["id"]:
            raise HTTPException(status_code=404, detail="order not found")
        balance = user["balance"]
    return {"status": order["status"], "credits": int(order["credits"]), "balance": int(balance)}


@app.get("/billing/orders")
def my_orders(authorization: Optional[str] = Header(default=None)) -> dict:
    """The signed-in user's own recharge orders (for the profile dialog)."""
    api_key = _bearer(authorization)
    with _db() as conn:
        user = _user_by_key(conn, api_key)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid api key")
        rows = conn.execute(
            "SELECT out_trade_no, provider, amount_fen, credits, status, created_at, paid_at"
            " FROM orders WHERE user_id = %s ORDER BY id DESC LIMIT 50",
            (user["id"],),
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


# --------------------------------------------------------------------------
# Payment provider async notifications (verified by signature; no bearer auth)
# --------------------------------------------------------------------------
@app.post("/billing/notify/wechat")
async def notify_wechat(request: Request):
    with _db() as conn:
        cfg = _payment_all(conn)
    body = await request.body()
    parsed = payments.wechat_parse_notify(
        cfg, headers=dict(request.headers), body=body, cert_dir=_WECHAT_CERT_DIR
    )
    if parsed is None:
        return JSONResponse(
            status_code=400, content={"code": "FAIL", "message": "invalid signature"}
        )
    if parsed["success"]:
        _credit_paid_order(
            parsed["out_trade_no"], "wechat", parsed["amount_fen"], parsed["transaction_id"]
        )
    return {"code": "SUCCESS", "message": "成功"}


@app.post("/billing/notify/alipay")
async def notify_alipay(request: Request):
    with _db() as conn:
        cfg = _payment_all(conn)
    # Alipay posts application/x-www-form-urlencoded — parse without needing the
    # python-multipart dependency.
    raw = (await request.body()).decode("utf-8", "replace")
    form = dict(parse_qsl(raw))
    parsed = payments.alipay_parse_notify(cfg, form=form)
    if parsed is None:
        return PlainTextResponse("failure")
    if parsed["success"]:
        _credit_paid_order(
            parsed["out_trade_no"], "alipay", parsed["amount_fen"], parsed["transaction_id"]
        )
    return PlainTextResponse("success")


# --------------------------------------------------------------------------
# OpenAI-compatible metering proxy
# --------------------------------------------------------------------------
@app.get("/v1/models")
def list_models(authorization: Optional[str] = Header(default=None)) -> dict:
    api_key = _bearer(authorization)
    with _db() as conn:
        if _user_by_key(conn, api_key) is None:
            raise HTTPException(status_code=401, detail="invalid api key")
        rows = conn.execute(
            "SELECT model FROM model_catalog WHERE enabled = 1 ORDER BY model"
        ).fetchall()
    return {
        "object": "list",
        "data": [
            {"id": r["model"], "object": "model", "owned_by": "torch"} for r in rows
        ],
    }


def _mock_reply_text(body: dict) -> str:
    msgs = body.get("messages") or []
    last = ""
    for m in reversed(msgs):
        if m.get("role") == "user":
            last = m.get("content") or ""
            break
    return f"[torch-mock] 收到：{last}" if last else "[torch-mock] hello"


def _mock_completion(model: str, body: dict) -> dict:
    text = _mock_reply_text(body)
    now = int(time.time())
    return {
        "id": f"chatcmpl-mock-{now}",
        "object": "chat.completion",
        "created": now,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def _sse(payload: dict) -> bytes:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def _mock_stream(model: str, body: dict):
    """Emit the mock reply as OpenAI-style SSE chunks so the client streams."""
    text = _mock_reply_text(body)
    now = int(time.time())
    cid = f"chatcmpl-mock-{now}"

    def chunk(delta: dict, finish: Optional[str] = None) -> dict:
        return {
            "id": cid,
            "object": "chat.completion.chunk",
            "created": now,
            "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        }

    yield _sse(chunk({"role": "assistant"}))
    for piece in text:
        yield _sse(chunk({"content": piece}))
    yield _sse(chunk({}, finish="stop"))
    yield b"data: [DONE]\n\n"


def _deduct(user_id: int, price: int, model: str) -> int:
    """Atomic credit deduction; returns the new balance."""
    with _db() as conn:
        conn.execute(
            "INSERT INTO credits_ledger(user_id, delta, reason, created_at)"
            " VALUES (%s,%s,%s,%s)",
            (user_id, -price, f"chat:{model}", int(time.time())),
        )
        return conn.execute(
            "UPDATE users SET balance = balance - %s WHERE id = %s RETURNING balance",
            (price, user_id),
        ).fetchone()["balance"]


@app.post("/v1/chat/completions")
async def chat_completions(
    request: Request, authorization: Optional[str] = Header(default=None)
):
    api_key = _bearer(authorization)
    body = await request.json()
    model = body.get("model") or ""
    stream = bool(body.get("stream"))

    with _db() as conn:
        user = _user_by_key(conn, api_key)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid api key")
        row = conn.execute(
            "SELECT * FROM model_catalog WHERE model = %s AND enabled = 1", (model,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"model not available: {model}")
        price = int(row["price"])
        if user["balance"] < price:
            raise HTTPException(status_code=402, detail="insufficient credits")
        user_id = user["id"]
        upstream_base = row["upstream_base_url"]
        upstream_model = row["upstream_model"] or model
        upstream_key = row["upstream_api_key"] or ""

    # ---- Built-in mock backend (upstream_base == "mock") ----
    if upstream_base == "mock":
        if stream:

            def mock_gen():
                yield from _mock_stream(model, body)
                _deduct(user_id, price, model)

            return StreamingResponse(mock_gen(), media_type="text/event-stream")
        result = _mock_completion(model, body)
        result["torch_credits_remaining"] = _deduct(user_id, price, model)
        return result

    # ---- Real upstream: transparent OpenAI-compatible pass-through ----
    # Forward the request verbatim (messages, tools, temperature, reasoning,
    # etc.), only swapping the exposed model name for the upstream one, so the
    # Hermes agent's normal model-call structure works unchanged — including
    # server-sent-event streaming.
    fwd = dict(body)
    fwd["model"] = upstream_model
    headers = {"Content-Type": "application/json"}
    if upstream_key:
        headers["Authorization"] = f"Bearer {upstream_key}"
    url = f"{upstream_base.rstrip('/')}/chat/completions"

    if stream:
        fwd["stream"] = True

        def upstream_gen():
            try:
                with _client(upstream_base, timeout=300) as client:
                    with client.stream("POST", url, json=fwd, headers=headers) as resp:
                        if resp.status_code >= 400:
                            detail = resp.read().decode("utf-8", "replace")
                            yield _sse(
                                {"error": {"code": resp.status_code, "message": detail[:1000]}}
                            )
                            yield b"data: [DONE]\n\n"
                            return
                        for chunk in resp.iter_raw():
                            if chunk:
                                yield chunk
            except Exception as exc:
                yield _sse({"error": {"message": f"upstream error: {exc}"}})
                yield b"data: [DONE]\n\n"
                return
            _deduct(user_id, price, model)

        return StreamingResponse(upstream_gen(), media_type="text/event-stream")

    fwd["stream"] = False
    try:
        with _client(upstream_base, timeout=120) as client:
            resp = client.post(url, json=fwd, headers=headers)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"upstream error: {exc}") from exc
    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)
    try:
        result = resp.json()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"invalid upstream response ({resp.status_code}): {resp.text[:500]}",
        ) from exc
    result["torch_credits_remaining"] = _deduct(user_id, price, model)
    return result


# --------------------------------------------------------------------------
# Admin (X-Admin-Token)
# --------------------------------------------------------------------------
class ModelUpsert(BaseModel):
    model: str
    upstream_base_url: str
    upstream_model: Optional[str] = None
    upstream_api_key: Optional[str] = None
    price: int = 1
    enabled: bool = True


class CreditAdjust(BaseModel):
    delta: int
    reason: str = "admin_adjust"


@app.get("/admin/models")
def admin_list_models(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        rows = conn.execute("SELECT * FROM model_catalog ORDER BY id").fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["upstream_api_key"] = "***" if d.get("upstream_api_key") else ""
        out.append(d)
    return {"data": out}


@app.post("/admin/models")
def admin_upsert_model(
    payload: ModelUpsert, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        conn.execute(
            "INSERT INTO model_catalog(model, upstream_base_url, upstream_model,"
            " upstream_api_key, price, enabled, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s)"
            " ON CONFLICT (model) DO UPDATE SET"
            " upstream_base_url = EXCLUDED.upstream_base_url,"
            " upstream_model = EXCLUDED.upstream_model,"
            " upstream_api_key = EXCLUDED.upstream_api_key,"
            " price = EXCLUDED.price, enabled = EXCLUDED.enabled",
            (
                payload.model,
                payload.upstream_base_url,
                payload.upstream_model,
                payload.upstream_api_key,
                int(payload.price),
                1 if payload.enabled else 0,
                int(time.time()),
            ),
        )
    return {"status": "ok", "model": payload.model}


@app.delete("/admin/models/{model_id}")
def admin_delete_model(
    model_id: int, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        conn.execute("DELETE FROM model_catalog WHERE id = %s", (model_id,))
    return {"status": "ok"}


@app.get("/admin/users")
def admin_list_users(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, username, email, balance, created_at FROM users ORDER BY id"
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@app.post("/admin/users/{user_id}/credits")
def admin_adjust_credits(
    user_id: int,
    payload: CreditAdjust,
    x_admin_token: Optional[str] = Header(default=None),
) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        user = conn.execute("SELECT id FROM users WHERE id = %s", (user_id,)).fetchone()
        if user is None:
            raise HTTPException(status_code=404, detail="user not found")
        _grant(conn, user_id, int(payload.delta), payload.reason)
        balance = conn.execute(
            "SELECT balance FROM users WHERE id = %s", (user_id,)
        ).fetchone()["balance"]
    return {"status": "ok", "balance": balance}


# --------------------------------------------------------------------------
# Admin — payment config, recharge packages, orders
# --------------------------------------------------------------------------
class PackageUpsert(BaseModel):
    id: Optional[int] = None
    title: str
    amount_fen: int
    credits: int
    sort_order: int = 0
    enabled: int = 1


@app.get("/admin/payment")
def admin_get_payment(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        return _mask_payment(_payment_all(conn))


@app.post("/admin/payment")
def admin_set_payment(
    payload: dict, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    unknown = set(payload) - _PAYMENT_KEYS
    if unknown:
        raise HTTPException(status_code=400, detail=f"unknown keys: {sorted(unknown)}")
    with _db() as conn:
        for k, v in payload.items():
            v = str(v)
            # Blank / masked secret means "leave the stored value untouched".
            if k in _PAYMENT_SECRET_KEYS and v in {"", "***"}:
                continue
            conn.execute(
                "INSERT INTO payment_config(key, value) VALUES (%s,%s)"
                " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                (k, v),
            )
        return _mask_payment(_payment_all(conn))


@app.get("/admin/wechat")
def admin_get_wechat(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        return _mask_auth(_auth_all(conn))


@app.post("/admin/wechat")
def admin_set_wechat(
    payload: dict, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    unknown = set(payload) - _AUTH_KEYS
    if unknown:
        raise HTTPException(status_code=400, detail=f"unknown keys: {sorted(unknown)}")
    with _db() as conn:
        for k, v in payload.items():
            v = str(v)
            # Blank / masked secret means "leave the stored value untouched".
            if k in _AUTH_SECRET_KEYS and v in {"", "***"}:
                continue
            conn.execute(
                "INSERT INTO auth_config(key, value) VALUES (%s,%s)"
                " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                (k, v),
            )
        return _mask_auth(_auth_all(conn))


@app.get("/admin/packages")
def admin_list_packages(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        rows = conn.execute(
            "SELECT id, title, amount_fen, credits, sort_order, enabled"
            " FROM recharge_packages ORDER BY sort_order, id"
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


@app.post("/admin/packages")
def admin_upsert_package(
    payload: PackageUpsert, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        if payload.id is None:
            conn.execute(
                "INSERT INTO recharge_packages(title, amount_fen, credits, sort_order,"
                " enabled, created_at) VALUES (%s,%s,%s,%s,%s,%s)",
                (payload.title, int(payload.amount_fen), int(payload.credits),
                 payload.sort_order, payload.enabled, int(time.time())),
            )
        else:
            conn.execute(
                "UPDATE recharge_packages SET title=%s, amount_fen=%s, credits=%s,"
                " sort_order=%s, enabled=%s WHERE id=%s",
                (payload.title, int(payload.amount_fen), int(payload.credits),
                 payload.sort_order, payload.enabled, payload.id),
            )
    return {"ok": True}


@app.delete("/admin/packages/{pid}")
def admin_delete_package(
    pid: int, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        conn.execute("DELETE FROM recharge_packages WHERE id = %s", (pid,))
    return {"ok": True}


@app.get("/admin/orders")
def admin_list_orders(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        rows = conn.execute(
            "SELECT o.id, o.out_trade_no, o.user_id, u.email, o.provider, o.amount_fen,"
            " o.credits, o.status, o.transaction_id, o.created_at, o.paid_at"
            " FROM orders o JOIN users u ON u.id = o.user_id"
            " ORDER BY o.id DESC LIMIT 100"
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


# --------------------------------------------------------------------------
# Desktop client build (远程触发 GitHub Actions 打包 + 读取 COS 下载清单)
# --------------------------------------------------------------------------
class BuildTrigger(BaseModel):
    platforms: list[str] = []


@app.get("/admin/build/config")
def admin_get_build(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        return _mask_build(_build_all(conn))


@app.post("/admin/build/config")
def admin_set_build(
    payload: dict, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    unknown = set(payload) - _BUILD_KEYS
    if unknown:
        raise HTTPException(status_code=400, detail=f"unknown keys: {sorted(unknown)}")
    with _db() as conn:
        for k, v in payload.items():
            v = str(v)
            if k in _BUILD_SECRET_KEYS and v in {"", "***"}:
                continue
            conn.execute(
                "INSERT INTO build_config(key, value) VALUES (%s,%s)"
                " ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
                (k, v),
            )
        return _mask_build(_build_all(conn))


@app.post("/admin/build/trigger")
def admin_build_trigger(
    payload: BuildTrigger, x_admin_token: Optional[str] = Header(default=None)
) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        cfg = _build_all(conn)
    repo = (cfg.get("github_repo") or "").strip()
    token = (cfg.get("github_token") or "").strip()
    workflow = (cfg.get("github_workflow") or "").strip() or "torch-desktop.yml"
    ref = (cfg.get("github_ref") or "").strip() or "main"
    if not repo or not token:
        raise HTTPException(status_code=400, detail="请先填写并保存 GitHub 仓库和 Token")
    allowed = {"mac-arm64", "mac-x64", "win-x64", "win-ia32", "linux-x64"}
    picked = [p for p in payload.platforms if p in allowed]
    inputs = {"runtime_ref": "main", "platforms": ",".join(picked)}
    url = f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches"
    try:
        with _client("https://api.github.com") as c:
            r = c.post(url, headers=_github_headers(token), json={"ref": ref, "inputs": inputs})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"无法连接 GitHub: {e}")
    if r.status_code not in (201, 204):
        raise HTTPException(
            status_code=502, detail=f"GitHub 触发失败({r.status_code}):{r.text[:300]}"
        )
    return {"ok": True, "platforms": picked or ["all"]}


@app.get("/admin/build/status")
def admin_build_status(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        cfg = _build_all(conn)
    repo = (cfg.get("github_repo") or "").strip()
    token = (cfg.get("github_token") or "").strip()
    workflow = (cfg.get("github_workflow") or "").strip() or "torch-desktop.yml"
    if not repo or not token:
        return {"configured": False, "runs": []}
    url = (
        f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/runs"
        "?per_page=8"
    )
    try:
        with _client("https://api.github.com") as c:
            r = c.get(url, headers=_github_headers(token))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"无法连接 GitHub: {e}")
    if r.status_code != 200:
        raise HTTPException(
            status_code=502, detail=f"GitHub 查询失败({r.status_code}):{r.text[:300]}"
        )
    runs = [
        {
            "id": w.get("id"),
            "status": w.get("status"),
            "conclusion": w.get("conclusion"),
            "event": w.get("event"),
            "created_at": w.get("created_at"),
            "html_url": w.get("html_url"),
        }
        for w in r.json().get("workflow_runs", [])
    ]
    return {"configured": True, "runs": runs}


@app.get("/admin/build/downloads")
def admin_build_downloads(x_admin_token: Optional[str] = Header(default=None)) -> dict:
    _require_admin(x_admin_token)
    with _db() as conn:
        cfg = _build_all(conn)
    base = (cfg.get("cos_base_url") or "").strip().rstrip("/")
    if not base:
        return {"configured": False, "files": []}
    url = f"{base}/clients/latest/manifest.json"
    try:
        with _client(base) as c:
            r = c.get(url)
    except Exception as e:
        return {"configured": True, "files": [], "note": f"读取清单失败:{e}"}
    if r.status_code != 200:
        return {"configured": True, "files": [], "note": f"暂无安装包清单({r.status_code})"}
    try:
        data = r.json()
    except Exception:
        return {"configured": True, "files": [], "note": "清单格式无效"}
    return {
        "configured": True,
        "files": data.get("files", []),
        "generated_at": data.get("generated_at"),
    }


if __name__ == "__main__":
    host = os.getenv("TORCH_HOST", "127.0.0.1")
    port = int(os.getenv("TORCH_PORT", "8080"))
    uvicorn.run(app, host=host, port=port)
