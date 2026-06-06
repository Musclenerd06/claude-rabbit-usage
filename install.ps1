# Claude Usage Monitor — Windows Installer (PowerShell)
# Run: iwr -useb https://raw.githubusercontent.com/Musclenerd06/claude-rabbit-usage/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
$REPO_URL  = "https://github.com/Musclenerd06/claude-rabbit-usage.git"
$INSTALL_DIR = "$env:USERPROFILE\claude-rabbit-usage"

function ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function err($msg)  { Write-Host "  [X]  $msg" -ForegroundColor Red }
function sep()      { Write-Host "----------------------------------------" -ForegroundColor Cyan }

Write-Host ""
Write-Host "  Claude Usage Monitor - Installer" -ForegroundColor Cyan
Write-Host ""

# ── Prerequisites ──────────────────────────────────────────────────────────
sep
Write-Host "Checking prerequisites..." -ForegroundColor White
Write-Host ""

# Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  warn "Node.js not found. Installing via winget..."
  winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements -e
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
$nodeVer = node --version
ok "Node.js $nodeVer"

# git
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  warn "git not found. Installing via winget..."
  winget install Git.Git --accept-source-agreements --accept-package-agreements -e
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
}
ok "git $(git --version)"

# Claude Code logs
$logDirs = @(
  "$env:USERPROFILE\.claude\projects",
  "$env:APPDATA\Claude\projects",
  "$env:LOCALAPPDATA\Claude\projects"
)
$CLAUDE_LOG_DIR = $logDirs | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $CLAUDE_LOG_DIR) {
  err "Claude Code logs not found. Install Claude Code and have at least one session first."
  exit 1
}
$logCount = (Get-ChildItem -Path $CLAUDE_LOG_DIR -Filter "*.jsonl" -Recurse -ErrorAction SilentlyContinue).Count
ok "Claude Code logs found ($logCount .jsonl files)"

# ── Clone / update repo ────────────────────────────────────────────────────
Write-Host ""
sep
Write-Host "Getting latest code..." -ForegroundColor White
Write-Host ""

if (Test-Path "$INSTALL_DIR\.git") {
  git -C $INSTALL_DIR pull --ff-only origin main 2>&1 | Select-Object -Last 1
  ok "Updated — $INSTALL_DIR"
} else {
  git clone $REPO_URL $INSTALL_DIR
  ok "Cloned to $INSTALL_DIR"
}

Set-Location $INSTALL_DIR
npm install --silent
ok "Dependencies installed"

# ── GitHub / Gist setup ────────────────────────────────────────────────────
Write-Host ""
sep
Write-Host "GitHub setup" -ForegroundColor White
Write-Host ""

$ENV_FILE = "$INSTALL_DIR\.env"
$GITHUB_TOKEN = ""; $GIST_ID = ""; $GITHUB_USER = ""

if (Test-Path $ENV_FILE) {
  Get-Content $ENV_FILE | ForEach-Object {
    if ($_ -match "^GITHUB_TOKEN=(.+)") { $GITHUB_TOKEN = $matches[1] }
    if ($_ -match "^GIST_ID=(.+)")      { $GIST_ID     = $matches[1] }
    if ($_ -match "^GITHUB_USER=(.+)")  { $GITHUB_USER  = $matches[1] }
  }
}

if ($GITHUB_TOKEN -and $GIST_ID) {
  ok "Already configured — user: $GITHUB_USER  Gist: $GIST_ID"
} else {
  Write-Host "  You need a GitHub token with 'gist' scope." -ForegroundColor White
  Write-Host "  Create one at: https://github.com/settings/tokens/new" -ForegroundColor Cyan
  Write-Host "  Select scope: gist only -> Generate token" -ForegroundColor White
  Write-Host ""

  do {
    $GITHUB_TOKEN = Read-Host "  Paste your GitHub token"
  } while (-not $GITHUB_TOKEN)

  Write-Host ""
  Write-Host "  Validating token..."
  $headers = @{ Authorization = "token $GITHUB_TOKEN"; "User-Agent" = "claude-usage-installer" }
  try {
    $userResp = Invoke-RestMethod -Uri "https://api.github.com/user" -Headers $headers
    $GITHUB_USER = $userResp.login
  } catch {
    err "Token invalid or missing gist scope."
    exit 1
  }
  ok "Token valid — GitHub user: $GITHUB_USER"

  Write-Host "  Creating Gist..."
  $gistBody = '{"description":"Claude Code usage relay","public":true,"files":{"usage.json":{"content":"{}"}}}'
  try {
    $gistResp = Invoke-RestMethod -Uri "https://api.github.com/gists" -Method POST -Headers $headers `
      -Body $gistBody -ContentType "application/json"
    $GIST_ID = $gistResp.id
  } catch {
    err "Failed to create Gist. Does your token have 'gist' scope?"
    exit 1
  }
  ok "Gist created: $GIST_ID"

  Write-Host ""
  Write-Host "  Optional: your 5-hour reset time in UTC (e.g. 17:30). Press Enter to skip."
  $RESET_ANCHOR = Read-Host "  Reset anchor UTC (HH:MM or Enter)"

  $envContent = "GITHUB_TOKEN=$GITHUB_TOKEN`nGIST_ID=$GIST_ID`nGITHUB_USER=$GITHUB_USER"
  if ($RESET_ANCHOR) { $envContent += "`nRESET_ANCHOR_UTC=$RESET_ANCHOR" }
  Set-Content -Path $ENV_FILE -Value $envContent
  ok ".env saved"
}

$GIST_URL = "https://gist.githubusercontent.com/$GITHUB_USER/$GIST_ID/raw/usage.json"

# ── Start server ───────────────────────────────────────────────────────────
Write-Host ""
sep
Write-Host "Starting server..." -ForegroundColor White
Write-Host ""

# Kill anything on port 5050
$proc = Get-NetTCPConnection -LocalPort 5050 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -ErrorAction SilentlyContinue
if ($proc) { Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue }
Start-Sleep 1

$serverProc = Start-Process node -ArgumentList "$INSTALL_DIR\start.js" -RedirectStandardOutput "$env:TEMP\claude-usage.log" -RedirectStandardError "$env:TEMP\claude-usage-err.log" -PassThru -WindowStyle Hidden
Start-Sleep 4

try {
  $health = Invoke-RestMethod -Uri "http://127.0.0.1:5050/health" -TimeoutSec 5
  if ($health.status -ne "ok") { throw "bad status" }
} catch {
  err "Server failed to start. Check: $env:TEMP\claude-usage.log"
  exit 1
}

$usage = Invoke-RestMethod -Uri "http://127.0.0.1:5050/usage"
ok "Server running on port 5050"
ok "Current: $($usage.current_percent)%  Weekly: $($usage.weekly_percent)%"

Start-Process "http://localhost:5050"

# ── Done ───────────────────────────────────────────────────────────────────
Write-Host ""
sep
Write-Host ""
Write-Host "  All done!" -ForegroundColor Green
Write-Host ""
Write-Host "  Dashboard:  http://localhost:5050" -ForegroundColor Cyan
Write-Host "  Gist URL:   $GIST_URL" -ForegroundColor Cyan
Write-Host "  Gist QR:    http://localhost:5050/qr" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To start again later, run:" -ForegroundColor White
Write-Host "    node $INSTALL_DIR\start.js" -ForegroundColor Cyan
Write-Host ""
