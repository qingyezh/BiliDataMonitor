#!/usr/bin/env bash
set -e

echo "========================================="
echo "  BiliDataMonitor 服务器部署"
echo "========================================="

# 1. 安装 Node.js 22
if ! command -v node &>/dev/null || [[ $(node -v | cut -d'.' -f1 | tr -d 'v') -lt 22 ]]; then
    echo "[1/6] 安装 Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "[1/6] Node.js 已安装: $(node -v)"
fi

# 2. 安装 pnpm
if ! command -v pnpm &>/dev/null; then
    echo "[2/6] 安装 pnpm..."
    sudo npm install -g pnpm
else
    echo "[2/6] pnpm 已安装"
fi

# 3. 安装系统依赖
echo "[3/6] 安装系统依赖..."
sudo apt install -y curl lsof nginx

# 4. 安装项目依赖并构建
echo "[4/6] 安装依赖并构建..."
pnpm install
pnpm build

# 5. 配置 systemd 服务
echo "[5/6] 配置 systemd 服务..."
NODE_PATH=$(which node)
sudo tee /etc/systemd/system/bili-monitor.service > /dev/null <<EOF
[Unit]
Description=BiliDataMonitor - B站数据监测服务
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)
ExecStart=$NODE_PATH --experimental-sqlite $(pwd)/src/server/dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable bili-monitor.service
sudo systemctl start bili-monitor.service

# 6. 配置 nginx
echo "[6/6] 配置 nginx..."
DOMAIN=${1:-$(curl -s ifconfig.me)}
bash scripts/setup-nginx.sh "$DOMAIN"

echo ""
echo "========================================="
echo "  部署完成！"
echo "========================================="
echo ""
echo "访问地址: http://$DOMAIN"
echo "默认账号: admin"
echo "默认密码: admin123"
echo ""
echo "服务管理:"
echo "  启动: sudo systemctl start bili-monitor"
echo "  停止: sudo systemctl stop bili-monitor"
echo "  状态: sudo systemctl status bili-monitor"
echo "  日志: sudo journalctl -u bili-monitor -f"
echo ""
echo "⚠️  请尽快修改默认密码！"
