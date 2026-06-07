# Claude Usage Bridge — Start Script
# Double-click this on Windows to start the monitor.

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Claude Usage Monitor" -ForegroundColor Cyan
Write-Host "  by Arnold Haxinator" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Kill any stale instances
Write-Host "Stopping any existing instances..." -ForegroundColor Yellow
wsl -e bash -c "fuser -k 5050/tcp 2>/dev/null; pkill -f 'cloudflared tunnel' 2>/dev/null; true" | Out-Null
Start-Sleep -Seconds 1

# Start the bridge server
Write-Host "Starting bridge server..." -ForegroundColor Yellow
$START_PATH = wsl -e bash -c "echo `$HOME/claude-rabbit-usage/start.js"
$LOG_PATH   = wsl -e bash -c "echo `$HOME/claude-rabbit-usage/server.log"
wsl -e bash -c "nohup node $START_PATH >> $LOG_PATH 2>&1 & disown"
Start-Sleep -Seconds 4

# Verify server
$health = wsl -e bash -c "curl -s http://127.0.0.1:5050/health 2>/dev/null"
if ($health -notmatch "ok") {
    Write-Host "Bridge server failed to start." -ForegroundColor Red
    Write-Host "Check: $LOG_PATH" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "  Bridge server: RUNNING" -ForegroundColor Green

# Start Cloudflare Tunnel
Write-Host ""
Write-Host "Starting Cloudflare Tunnel..." -ForegroundColor Yellow
$CF_BIN = wsl -e bash -c "echo `$HOME/claude-rabbit-usage/cloudflared"
$CF_EXISTS = wsl -e bash -c "test -f `$HOME/claude-rabbit-usage/cloudflared && echo yes || echo no"

if ($CF_EXISTS -notmatch "yes") {
    Write-Host "  Downloading cloudflared..." -ForegroundColor Yellow
    wsl -e bash -c "curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o `$HOME/claude-rabbit-usage/cloudflared && chmod +x `$HOME/claude-rabbit-usage/cloudflared"
}

$CF_LOG = "/tmp/cloudflared-usage.log"
wsl -e bash -c "nohup `$HOME/claude-rabbit-usage/cloudflared tunnel --url http://127.0.0.1:5050 > $CF_LOG 2>&1 & disown"

Write-Host "  Waiting for tunnel URL..." -ForegroundColor Gray
$TUNNEL_URL = ""
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Seconds 1
    $TUNNEL_URL = wsl -e bash -c "grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' $CF_LOG 2>/dev/null | head -1"
    if ($TUNNEL_URL -match "trycloudflare") { break }
}

if ($TUNNEL_URL -match "trycloudflare") {
    Write-Host "  Tunnel active: $TUNNEL_URL" -ForegroundColor Green
    # Save to .env
    wsl -e bash -c "
      ENV=`$HOME/claude-rabbit-usage/.env
      if grep -q '^TUNNEL_URL=' `$ENV 2>/dev/null; then
        sed -i 's|^TUNNEL_URL=.*|TUNNEL_URL=$TUNNEL_URL|' `$ENV
      else
        echo 'TUNNEL_URL=$TUNNEL_URL' >> `$ENV
      fi
    "
    $APP_URL = "$TUNNEL_URL/api/status"
    Write-Host "  App endpoint:  $APP_URL" -ForegroundColor Green
} else {
    Write-Host "  Tunnel URL not detected — update TUNNEL_URL in .env manually." -ForegroundColor Yellow
}

# Show usage stats
$usage = wsl -e bash -c "curl -s http://127.0.0.1:5050/api/status 2>/dev/null" | ConvertFrom-Json
Write-Host ""
Write-Host "  Current usage: $($usage.current_percent)%   Weekly: $($usage.weekly_percent)%" -ForegroundColor Green
Write-Host "  Dashboard:     http://localhost:5050" -ForegroundColor Cyan
if ($TUNNEL_URL -match "trycloudflare") {
    Write-Host "  QR Codes:      http://localhost:5050/qr" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  Server and tunnel run in the background. You can close this window." -ForegroundColor Gray
Write-Host ""
Read-Host "Press Enter to close"
