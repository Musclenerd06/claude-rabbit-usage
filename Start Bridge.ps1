# Claude Usage Bridge — Start Script
# Run this on Windows to start the WSL collector server.
# The server reads Claude Code logs and pushes usage data to your GitHub Gist every 5 minutes.

$ErrorActionPreference = "Stop"
$SERVER_PATH = "/home/workbench/claude-rabbit-usage/server.js"
$LOG_PATH    = "/home/workbench/claude-rabbit-usage/collector.log"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Claude Usage Bridge" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Kill any stale instance
Write-Host "Stopping any existing instances..." -ForegroundColor Yellow
wsl -e bash -c "fuser -k 5050/tcp 2>/dev/null; true" | Out-Null
Start-Sleep -Seconds 1

# Start the server
Write-Host "Starting bridge server..." -ForegroundColor Yellow
wsl -e bash -c "nohup node $SERVER_PATH > $LOG_PATH 2>&1 & disown"
Start-Sleep -Seconds 3

# Verify
$health = wsl -e bash -c "curl -s http://127.0.0.1:5050/health 2>/dev/null"
if ($health -match "ok") {
    Write-Host "Bridge server: RUNNING on localhost:5050" -ForegroundColor Green
} else {
    Write-Host "Bridge server failed to start — check collector.log" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "Usage data is being pushed to your GitHub Gist every 5 minutes." -ForegroundColor Green
Write-Host "Rabbit will read from your Gist URL automatically." -ForegroundColor Green
Write-Host ""
Write-Host "Leave this window open, or close it — the server runs in the background." -ForegroundColor Gray
Write-Host ""
Read-Host "Press Enter to exit"
