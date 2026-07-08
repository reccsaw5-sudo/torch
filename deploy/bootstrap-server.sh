#!/usr/bin/env bash
# 在一台全新的 Linux 服务器上安装 Docker Engine + Compose 插件并启用。
# 用法(root 或 sudo):
#   sudo bash deploy/bootstrap-server.sh              # 仅安装
#   sudo bash deploy/bootstrap-server.sh <用户名>     # 顺便把该用户加入 docker 组
#   sudo CN_MIRROR=1 bash deploy/bootstrap-server.sh  # 国内:配 Docker 镜像加速
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 运行:  sudo bash deploy/bootstrap-server.sh" >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1; then
  echo "[bootstrap] Docker 已安装: $(docker --version)"
else
  echo "[bootstrap] 通过官方脚本安装 Docker ..."
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable --now docker

if ! docker compose version >/dev/null 2>&1; then
  echo "[bootstrap] 补装 docker compose 插件 ..."
  (apt-get update && apt-get install -y docker-compose-plugin) \
    || dnf install -y docker-compose-plugin \
    || yum install -y docker-compose-plugin \
    || true
fi

# 国内网络:配置镜像加速,避免拉取 Docker Hub 镜像超时。
if [ "${CN_MIRROR:-0}" = "1" ]; then
  echo "[bootstrap] 写入 Docker 镜像加速器 (/etc/docker/daemon.json) ..."
  mkdir -p /etc/docker
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.com",
    "https://mirror.baidubce.com"
  ]
}
JSON
  systemctl restart docker
fi

# 允许非 root 用户直接用 docker(需重新登录生效)。
if [ "${1:-}" != "" ]; then
  usermod -aG docker "$1" && echo "[bootstrap] 已将用户 $1 加入 docker 组(重新登录后生效)。"
fi

echo "[bootstrap] 完成。"
docker --version
docker compose version
