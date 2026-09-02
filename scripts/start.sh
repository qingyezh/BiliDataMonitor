#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."

echo "========================================"
echo "  BiliDataMonitor - Start Service"
echo "========================================"
echo

# 清理旧进程（仅属于本项目的）
echo "[1/1] 清理旧进程..."
PID=$(lsof -ti:8123 2>/dev/null || true)
if [ -n "$PID" ]; then
    CMDLINE=$(cat /proc/$PID/cmdline 2>/dev/null | tr '\0' ' ' || true)
    if echo "$CMDLINE" | grep -q "BiliDataMonitor"; then
        kill "$PID" 2>/dev/null || true
        sleep 2
    fi
fi

# 启动后端（后台）
echo "启动后端..."
nohup node --experimental-sqlite src/server/dist/index.js > /dev/null 2>&1 &
echo "后端 PID: $!"

echo
echo "服务已启动: http://0.0.0.0:8123"
