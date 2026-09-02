#!/usr/bin/env bash
cd "$(dirname "$0")/.."

echo "停止 BiliDataMonitor..."

# 停止后端
PID=$(lsof -ti:8123 2>/dev/null || true)
if [ -n "$PID" ]; then
    CMDLINE=$(cat /proc/$PID/cmdline 2>/dev/null | tr '\0' ' ' || true)
    if echo "$CMDLINE" | grep -q "BiliDataMonitor"; then
        kill "$PID" 2>/dev/null || true
        echo "  后端已停止 (PID: $PID)"
    fi
fi

echo "  服务已停止"
