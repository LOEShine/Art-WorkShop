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
  python3 - "$config_file" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
block = """
    # BEGIN Art Workshop Codex image proxy
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

install_codex_proxy

echo "[deploy] completed at $(date '+%Y-%m-%d %H:%M:%S')"
