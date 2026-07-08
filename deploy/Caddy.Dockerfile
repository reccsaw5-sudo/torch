# Edge: builds the admin console (torch-admin-ui) as a static SPA and serves it
# at /admin, while reverse-proxying every other path to torch-server. Caddy
# also terminates HTTPS with automatic Let's Encrypt certs for $TORCH_DOMAIN.
#
# Build context = repo root. dockerfile = deploy/Caddy.Dockerfile.
FROM node:20-alpine AS admin
WORKDIR /app
COPY torch-admin-ui/package.json ./
COPY torch-admin-ui/package-lock.json* ./
RUN npm install
COPY torch-admin-ui/ ./
# Served under /admin, so asset URLs must be prefixed with /admin/.
RUN npm run build -- --base=/admin/

FROM caddy:2-alpine
COPY --from=admin /app/dist /srv/admin
COPY deploy/Caddyfile /etc/caddy/Caddyfile
