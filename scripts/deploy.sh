#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-/www/wwwroot/ai}"

cd "$ROOT_DIR"

echo "[deploy] working directory: $ROOT_DIR"
echo "[deploy] target directory: $DEPLOY_DIR"

npm ci
npm run build

mkdir -p "$DEPLOY_DIR"

rsync -av --delete \
  --exclude=".well-known" \
  --exclude=".user.ini" \
  --exclude=".htaccess" \
  --exclude="404.html" \
  --exclude="index.html.bak-*" \
  "dist/" "$DEPLOY_DIR/"

install_image_job_service() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "[deploy] systemctl not found; skip image job service install"
    return 0
  fi

  local node_bin
  node_bin="$(command -v node || true)"
  if [[ -z "$node_bin" ]]; then
    echo "[deploy] node binary not found; skip image job service install"
    return 0
  fi

  local service_file="/etc/systemd/system/art-workshop-api.service"
  local env_file="/etc/art-workshop-api.env"

  if [[ ! -f "$env_file" ]]; then
    cat > "$env_file" <<'ENV'
ART_WORKSHOP_API_HOST=127.0.0.1
ART_WORKSHOP_API_PORT=8787
ART_WORKSHOP_STORAGE_DIR=/var/lib/art-workshop
# Optional, required only for the WaveSpeed multi-angle model.
WAVESPEED_API_KEY=
ENV
    chmod 600 "$env_file"
  fi

  cat > "$service_file" <<SERVICE
[Unit]
Description=Art Workshop Image Job API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ROOT_DIR
EnvironmentFile=-$env_file
ExecStart=$node_bin $ROOT_DIR/server/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SERVICE

  systemctl daemon-reload
  systemctl enable art-workshop-api.service >/dev/null 2>&1 || true
  if systemctl restart art-workshop-api.service; then
    echo "[deploy] image job service restarted"
  else
    echo "[deploy] image job service restart failed; check journalctl -u art-workshop-api.service"
    return 0
  fi
}

install_codex_proxy() {
  local server_name="${SERVER_NAME:-ai.faker2025.site}"
  local config_file=""
  local nginx_bin="/www/server/nginx/sbin/nginx"
  local nginx_conf="/www/server/nginx/conf/nginx.conf"

  for file in /www/server/panel/vhost/nginx/*.conf /www/server/nginx/conf/vhost/*.conf /etc/nginx/conf.d/*.conf; do
    [[ -f "$file" ]] || continue
    if grep -q "$server_name" "$file"; then
      config_file="$file"
      break
    fi
  done

  if [[ -z "$config_file" ]]; then
    echo "[deploy] nginx site config for $server_name not found; skip codex proxy install"
    return 0
  fi

  if ! command -v python3 >/dev/null 2>&1; then
    echo "[deploy] python3 not found; skip codex proxy install"
    return 0
  fi

  local backup_file="$config_file.bak-$(date '+%Y%m%d%H%M%S')"
  cp "$config_file" "$backup_file"

  local extension_dir="/www/server/panel/vhost/nginx/extension/$server_name"
  if ! grep -q "BEGIN Art Workshop Codex image proxy" "$config_file" && grep -q "extension/$server_name" "$config_file"; then
    mkdir -p "$extension_dir"
    cat > "$extension_dir/image-job-api.conf" <<'NGINX'
# Art Workshop persistent image job API
location = /api {
    return 308 /api/;
}

location ^~ /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    client_max_body_size 96m;
}
NGINX

    if [[ ! -f "$extension_dir/codex-image-api.conf" ]]; then
      cat > "$extension_dir/codex-image-api.conf" <<'NGINX'
# Art Workshop Codex image API proxy
location = /codex-image-api {
    return 308 /codex-image-api/;
}

location ^~ /codex-image-api/ {
    proxy_pass https://sgdr.funai.vip/;
    proxy_ssl_server_name on;
    proxy_http_version 1.1;
    proxy_set_header Host sgdr.funai.vip;
    proxy_set_header Authorization $http_authorization;
    proxy_set_header Origin "";
    proxy_set_header Referer "";
    proxy_set_header User-Agent "ArtWorkshop-Proxy/1.0";
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    client_max_body_size 64m;
}
NGINX
    fi

    if [[ -x "$nginx_bin" && -f "$nginx_conf" ]]; then
      if "$nginx_bin" -t -c "$nginx_conf" && "$nginx_bin" -s reload -c "$nginx_conf"; then
        echo "[deploy] proxy config installed in $extension_dir"
        return 0
      fi
    elif command -v nginx >/dev/null 2>&1; then
      if nginx -t && nginx -s reload; then
        echo "[deploy] proxy config installed in $extension_dir"
        return 0
      fi
    fi

    echo "[deploy] nginx reload failed after writing extension proxy config"
    return 0
  fi

  python3 - "$config_file" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
block = """
    # BEGIN Art Workshop Codex image proxy
    location = /api {
        return 308 /api/;
    }

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        client_max_body_size 96m;
    }

    location = /codex-image-api {
        return 308 /codex-image-api/;
    }

    location ^~ /codex-image-api/ {
        proxy_pass https://sgdr.funai.vip/;
        proxy_ssl_server_name on;
        proxy_http_version 1.1;
        proxy_set_header Host sgdr.funai.vip;
        proxy_set_header Authorization $http_authorization;
        proxy_set_header Origin "";
        proxy_set_header Referer "";
        proxy_set_header User-Agent "ArtWorkshop-Proxy/1.0";
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 64m;
    }
    # END Art Workshop Codex image proxy
"""

text = re.sub(
    r"\n\s*# BEGIN Art Workshop Codex image proxy.*?# END Art Workshop Codex image proxy\n?",
    "\n",
    text,
    flags=re.S,
)

insert_at = text.rfind("}")
if insert_at == -1:
    raise SystemExit("nginx config has no closing brace")

text = text[:insert_at].rstrip() + "\n" + block + "\n" + text[insert_at:]
path.write_text(text, encoding="utf-8")
PY

  if [[ -x "$nginx_bin" && -f "$nginx_conf" ]]; then
    if "$nginx_bin" -t -c "$nginx_conf" && "$nginx_bin" -s reload -c "$nginx_conf"; then
      echo "[deploy] codex proxy installed in $config_file"
    else
      cp "$backup_file" "$config_file"
      echo "[deploy] nginx reload failed; restored $config_file and skipped codex proxy"
      return 0
    fi
  elif command -v nginx >/dev/null 2>&1; then
    if nginx -t && nginx -s reload; then
      echo "[deploy] codex proxy installed in $config_file"
    else
      cp "$backup_file" "$config_file"
      echo "[deploy] nginx reload failed; restored $config_file and skipped codex proxy"
      return 0
    fi
  else
    echo "[deploy] nginx binary not found; codex proxy written but not reloaded"
  fi
}

install_image_job_service
install_codex_proxy

echo "[deploy] completed at $(date '+%Y-%m-%d %H:%M:%S')"
