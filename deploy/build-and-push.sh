#!/usr/bin/env bash
# 在本地/CI 构建 torch-server 与 edge(admin-ui + caddy)两个镜像并推到镜像仓库。
# 服务器随后用 deploy/docker-compose.registry.yml 拉取运行(无需在服务器上构建)。
#
# 用法(仓库根目录):
#   # 已 docker login 的情况下:
#   bash deploy/build-and-push.sh
#   # 或用环境变量非交互登录(适合 CI):
#   TORCH_REGISTRY_USER=xxx TORCH_REGISTRY_PASS=yyy bash deploy/build-and-push.sh
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

REPO="${TORCH_IMAGE_REPO:-registry.cn-shanghai.aliyuncs.com/gongyong1/hermes}"
SERVER_TAG="${TORCH_SERVER_TAG:-torch-server}"
EDGE_TAG="${TORCH_EDGE_TAG:-edge}"
# 服务器是 x86_64;在 Apple Silicon 上构建务必指定 amd64,否则镜像跑不起来。
PLATFORM="${TORCH_PLATFORM:-linux/amd64}"
REGISTRY_HOST="${REPO%%/*}"

if [ -n "${TORCH_REGISTRY_USER:-}" ] && [ -n "${TORCH_REGISTRY_PASS:-}" ]; then
  echo "[push] docker login $REGISTRY_HOST"
  echo "$TORCH_REGISTRY_PASS" | docker login "$REGISTRY_HOST" -u "$TORCH_REGISTRY_USER" --password-stdin
else
  echo "[push] 假定已经 docker login $REGISTRY_HOST(如未登录请先 docker login)"
fi

echo "[build] $REPO:$SERVER_TAG  ($PLATFORM)"
docker build --platform "$PLATFORM" -t "$REPO:$SERVER_TAG" -f torch-server/Dockerfile torch-server

echo "[build] $REPO:$EDGE_TAG  ($PLATFORM)  = admin-ui + caddy"
docker build --platform "$PLATFORM" -t "$REPO:$EDGE_TAG" -f deploy/Caddy.Dockerfile .

docker push "$REPO:$SERVER_TAG"
docker push "$REPO:$EDGE_TAG"

echo "[push] 完成:"
echo "  $REPO:$SERVER_TAG"
echo "  $REPO:$EDGE_TAG"
