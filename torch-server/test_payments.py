"""
Money-safety tests for the recharge/payment flow.

Run against the dev Postgres (torch-pg :5433):
    cd torch-server && ../.venv/bin/python -m pytest test_payments.py -q
or standalone:
    cd torch-server && ../.venv/bin/python test_payments.py
"""
from __future__ import annotations

import time

from fastapi.testclient import TestClient

import app

ADMIN = {"X-Admin-Token": "dev-admin"}
client = TestClient(app.app)


def _register():
    email = f"pay_{int(time.time() * 1000)}@example.com"
    res = client.post("/auth/register", json={"email": email, "password": "secret123"})
    assert res.status_code == 200, res.text
    data = res.json()
    return data["api_key"], data["credits"]


def _balance(api_key: str) -> int:
    res = client.get("/account/info", headers={"Authorization": f"Bearer {api_key}"})
    assert res.status_code == 200, res.text
    return res.json()["credits"]


def _make_order(api_key: str, amount_fen: int, credits: int, provider="wechat") -> str:
    """Insert a pending order directly (bypassing the provider network call)."""
    with app._db() as conn:
        user = app._user_by_key(conn, api_key)
        out_trade_no = "TEST" + str(int(time.time() * 1000))
        conn.execute(
            "INSERT INTO orders(out_trade_no, user_id, package_id, provider,"
            " amount_fen, credits, status, created_at) VALUES (%s,%s,%s,%s,%s,%s,'pending',%s)",
            (out_trade_no, user["id"], None, provider, amount_fen, credits, int(time.time())),
        )
    return out_trade_no


def test_billing_config_lists_packages():
    api_key, _ = _register()
    res = client.get("/billing/config", headers={"Authorization": f"Bearer {api_key}"})
    assert res.status_code == 200, res.text
    body = res.json()
    # No provider configured in a fresh dev DB -> disabled, but packages seed.
    assert body["enabled"] is False
    assert body["providers"] == []
    assert len(body["packages"]) >= 1
    assert all("amount_fen" in p and "credits" in p for p in body["packages"])


def test_order_requires_enabled_provider():
    api_key, _ = _register()
    cfg = client.get("/billing/config", headers={"Authorization": f"Bearer {api_key}"}).json()
    pkg_id = cfg["packages"][0]["id"]
    res = client.post(
        "/billing/order",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"package_id": pkg_id, "provider": "wechat"},
    )
    assert res.status_code == 400  # provider not enabled


def test_credit_is_idempotent():
    api_key, start = _register()
    otn = _make_order(api_key, amount_fen=990, credits=1000)

    assert app._credit_paid_order(otn, "wechat", 990, "txn-1") is True
    after_first = _balance(api_key)
    assert after_first == start + 1000

    # A retried notification for the same order must NOT credit again.
    assert app._credit_paid_order(otn, "wechat", 990, "txn-1") is True
    assert _balance(api_key) == after_first


def test_amount_mismatch_is_rejected():
    api_key, start = _register()
    otn = _make_order(api_key, amount_fen=990, credits=1000)

    # Paid amount doesn't match the order -> refuse to credit, mark failed.
    assert app._credit_paid_order(otn, "wechat", 1, "txn-x") is False
    assert _balance(api_key) == start
    with app._db() as conn:
        row = conn.execute(
            "SELECT status FROM orders WHERE out_trade_no = %s", (otn,)
        ).fetchone()
    assert row["status"] == "failed"


def test_wrong_provider_does_not_credit():
    api_key, start = _register()
    otn = _make_order(api_key, amount_fen=990, credits=1000, provider="wechat")
    assert app._credit_paid_order(otn, "alipay", 990, "txn-y") is False
    assert _balance(api_key) == start


def test_order_status_scoped_to_owner():
    api_key, _ = _register()
    otn = _make_order(api_key, amount_fen=990, credits=1000)
    res = client.get(
        f"/billing/order/{otn}", headers={"Authorization": f"Bearer {api_key}"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "pending"

    other_key, _ = _register()
    res2 = client.get(
        f"/billing/order/{otn}", headers={"Authorization": f"Bearer {other_key}"}
    )
    assert res2.status_code == 404


def test_change_username():
    api_key, _ = _register()
    res = client.post(
        "/account/username",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"username": "新名字"},
    )
    assert res.status_code == 200, res.text
    info = client.get("/account/info", headers={"Authorization": f"Bearer {api_key}"}).json()
    assert info["user"]["username"] == "新名字"

    empty = client.post(
        "/account/username",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"username": "   "},
    )
    assert empty.status_code == 400


def test_change_password():
    email = f"pw_{int(time.time() * 1000)}@example.com"
    reg = client.post("/auth/register", json={"email": email, "password": "oldpass1"})
    api_key = reg.json()["api_key"]

    # Wrong old password is rejected.
    bad = client.post(
        "/account/password",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"old_password": "nope", "new_password": "newpass1"},
    )
    assert bad.status_code == 400

    ok = client.post(
        "/account/password",
        headers={"Authorization": f"Bearer {api_key}"},
        json={"old_password": "oldpass1", "new_password": "newpass1"},
    )
    assert ok.status_code == 200, ok.text

    # Old password no longer logs in; new one does.
    assert client.post("/auth/login", json={"email": email, "password": "oldpass1"}).status_code == 401
    assert client.post("/auth/login", json={"email": email, "password": "newpass1"}).status_code == 200


def test_my_orders_scoped():
    api_key, _ = _register()
    otn = _make_order(api_key, amount_fen=990, credits=1000)
    res = client.get("/billing/orders", headers={"Authorization": f"Bearer {api_key}"})
    assert res.status_code == 200, res.text
    orders = res.json()["data"]
    assert any(o["out_trade_no"] == otn for o in orders)

    other_key, _ = _register()
    others = client.get("/billing/orders", headers={"Authorization": f"Bearer {other_key}"}).json()["data"]
    assert all(o["out_trade_no"] != otn for o in others)


def test_admin_packages_and_payment_config():
    # Packages CRUD
    res = client.post(
        "/admin/packages",
        headers=ADMIN,
        json={"title": "测试包", "amount_fen": 100, "credits": 50, "sort_order": 99},
    )
    assert res.status_code == 200, res.text
    listing = client.get("/admin/packages", headers=ADMIN).json()["data"]
    assert any(p["title"] == "测试包" for p in listing)

    # Payment config: secrets are masked on read and preserved on masked write.
    client.post("/admin/payment", headers=ADMIN, json={"wechat_api_v3_key": "supersecret"})
    got = client.get("/admin/payment", headers=ADMIN).json()
    assert got["wechat_api_v3_key"] == "***"
    # Writing back the mask must not wipe the stored secret.
    client.post("/admin/payment", headers=ADMIN, json={"wechat_api_v3_key": "***", "currency": "CNY"})
    with app._db() as conn:
        cfg = app._payment_all(conn)
    assert cfg["wechat_api_v3_key"] == "supersecret"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("all payment tests passed")
