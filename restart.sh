#!/bin/bash

# AI Team Pipeline - 重启脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"

echo "🔄 正在重启 DevForge..."

# 停止服务
echo "   🛑 停止现有服务..."
if lsof -i :3000 &>/dev/null; then
    lsof -ti :3000 | xargs kill 2>/dev/null || true
fi

if lsof -i :5173 &>/dev/null; then
    lsof -ti :5173 | xargs kill 2>/dev/null || true
fi

sleep 1

# 清理僵尸进程
ZOMBIE_PIDS=$(ps aux | grep -E "/Users/jialin.chen/WorkSpace/DevForge" | grep -E " T " | awk '{print $2}' | xargs)
if [ -n "$ZOMBIE_PIDS" ]; then
    for pid in $ZOMBIE_PIDS; do
        kill -9 $pid 2>/dev/null || true
    done
fi

echo "   ✅ 服务已停止"

# 启动服务
echo "   🚀 启动服务..."

# 启动 API Server
cd "$ROOT_DIR/dashboard/server"
node server.js &
API_PID=$!
echo "   ✅ API Server (PID: $API_PID)"

# 等待 API Server 启动
sleep 2

# 启动 Dashboard
cd "$ROOT_DIR/dashboard"
npm run dev &
DASH_PID=$!
echo "   ✅ Dashboard (PID: $DASH_PID)"

sleep 1

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║                   ✅ 重启完成                              ║"
echo "╠═══════════════════════════════════════════════════════════╣"
echo "║  Dashboard:  http://localhost:5173                        ║"
echo "║  API:       http://localhost:3000                         ║"
echo "╚═══════════════════════════════════════════════════════════╝"
