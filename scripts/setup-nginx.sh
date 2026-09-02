#!/usr/bin/env bash
set -e

DOMAIN=${1:-localhost}
CONF_PATH="/etc/nginx/sites-available/bili-monitor"

echo "配置 nginx 反向代理..."
echo "域名: $DOMAIN"

sudo tee "$CONF_PATH" > /dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8123;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 120s;
    }

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
}
EOF

sudo ln -sf "$CONF_PATH" /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo "nginx 配置完成！"
