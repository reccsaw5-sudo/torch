"""Torch business backend — standalone service (the customer-facing server).

This is NOT a Hermes plugin. It is your own product server that the branded
client talks to. Run it separately from Hermes' internal dashboard:

    python torch-server/app.py            # 127.0.0.1:8080
    # or: uvicorn app:app --app-dir torch-server --port 8080

Storage: PostgreSQL (both the client-facing "前台" endpoints and the admin
"后台" endpoints share this one database).

Responsibilities:
- Store: users / api_keys (account token) / brand config
- Auth endpoints: register/login (email + password) + 微信订阅号登录 -> issues an
  account token (used for /account/*). Inference does NOT run through this
  server: the client uses the brand `api_base_url` + the user's own API key(s).
  No credits, no metering, no payment.
- Admin endpoints (X-Admin-Token): users, brand, suggestions, skills, build
- Brand center: /brand (public read, includes api_base_url) + /admin/brand

Env overrides (no code change needed):
  TORCH_DATABASE_URL       default postgresql://torch:torch@127.0.0.1:5433/torch
  TORCH_ADMIN_TOKEN        default dev-admin
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
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from typing import Optional
from urllib.parse import parse_qsl, urlparse

import httpx
import uvicorn
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from pydantic import BaseModel

DATABASE_URL = os.getenv(
    "TORCH_DATABASE_URL", "postgresql://torch:torch@127.0.0.1:5433/torch"
)
ADMIN_TOKEN = os.getenv("TORCH_ADMIN_TOKEN", "dev-admin")
PUBLIC_BASE = os.getenv("TORCH_PUBLIC_BASE", "http://127.0.0.1:8080").rstrip("/")

# Brand center — every value here is editable from the admin API and read by
# the client (icon/name/version) and the official website (site name/links).
# The desktop packaging pipeline reads /brand to stamp the built app.
#   api_base_url  内置推理地址(OpenAI 兼容),客户端锁定只读、用户自带 Key。
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
    "api_base_url": "",
}
_BRAND_KEYS = set(_BRAND_DEFAULTS)

# WeChat 订阅号登录 (未认证订阅号 / 关注 + 发验证码登录). Editable from admin.
# Inert until enabled=1 with a server-config Token. Flow: the client shows the
# uploaded follow-QR (`wechat_mp_qr`, a data URL) + a 6-digit code; the user
# follows the account and sends the code to it; the account's message webhook
# (/wechat/mp/callback, 明文模式) receives {OpenID, code}, matches the pending
# login session, binds the OpenID and logs in.
#   wechat_mp_enabled  on/off
#   wechat_mp_token    服务器配置 Token (used for signature verification)
#   wechat_mp_appid    订阅号 AppID (optional, informational)
#   wechat_mp_qr       uploaded follow-QR image, stored inline as a data URL
WECHAT_LOGIN_DEFAULTS: dict[str, str] = {
    "wechat_mp_enabled": "0",
    "wechat_mp_token": "",
    "wechat_mp_appid": "",
    "wechat_mp_qr": "",
}
_AUTH_KEYS = set(WECHAT_LOGIN_DEFAULTS)
_AUTH_SECRET_KEYS = {"wechat_mp_token"}

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
    # 订阅号登录:用户把这个 6 位码发给公众号,webhook 靠它匹配 pending 会话。
    "ALTER TABLE wechat_login_states ADD COLUMN IF NOT EXISTS code TEXT",
    "CREATE INDEX IF NOT EXISTS idx_wls_code ON wechat_login_states(code)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS wx_openid TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS wx_unionid TEXT",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wx_openid ON users(wx_openid)"
    " WHERE wx_openid IS NOT NULL",
    # 去积分/支付:改为「用户自带 Key」后,清掉计费相关的表与列。
    "DROP TABLE IF EXISTS orders CASCADE",
    "DROP TABLE IF EXISTS recharge_packages CASCADE",
    "DROP TABLE IF EXISTS credits_ledger CASCADE",
    "DROP TABLE IF EXISTS payment_config CASCADE",
    "ALTER TABLE users DROP COLUMN IF EXISTS balance",
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


def _user_by_key(conn, api_key: str):
    return conn.execute(
        "SELECT u.* FROM users u JOIN api_keys k ON k.user_id = u.id"
        " WHERE k.api_key = %s AND k.revoked = 0",
        (api_key,),
    ).fetchone()


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


def _wechat_mp_enabled(cfg: dict) -> bool:
    return cfg.get("wechat_mp_enabled") == "1" and bool(cfg.get("wechat_mp_token"))


def _wechat_mp_signature(token: str, timestamp: str, nonce: str) -> str:
    """WeChat server-config signature: sha1 of the sorted [token,timestamp,nonce]."""
    joined = "".join(sorted([token or "", timestamp or "", nonce or ""]))
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()


def _wechat_mp_reply(to_user: str, from_user: str, content: str) -> Response:
    """明文模式被动回复(公众号 -> 用户):ToUserName/FromUserName 相对入站消息互换。"""
    body = (
        "<xml>"
        f"<ToUserName><![CDATA[{to_user}]]></ToUserName>"
        f"<FromUserName><![CDATA[{from_user}]]></FromUserName>"
        f"<CreateTime>{int(time.time())}</CreateTime>"
        "<MsgType><![CDATA[text]]></MsgType>"
        f"<Content><![CDATA[{content}]]></Content>"
        "</xml>"
    )
    return Response(content=body, media_type="application/xml")


def _wechat_mp_new_code(conn) -> str:
    """Allocate a 6-digit login code not currently held by a pending session."""
    for _ in range(20):
        code = f"{secrets.randbelow(1_000_000):06d}"
        exists = conn.execute(
            "SELECT 1 FROM wechat_login_states"
            " WHERE code = %s AND status = 'pending'",
            (code,),
        ).fetchone()
        if exists is None:
            return code
    return f"{secrets.randbelow(1_000_000):06d}"


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
        "INSERT INTO users(email, password_hash, username, created_at,"
        " wx_openid, wx_unionid) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
        (email, pw, username, int(time.time()), openid, unionid or None),
    ).fetchone()["id"]
    return conn.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()


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
    return {"status": "ok", "service": "torch-server"}


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
# Auth (email + password) — issues an account token (used for /account/*).
# Inference no longer runs through this server: the client uses the brand
# `api_base_url` + the user's own API key(s). No credits, no metering.
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
    # api_key here is the ACCOUNT token (Bearer for /account/*), not an
    # inference key — inference uses the brand api_base_url + the user's key.
    api_key = _ensure_key(conn, user["id"])
    return {
        "api_key": api_key,
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
            "INSERT INTO users(email, password_hash, username, created_at)"
            " VALUES (%s,%s,%s,%s) RETURNING id",
            (email, _hash_password(payload.password), username, int(time.time())),
        ).fetchone()["id"]
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
    return {"user": {"username": user["username"], "email": user["email"]}}


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
# WeChat 订阅号登录 (client-facing; 关注 + 发送 6 位验证码 + 消息 webhook 校验)
# 未认证订阅号可用:接收消息 + 被动回复(明文模式),不需要 OAuth / 带参二维码。
# --------------------------------------------------------------------------
@app.get("/auth/wechat/config")
def wechat_login_config_public() -> dict:
    with _db() as conn:
        cfg = _auth_all(conn)
    return {
        "enabled": _wechat_mp_enabled(cfg),
        "qr_image": cfg.get("wechat_mp_qr") or "",
    }


@app.post("/auth/wechat/qr")
def wechat_login_qr() -> dict:
    with _db() as conn:
        cfg = _auth_all(conn)
        if not _wechat_mp_enabled(cfg):
            raise HTTPException(status_code=400, detail="微信登录未开通")
        state = secrets.token_urlsafe(24)
        code = _wechat_mp_new_code(conn)
        conn.execute(
            "INSERT INTO wechat_login_states(state, status, created_at, code)"
            " VALUES (%s,'pending',%s,%s)",
            (state, int(time.time()), code),
        )
    return {
        "state": state,
        "code": code,
        "qr_image": cfg.get("wechat_mp_qr") or "",
        "expires_in": 600,
    }


@app.get("/wechat/mp/callback")
def wechat_mp_verify(
    signature: str = "", timestamp: str = "", nonce: str = "", echostr: str = ""
) -> Response:
    """微信服务器配置校验:签名通过后原样回显 echostr。"""
    with _db() as conn:
        token = _auth_all(conn).get("wechat_mp_token") or ""
    if token and _wechat_mp_signature(token, timestamp, nonce) == signature:
        return Response(content=echostr, media_type="text/plain")
    return Response(content="", media_type="text/plain", status_code=403)


@app.post("/wechat/mp/callback")
async def wechat_mp_message(request: Request) -> Response:
    """接收订阅号消息(明文模式):文本为 6 位验证码则完成登录并绑定 OpenID。"""
    q = request.query_params
    raw = await request.body()
    with _db() as conn:
        token = _auth_all(conn).get("wechat_mp_token") or ""
    sig = _wechat_mp_signature(token, q.get("timestamp", ""), q.get("nonce", ""))
    if not token or sig != q.get("signature", ""):
        return Response(content="", media_type="text/plain", status_code=403)
    try:
        root = ET.fromstring(raw.decode("utf-8"))
    except Exception:
        return Response(content="success", media_type="text/plain")

    def _field(tag: str) -> str:
        el = root.find(tag)
        return (el.text or "").strip() if el is not None else ""

    openid = _field("FromUserName")  # 发送者 = 用户 OpenID
    mp_id = _field("ToUserName")  # 公众号原始 ID
    msg_type = _field("MsgType")
    content = _field("Content")
    event = _field("Event").lower()

    if not openid or not mp_id:
        return Response(content="success", media_type="text/plain")

    if msg_type == "event" and event == "subscribe":
        return _wechat_mp_reply(
            openid,
            mp_id,
            "感谢关注!请把登录页面上显示的 6 位验证码发给我,即可完成登录。",
        )

    if msg_type == "text" and content.isdigit() and len(content) == 6:
        now = int(time.time())
        with _db() as conn:
            st = conn.execute(
                "SELECT * FROM wechat_login_states"
                " WHERE code = %s AND status = 'pending'"
                " ORDER BY created_at DESC LIMIT 1",
                (content,),
            ).fetchone()
            if st is None or now - int(st["created_at"]) > 600:
                return _wechat_mp_reply(
                    openid, mp_id, "验证码无效或已过期,请回到登录页重新获取。"
                )
            user = _wechat_get_or_create_user(conn, openid, "", "")
            result = _session_result(conn, user)
            conn.execute(
                "UPDATE wechat_login_states SET status = 'done', result = %s"
                " WHERE state = %s",
                (json.dumps(result), st["state"]),
            )
        return _wechat_mp_reply(openid, mp_id, "登录成功,请返回应用。")

    return _wechat_mp_reply(
        openid, mp_id, "请把登录页面上显示的 6 位验证码发给我完成登录。"
    )


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
# Admin (X-Admin-Token)
# --------------------------------------------------------------------------
class ModelUpsert(BaseModel):
    model: str
    upstream_base_url: str
    upstream_model: Optional[str] = None
    upstream_api_key: Optional[str] = None
    price: int = 1
    enabled: bool = True


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
            "SELECT id, username, email, created_at FROM users ORDER BY id"
        ).fetchall()
    return {"data": [dict(r) for r in rows]}


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
