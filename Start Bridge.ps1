# Claude Usage Bridge — Start Script
# Double-click this on Windows to start the monitor.

$ErrorActionPreference = "Stop"

# Auto-detect install location in WSL
$SERVER_PATH = wsl -e bash -c "echo $HOME/claude-rabbit-usage/server.js"
$LOG_PATH    = wsl -e bash -c "echo $HOME/claude-rabbit-usage/collector.log"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Claude Usage Monitor" -ForegroundColor Cyan
Write-Host "  by Arnold Haxinator" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Kill any stale instance
Write-Host "Stopping any existing instances..." -ForegroundColor Yellow
wsl -e bash -c "fuser -k 5050/tcp 2>/dev/null; true" | Out-Null
Start-Sleep -Seconds 1

# Start the server
Write-Host "Starting bridge server..." -ForegroundColor Yellow
$START_PATH = wsl -e bash -c "echo $HOME/claude-rabbit-usage/start.js"
wsl -e bash -c "nohup node $START_PATH > $LOG_PATH 2>&1 & disown"
Start-Sleep -Seconds 4

# Verify
$health = wsl -e bash -c "curl -s http://127.0.0.1:5050/health 2>/dev/null"
if ($health -match "ok") {
    $usage = wsl -e bash -c "curl -s http://127.0.0.1:5050/usage" | ConvertFrom-Json
    Write-Host ""
    Write-Host "  Bridge server: RUNNING" -ForegroundColor Green
    Write-Host "  Current usage: $($usage.current_percent)%   Weekly: $($usage.weekly_percent)%" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Pushing to Gist every 30 seconds." -ForegroundColor Gray
    Write-Host "  You can close this window — the server runs in the background." -ForegroundColor Gray
} else {
    Write-Host "Bridge server failed to start." -ForegroundColor Red
    Write-Host "Check: $LOG_PATH" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Read-Host "Press Enter to close"
