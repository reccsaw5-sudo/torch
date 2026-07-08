# Torch 服务端上线手册（阶段一）

一台云主机 + Docker,把 **torch-server + PostgreSQL + Caddy(自动 HTTPS)** 一键拉起。
管理后台挂在同域名的 `/admin`。

> 本目录只做部署,不改任何业务代码。桌面客户端打包属于阶段二(GitHub Actions 三平台在线出包)。

---

> 本项目域名:**claw.torchai.ai**(已解析到 43.132.227.73,DNS 这步已完成)。

## 一、前置条件

1. 一台公网云主机(2C4G 起步即可)。空机器没关系,第二步会装 Docker。
2. 域名 `claw.torchai.ai` 的 DNS **A 记录**指向这台主机公网 IP(已完成)。
3. 云厂商**安全组 / 防火墙放行 80 / 443**(签发证书 + HTTPS);SSH 22 按需。
4. 至少一个**可用的上游模型**(OpenAI 兼容的 base_url + key),上线后在后台「模型」里配置。

> 本项目服务器在**香港**,**不需要 ICP 备案**,域名可直接对外提供 80/443。
> 采用**拉镜像**部署:本地/CI 用 `build-and-push.sh` 推镜像到你的阿里云 ACR
> (`registry.cn-shanghai.aliyuncs.com/gongyong1/hermes`),服务器只拉取运行,
> 不在服务器上构建、也不用把源码放服务器。

## 二、本地 / CI:构建并推送镜像(在有源码的机器上)

```bash
# 1) 登录你的阿里云 ACR(一次即可)
docker login registry.cn-shanghai.aliyuncs.com

# 2) 构建 torch-server + edge(admin-ui+caddy)并推送
#    Apple Silicon 上会按 linux/amd64 构建,匹配服务器架构
bash deploy/build-and-push.sh
#    推出两个 tag:
#      registry.cn-shanghai.aliyuncs.com/gongyong1/hermes:torch-server
#      registry.cn-shanghai.aliyuncs.com/gongyong1/hermes:edge

# 3) 生成 .env.prod:随机管理员 Token + 随机 DB 密码(终端会打印 Token,记下来)
bash deploy/gen-env.sh
```

> 不想用镜像仓库也行:把源码 rsync 到服务器后用 `docker-compose.prod.yml`
> (`up -d --build`)在服务器上现构建。本文默认走更快、更省事的拉镜像方式。

## 三、服务器:拉取并启动(香港空机器)

```bash
# 3.1 装 Docker(空机器一键)
curl -fsSL https://get.docker.com | sh && systemctl enable --now docker
#    (或把 deploy/bootstrap-server.sh 拷到服务器: sudo bash bootstrap-server.sh)

# 3.2 云控制台安全组入站放行 TCP 80、443(以及 22)

# 3.3 把这两个文件从本地拷到服务器(edge 镜像已内置 Caddyfile + admin-ui,无需源码):
scp deploy/docker-compose.registry.yml deploy/.env.prod root@43.132.227.73:/opt/torch/

# 3.4 服务器上登录 ACR(私有仓库需要)并启动
cd /opt/torch
docker login registry.cn-shanghai.aliyuncs.com
docker compose --env-file .env.prod -f docker-compose.registry.yml up -d
```

首次启动 Caddy 会自动向 Let's Encrypt 申请证书(需 80/443 已放行、DNS 已生效)。

查看状态 / 日志:
```bash
docker compose --env-file .env.prod -f docker-compose.registry.yml ps
docker compose --env-file .env.prod -f docker-compose.registry.yml logs -f torch-server
docker compose --env-file .env.prod -f docker-compose.registry.yml logs -f caddy
```

---

## 四、验证

```bash
# 健康检查(经 Caddy)
curl -s https://claw.torchai.ai/health
# 期望: {"status":"ok","service":"torch-server", ...}

# 品牌公共接口
curl -s https://claw.torchai.ai/brand
```

浏览器打开 `https://claw.torchai.ai/admin` → 用 `.env.prod` 里的 `TORCH_ADMIN_TOKEN` 登录。

---

## 五、上线后必配(在 /admin 后台)

