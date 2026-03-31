#!/bin/bash

# AI Team Pipeline - 停止脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"

echo "🛑 停止 DevForge 所有服务..."

# 停止 API Server
if lsof -i :3000 &>/dev/null; then
    API_PID=$(lsof -ti :3000)
    kill $API_PID 2>/dev/null && echo "   ✅ API Server (PID: $API_PID) 已停止" || echo "   ⚠️ API Server 停止失败"
fi

# 停止 Dashboard (Vite dev server)
if lsof -i :5173 &>/dev/null; then
    DASH_PID=$(lsof -ti :5173)
    kill $DASH_PID 2>/dev/null && echo "   ✅ Dashboard (PID: $DASH_PID) 已停止" || echo "   ⚠️ Dashboard 停止失败"
fi

# 清理僵尸进程
ZOMBIE_PIDS=$(ps aux | grep -E "/Users/jialin.chen/WorkSpace/DevForge" | grep -E "T " | awk '{print $2}' | xargs)
if [ -n "$ZOMBIE_PIDS" ]; then
    echo "   🧹 清理僵尸进程..."
    for pid in $ZOMBIE_PIDS; do
        kill -9 $pid 2>/dev/null && echo "   ✅ 僵尸进程 (PID: $pid) 已清理" || true
    done
fi

echo ""
echo "✅ 所有服务已停止"
