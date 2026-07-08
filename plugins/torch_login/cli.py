"""`hermes torch <login|status|logout>` CLI wiring for the branded client."""

from __future__ import annotations

import argparse

from plugins.torch_login import casdoor_oauth as oauth


def register_cli(subparser: argparse.ArgumentParser) -> None:
    sub = subparser.add_subparsers(dest="torch_command", metavar="<command>")

    p_login = sub.add_parser("login", help="Sign in via the browser (Casdoor)")
    p_login.add_argument(
        "--no-browser", action="store_true",
        help="Print the auth URL instead of opening a browser",
    )
    p_login.add_argument(
        "--timeout", type=float, default=300.0,
        help="Seconds to wait for browser authorization (default 300)",
    )

    sub.add_parser("status", help="Show current signed-in account")
    sub.add_parser("logout", help="Clear stored credentials")


def torch_command(args) -> None:
    command = getattr(args, "torch_command", None)

    if command == "login":
        try:
            record = oauth.login(
                open_browser=not getattr(args, "no_browser", False),
                timeout=getattr(args, "timeout", 300.0),
            )
        except Exception as exc:
            print(f"登录失败：{exc}")
            raise SystemExit(1)
        user = (record or {}).get("user", {})
        who = user.get("name") or user.get("preferred_username") or user.get("sub") or "?"
        print(f"登录成功：{who}")
        return

    if command == "status":
        record = oauth.load_credentials()
        if not record:
            print("未登录。运行 `hermes torch login`。")
            return
        user = record.get("user", {})
        who = user.get("name") or user.get("preferred_username") or user.get("sub") or "?"
        print(f"已登录：{who}")
        print(f"  端点：{record.get('endpoint')}")
        exp = record.get("expires_at") or 0
        print(f"  access_token 过期时间戳：{exp if exp else '未知'}")
        return

    if command == "logout":
        print("已退出登录。" if oauth.logout() else "本来就未登录。")
        return

    print("用法：hermes torch <login|status|logout>")
