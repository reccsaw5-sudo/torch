#!/usr/bin/env bash
# 生成 deploy/.env.prod:随机管理员 Token + 随机数据库密码,并在终端打印 Token。
# 用法(仓库根目录):  bash deploy/gen-env.sh
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root
OUT="deploy/.env.prod"

if [ -f "$OUT" ]; then
  echo "[gen-env] $OUT 已存在,不覆盖。如需重建请先备份并删除它。" >&2
  exit 1
fi

DOMAIN="${TORCH_DOMAIN:-claw.torchai.ai}"
ADMIN_TOKEN="$(openssl rand -hex 32)"
DB_PW="$(openssl rand -hex 24)"

cat > "$OUT" <<EOF
TORCH_DOMAIN=$DOMAIN
POSTGRES_USER=torch
POSTGRES_PASSWORD=$DB_PW
POSTGRES_DB=torch
TORCH_ADMIN_TOKEN=$ADMIN_TOKEN
TORCH_SIGNUP_CREDITS=1000
TORCH_IMAGE_REPO=registry.cn-shanghai.aliyuncs.com/gongyong1/hermes
TORCH_SERVER_TAG=torch-server
TORCH_EDGE_TAG=edge
EOF
chmod 600 "$OUT"

echo "=================================================================="
echo " 已生成 $OUT (权限 600)"
echo
echo "   管理员 Token(登录 https://$DOMAIN/admin 用,请立刻保存):"
echo
echo "       $ADMIN_TOKEN"
echo
echo "=================================================================="
