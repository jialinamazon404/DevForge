@echo off
chcp 65001 >nul
title AI Team Pipeline

echo ========================================
echo        AI Team Pipeline - 启动中
echo ========================================
echo.

cd /d "%~dp0"

echo 📦 检查依赖...
if not exist "node_modules" (
    echo    安装根目录依赖...
    call npm install >nul 2>&1
)

if not exist "dashboard\server\node_modules" (
    echo    安装 API Server 依赖...
    cd dashboard\server && call npm install >nul 2>&1 && cd ..
)

if not exist "dashboard\node_modules" (
    echo    安装 Dashboard 依赖...
    cd dashboard && call npm install >nul 2>&1 && cd ..
)

echo.
echo 🚀 启动 API Server (端口 3000)...
start "API Server" cmd /c "cd dashboard\server && node server.js"

timeout /t 1 >nul

echo 🌐 启动 Dashboard (端口 5173)...
start "Dashboard" cmd /c "cd dashboard && npm run dev"

echo.
echo ========================================
echo           ✅ 启动完成
echo ========================================
echo.
echo    Dashboard:  http://localhost:5173
echo    API:       http://localhost:3000
echo.
echo    按任意键打开浏览器...
pause >nul

start http://localhost:5173

echo.
echo 关闭窗口停止所有服务
pause
