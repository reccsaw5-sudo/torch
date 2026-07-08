#!/usr/bin/env python3
"""把打好的 Torch 桌面安装包上传到腾讯云 COS,并写一份 manifest.json。

在 torch-desktop 工作流的 publish-cos 阶段运行(所有平台构建完成之后):
- 从 ./dist 读取各平台安装包(GitHub artifact 下载下来的,按 torch-<平台>/ 分目录)
- 逐个用 coscmd 上传到 COS 的 clients/latest/
- 生成 manifest.json(每个安装包的平台/文件名/公开下载地址),同样上传到 COS

后台"客户端构建"页通过服务端读取这份 manifest 来展示下载链接。

依赖:coscmd(工作流里 pip 安装并 `coscmd config` 配好密钥后再调用本脚本)。
需要的环境变量:COS_BUCKET、COS_REGION,可选 COS_BASE_URL(自定义域名/CDN)。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

INSTALLER_EXTS = {".dmg", ".zip", ".exe", ".msi", ".AppImage", ".deb", ".rpm"}
COS_PREFIX = "clients/latest"


def _base_url() -> str:
    base = (os.getenv("COS_BASE_URL") or "").strip().rstrip("/")
    if base:
        return base
    bucket = os.environ["COS_BUCKET"]
    region = os.environ["COS_REGION"]
    return f"https://{bucket}.cos.{region}.myqcloud.com"


def _platform_of(path: Path) -> str:
    # artifact 下载后目录名为 torch-<平台>,如 torch-mac-arm64/Torch-...dmg
    parent = path.parent.name
    return parent[len("torch-"):] if parent.startswith("torch-") else ""


def _coscmd_upload(local: Path, key: str) -> None:
    subprocess.run(["coscmd", "upload", str(local), key], check=True)


def main() -> int:
    dist = Path("dist")
    files = sorted(
        p for p in dist.rglob("*") if p.is_file() and p.suffix in INSTALLER_EXTS
    )
    if not files:
        print("dist 里没有安装包,跳过上传。")
        return 0
    base = _base_url()
    entries = []
    for f in files:
        key = f"{COS_PREFIX}/{f.name}"
        _coscmd_upload(f, key)
        entries.append(
            {"platform": _platform_of(f), "name": f.name, "url": f"{base}/{key}"}
        )
        print(f"uploaded {f.name} -> {base}/{key}")
    manifest = {"generated_at": int(time.time()), "files": entries}
    mpath = Path("manifest.json")
    mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    _coscmd_upload(mpath, f"{COS_PREFIX}/manifest.json")
    print(f"manifest -> {base}/{COS_PREFIX}/manifest.json ({len(entries)} 个文件)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
