#!/usr/bin/env python3
"""根据 platforms 输入(逗号分隔,留空=全部)生成 torch-desktop 的构建矩阵。

在 setup 任务里运行,把 matrix JSON 写到 GITHUB_OUTPUT。GitHub 的 job 级 if
不允许引用 matrix,所以改用动态矩阵:按后台勾选的平台筛出要构建的腿。
"""
from __future__ import annotations

import json
import os

LEGS = [
    {"name": "mac-arm64", "os": "macos-14", "args": "--mac dmg zip --arm64"},
    {"name": "mac-x64", "os": "macos-13", "args": "--mac dmg zip --x64"},
    {"name": "win-x64", "os": "windows-latest", "args": "--win nsis msi --x64"},
    {"name": "win-ia32", "os": "windows-latest", "args": "--win nsis --ia32"},
    {"name": "linux-x64", "os": "ubuntu-latest", "args": "--linux AppImage deb rpm"},
]


def main() -> None:
    sel = (os.getenv("PLATFORMS") or "").strip()
    picked = [x.strip() for x in sel.split(",") if x.strip()]
    chosen = [leg for leg in LEGS if leg["name"] in picked] if picked else LEGS
    if not chosen:
        chosen = LEGS
    line = "matrix=" + json.dumps({"include": chosen})
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    print(line)


if __name__ == "__main__":
    main()
