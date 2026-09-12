#!/usr/bin/env bash
cd "$(dirname "$0")/.."

APP_MARKER="BiliDataMonitor-linux"
NODE_ENTRY="src/server/dist/index.js"

echo "停止 BiliDataMonitor..."

# 停 systemd（若在管）
if command -v systemctl >/dev/null 2>&1; then
    for unit in bili-monitor.service bilidatamonitor.service; do
        if systemctl is-active --quiet "$unit" 2>/dev/null; then
            echo "  停止 systemd: $unit"
            systemctl stop "$unit" 2>/dev/null || true
        fi
    done
fi

# 按路径杀本项目进程
pkill -f "${APP_MARKER}/src/server/dist/index.js" 2>/dev/null || true
sleep 1

if pgrep -f "${APP_MARKER}/src/server/dist/index.js" >/dev/null 2>&1; then
    echo "  强制清理残留..."
    pkill -9 -f "${APP_MARKER}/src/server/dist/index.js" 2>/dev/null || true
fi

echo "  服务已停止"
