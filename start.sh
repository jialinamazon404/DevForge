#!/bin/bash

# AI Team Pipeline - 一键启动脚本

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           AI Team Pipeline - 启动中                   ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# 检查依赖
check_deps() {
    local missing=()
    
    if ! command -v node &> /dev/null; then
        missing+=("Node.js")
    fi
    
    if [ ${#missing[@]} -gt 0 ]; then
        echo "❌ 缺少依赖: ${missing[*]}"
        echo "   请先安装 Node.js: https://nodejs.org/"
        exit 1
    fi
}

# 安装依赖
install_deps() {
    echo "📦 检查依赖..."
    
    # 根目录
    if [ ! -d "node_modules" ]; then
        echo "   安装根目录依赖..."
        cd "$ROOT_DIR" && npm install --silent 2>/dev/null
    fi
    
    # API Server
    if [ ! -d "dashboard/server/node_modules" ]; then
        echo "   安装 API Server 依赖..."
        cd "$ROOT_DIR/dashboard/server" && npm install --silent 2>/dev/null
    fi
    
    # Dashboard
    if [ ! -d "dashboard/node_modules" ]; then
        echo "   安装 Dashboard 依赖..."
        cd "$ROOT_DIR/dashboard" && npm install --silent 2>/dev/null
    fi
    
    echo "✅ 依赖检查完成"
    echo ""
}

# 启动 API Server
start_api() {
    echo "🚀 启动 API Server (端口 3000)..."
    cd "$ROOT_DIR/dashboard/server"
    node server.js &
    API_PID=$!
    echo "   PID: $API_PID"
}

# 启动 Dashboard
start_dashboard() {
    echo "🌐 启动 Dashboard (端口 5173)..."
    cd "$ROOT_DIR/dashboard"
    npm run dev &
    DASH_PID=$!
    echo "   PID: $DASH_PID"
}

# 启动 Agent Runner (通过 API 触发，不在前台运行)
start_agent_runner() {
    echo "🤖 Agent Runner 将在用户启动流水线时自动执行"
    echo "   通过 Dashboard 或 API 创建并启动流水线即可触发"
}

# 主函数
main() {
    check_deps
    install_deps
    
    echo ""
    start_api
    sleep 1
    start_dashboard
    sleep 1
    start_agent_runner
    
    echo ""
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║                   ✅ 启动完成                            ║"
    echo "╠═══════════════════════════════════════════════════════════╣"
    echo "║  Dashboard:  http://localhost:5173                      ║"
    echo "║  API:       http://localhost:3000                       ║"
    echo "║  Agent:     自动执行流水线                               ║"
    echo "║                                                           ║"
    echo "║  按 Ctrl+C 停止所有服务                                  ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo ""
    
    # 等待信号
    trap "echo ''; echo '🛑 停止服务...'; kill $API_PID $DASH_PID 2>/dev/null; exit" SIGINT SIGTERM
    wait
}

main "$@"
