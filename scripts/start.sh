#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

APP_DIR="$(pwd)"
APP_MARKER="BiliDataMonitor-linux"
NODE_ENTRY="src/server/dist/index.js"

# 读取配置端口（默认 8123）
PORT=8123
if [ -f app/config/settings.json ]; then
    P=$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' app/config/settings.json | head -1)
    [ -n "$P" ] && PORT="$P"
fi

echo "========================================"
echo "  BiliDataMonitor - Start Service"
echo "========================================"
echo "目录: $APP_DIR"
echo "端口: $PORT"
echo

echo "[1/2] 清理旧进程与服务..."

# 停掉可能存在的 systemd 双服务（避免和手工启动抢库）
if command -v systemctl >/dev/null 2>&1; then
    for unit in bili-monitor.service bilidatamonitor.service; do
        if systemctl is-active --quiet "$unit" 2>/dev/null; then
            echo "  停止 systemd: $unit"
            systemctl stop "$unit" 2>/dev/null || true
        fi
    done
fi

# 按项目路径杀掉本项目所有 node 进程（覆盖换端口的情况）
pkill -f "${APP_DIR}/${NODE_ENTRY}" 2>/dev/null || true
pkill -f "${APP_MARKER}/${NODE_ENTRY}" 2>/dev/null || true
pkill -f "${APP_MARKER}/src/server/dist/index.js" 2>/dev/null || true

# 再按端口兜底（确认属于本项目才杀）
for P in "$PORT" 8123 8124 8125 8126; do
    PIDS=$(lsof -ti:"$P" 2>/dev/null || true)
    for PID in $PIDS; do
        CMDLINE=$(tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null || true)
        if echo "$CMDLINE" | grep -q "BiliDataMonitor"; then
            echo "  kill port:$P pid:$PID"
            kill "$PID" 2>/dev/null || true
        fi
    done
done

sleep 2

# 强制清残留
pkill -9 -f "${APP_MARKER}/src/server/dist/index.js" 2>/dev/null || true
sleep 1

if pgrep -f "${APP_MARKER}/src/server/dist/index.js" >/dev/null 2>&1; then
    echo "[错误] 仍有残留进程，启动中止"
    pgrep -af "${APP_MARKER}/src/server/dist/index.js" || true
    exit 1
fi

echo "[2/2] 启动后端..."
nohup node --experimental-sqlite "$NODE_ENTRY" >> app/logs/manual-start.log 2>&1 &
NEW_PID=$!
echo "后端 PID: $NEW_PID"

sleep 2
if ! kill -0 "$NEW_PID" 2>/dev/null; then
    echo "[错误] 启动失败，请查看 app/logs/manual-start.log"
    exit 1
fi

echo
echo "服务已启动: http://0.0.0.0:${PORT}"
echo "提示: 生产环境请优先用 systemctl start bilidatamonitor"