1. **模型**:添加真实上游模型(`model` 名 + 上游 `base_url` + `key` + 定价积分)。默认只有 `torch-mock`,不能真出话。
2. **品牌**:名称 / Logo / 主色 / 版本 / 下载链接。
3. **支付充值**:开启支付总开关 + 微信支付/支付宝渠道 + 套餐。
   - 通知回调用公网:填 `https://claw.torchai.ai`(留空则用 `TORCH_PUBLIC_BASE`)。
   - 在微信支付/支付宝商户后台把回调域名登记为 `claw.torchai.ai`。
4. **微信登录**:填 AppID / AppSecret,回调地址填 `https://claw.torchai.ai/auth/wechat/callback`。
   - 到微信开放平台「网站应用 · 授权回调域」登记域名 `claw.torchai.ai`(只填域名,不含 https:// 和路径)。

> 说明:微信扫码登录、微信/支付宝支付回调都依赖**公网 HTTPS**,上线后才能真正跑通(本地 127.0.0.1 收不到回调)。

---

## 六、路由说明(Caddy)

| 路径 | 去向 |
|------|------|
| `/admin/*` | 管理后台静态 SPA(镜像内 `/srv/admin`,base=`/admin/`) |
| `/api/*` | 剥掉 `/api` 前缀 → torch-server(后台调用的 `/admin/*` 等) |
| 其它全部 | torch-server(`/auth/* /v1/* /billing/* /account/* /brand /skills /suggestions /models /health`) |

桌面客户端(阶段二)把 `VITE_TORCH_SERVER` 设为 `https://claw.torchai.ai` 即可。

---

## 七、运维

- **升级**:本地 `bash deploy/build-and-push.sh` 重新推镜像 → 服务器
  `docker compose --env-file .env.prod -f docker-compose.registry.yml pull && ... up -d`
  (torch-server 启动会自动跑建表/迁移,幂等)。
- **数据备份**:所有数据在 `pgdata` 卷。
  ```bash
  docker compose --env-file .env.prod -f docker-compose.registry.yml exec postgres \
    pg_dump -U torch torch > torch-backup-$(date +%F).sql
  ```
- **停/起**:`... down` / `... up -d`(`down` 不删卷,数据保留;加 `-v` 才删卷,谨慎)。
- **安全**:`TORCH_ADMIN_TOKEN`、`POSTGRES_PASSWORD` 必须强随机;数据库端口不对公网暴露(compose 里 postgres 无 `ports`,仅内网);只放行 443(+22)。

---

## 八、GitHub Actions 自动打包镜像(替代本地 build-and-push)

工作流 `.github/workflows/torch-images.yml`:push 到 `main`(或在 Actions 页手动
`Run workflow`)即自动构建 `torch-server` 与 `edge` 两个镜像(`linux/amd64`)并推到你的 ACR,
同时打 `:torch-server` / `:edge`(滚动)和 `:torch-server-<sha>` / `:edge-<sha>`(可回滚)两组 tag。

一次性配置(GitHub 仓库 → Settings → Secrets and variables → Actions):
- **Secrets**:`ACR_USERNAME`(阿里云 ACR 用户名)、`ACR_PASSWORD`(ACR 访问密码)。
- **Variables**(可选):`IMAGE_REPO`,默认 `registry.cn-shanghai.aliyuncs.com/gongyong1/hermes`。

之后发布 = 服务器上拉新镜像:
```bash
docker compose --env-file .env.prod -f docker-compose.registry.yml pull
docker compose --env-file .env.prod -f docker-compose.registry.yml up -d
```

---

## 九、常见问题

- **证书签发失败**:确认 DNS 已指向本机、80/443 已放行、域名没被 CDN 拦在前面。香港主机无需备案。
- **服务器拉不到镜像**:确认已 `docker login registry.cn-shanghai.aliyuncs.com`,且 tag 存在(看 Actions 是否推成功)。
- **torch-server 起不来**:多为数据库未就绪或 `TORCH_DATABASE_URL` 不对;看 `logs torch-server`。compose 已用 `depends_on: service_healthy` 等待 PG。
- **后台能开但接口 401/跨域**:确认走的是 `https://claw.torchai.ai/admin`(同源),不要直连容器端口。
