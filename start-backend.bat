@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   Campus Action OS - 本地后端一键启动
echo ============================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 npm。请先安装 Node.js 18 或更高版本：https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次运行，正在安装依赖，请稍候（约 1-3 分钟）...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

echo 正在启动 AI 解析服务（端口 3001）...
start "CAOS AI Parser :3001" cmd /k "npm run dev:ai"
timeout /t 3 /nobreak >nul

echo 正在启动业务 API 服务（端口 3000）...
start "CAOS API :3000" cmd /k "npm run dev:api"

echo.
echo 两个服务已在独立窗口启动，请保持窗口开着（关闭窗口即停止服务）。
echo.
echo 下一步：回到微信开发者工具，在「我的 -^> 设置」把数据模式切换到「真实解析服务」。
echo.
pause
