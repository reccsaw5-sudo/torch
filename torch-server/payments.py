"""
Payment provider adapters for the Torch backend.

Pure provider I/O + crypto — no database access. `app.py` owns the orders
table, credit ledger, and orchestration; this module only knows how to:

  - create a WeChat Pay "Native" (scan-to-pay) order and return its code_url
  - create an Alipay "当面付" (face-to-face precreate) order and return its qr
  - verify + parse the async payment notifications each provider posts back

Signature verification lives here and is the ONLY thing that authorizes a
credit top-up in app.py — a notification that fails verification must never
credit an account.

Both providers are optional and fully config-driven: nothing here runs until
the admin fills in real merchant credentials (see PAYMENT_DEFAULTS in app.py).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

import segno

logger = logging.getLogger("torch.payments")


# --------------------------------------------------------------------------
# QR rendering
# --------------------------------------------------------------------------
def render_qr(text: str) -> str:
    """Return an inline SVG data-URI QR code for `text` (provider code_url)."""
    return segno.make(text, error="m").svg_data_uri(scale=5, border=2)


def fen_to_yuan(amount_fen: int) -> str:
    """Alipay wants yuan as a 2-decimal string; WeChat wants integer fen."""
    return f"{amount_fen / 100:.2f}"


# --------------------------------------------------------------------------
# WeChat Pay (Native / scan-to-pay, API v3)
# --------------------------------------------------------------------------
def _wechat_client(cfg: dict, notify_url: str, cert_dir: str):
    from wechatpayv3 import WeChatPay, WeChatPayType  # noqa: PLC0415

    os.makedirs(cert_dir, exist_ok=True)
    client = WeChatPay(
        wechatpay_type=WeChatPayType.NATIVE,
        mchid=cfg["wechat_mchid"],
        private_key=cfg["wechat_private_key"],
        cert_serial_no=cfg["wechat_cert_serial_no"],
        appid=cfg["wechat_appid"],
        apiv3_key=cfg["wechat_api_v3_key"],
        notify_url=notify_url,
        cert_dir=cert_dir,
        logger=logger,
    )
    return client, WeChatPayType


def wechat_native_order(
    cfg: dict,
    *,
    out_trade_no: str,
    amount_fen: int,
    description: str,
    notify_url: str,
    cert_dir: str,
) -> str:
    """Create a Native order and return its `code_url` (encode as QR client-side)."""
    import json  # noqa: PLC0415

    client, WeChatPayType = _wechat_client(cfg, notify_url, cert_dir)
    code, message = client.pay(
        description=description,
        out_trade_no=out_trade_no,
        amount={"total": int(amount_fen)},
        pay_type=WeChatPayType.NATIVE,
    )
    if code != 200:
        raise RuntimeError(f"wechat native order failed ({code}): {message}")
    data = json.loads(message)
    code_url = data.get("code_url")
    if not code_url:
        raise RuntimeError(f"wechat native order missing code_url: {message}")
    return code_url


def wechat_parse_notify(
    cfg: dict, *, headers: dict, body: bytes, cert_dir: str
) -> Optional[dict]:
    """Verify + decrypt a WeChat notification. Returns a normalized dict or None."""
    client, _ = _wechat_client(cfg, "", cert_dir)
    try:
        result = client.callback(headers, body)
    except Exception as exc:  # signature / decrypt failure
        logger.warning("wechat callback verification failed: %s", exc)
        return None
    if not result:
        return None
    resource = result.get("resource") or {}
    out_trade_no = resource.get("out_trade_no")
    if not out_trade_no:
        return None
    amount = resource.get("amount") or {}
    trade_state = resource.get("trade_state")
    return {
        "out_trade_no": out_trade_no,
        "transaction_id": resource.get("transaction_id") or "",
        "amount_fen": int(amount.get("total") or 0),
        "success": result.get("event_type") == "TRANSACTION.SUCCESS"
        and trade_state == "SUCCESS",
    }


# --------------------------------------------------------------------------
# Alipay (当面付 / face-to-face precreate)
# --------------------------------------------------------------------------
def _alipay_client(cfg: dict, notify_url: str):
    from alipay import AliPay  # noqa: PLC0415
    from alipay.utils import AliPayConfig  # noqa: PLC0415

    return AliPay(
        appid=cfg["alipay_appid"],
        app_notify_url=notify_url or None,
        app_private_key_string=cfg["alipay_app_private_key"],
        alipay_public_key_string=cfg["alipay_public_key"],
        sign_type="RSA2",
        debug=str(cfg.get("alipay_sandbox", "0")) in {"1", "true", "True"},
        config=AliPayConfig(timeout=15),
    )


def alipay_precreate(
    cfg: dict,
    *,
    out_trade_no: str,
    amount_fen: int,
    subject: str,
    notify_url: str,
) -> str:
    """Create a precreate order and return its `qr_code` (encode as QR client-side)."""
    client = _alipay_client(cfg, notify_url)
    result = client.api_alipay_trade_precreate(
        subject=subject,
        out_trade_no=out_trade_no,
        total_amount=fen_to_yuan(amount_fen),
        notify_url=notify_url or None,
    )
    if result.get("code") != "10000":
        raise RuntimeError(
            f"alipay precreate failed ({result.get('code')}): {result.get('sub_msg') or result.get('msg')}"
        )
    qr = result.get("qr_code")
    if not qr:
        raise RuntimeError(f"alipay precreate missing qr_code: {result}")
    return qr


def alipay_parse_notify(cfg: dict, *, form: dict) -> Optional[dict]:
    """Verify an Alipay async notification signature. Returns a normalized dict or None."""
    client = _alipay_client(cfg, "")
    data = dict(form)
    signature = data.pop("sign", None)
    data.pop("sign_type", None)
    if not signature:
        return None
    try:
        verified = client.verify(data, signature)
    except Exception as exc:
        logger.warning("alipay notify verification error: %s", exc)
        return None
    if not verified:
        return None
    out_trade_no = data.get("out_trade_no")
    if not out_trade_no:
        return None
    try:
        amount_fen = round(float(data.get("total_amount") or 0) * 100)
    except (TypeError, ValueError):
        amount_fen = 0
    return {
        "out_trade_no": out_trade_no,
        "transaction_id": data.get("trade_no") or "",
        "amount_fen": amount_fen,
        "success": data.get("trade_status") in {"TRADE_SUCCESS", "TRADE_FINISHED"},
    }
