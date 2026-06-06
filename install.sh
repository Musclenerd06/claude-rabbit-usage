#!/usr/bin/env bash
# Claude Usage Monitor — Installer
# Run from inside the cloned repo: bash install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}!${NC} $*"; }
err()  { echo -e "  ${RED}✗${NC} $*"; }
sep()  { echo -e "${CYAN}────────────────────────────────────────${NC}"; }

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║   Claude Usage Monitor — Installer   ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Prerequisites ─────────────────────────────────────────────────────────
sep
echo -e "${BOLD}Checking prerequisites...${NC}"
echo ""

# Node.js
if ! command -v node &>/dev/null; then
  warn "Node.js not found. Installing via nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm install --lts --silent
  nvm use --lts --silent
fi
ok "Node.js $(node --version)"

# curl
if ! command -v curl &>/dev/null; then
  err "curl is required but not found. Install it and re-run."
  exit 1
fi
ok "curl found"

# Claude Code logs
CLAUDE_LOG_DIR=""
for d in "$HOME/.claude/projects" "$HOME/.config/claude/projects"; do
  if [ -d "$d" ]; then CLAUDE_LOG_DIR="$d"; break; fi
done
if [ -z "$CLAUDE_LOG_DIR" ]; then
  err "Claude Code logs not found (~/.claude/projects)"
  echo "     Make sure Claude Code is installed and you've had at least one session."
  exit 1
fi
LOG_COUNT=$(find "$CLAUDE_LOG_DIR" -name "*.jsonl" 2>/dev/null | wc -l)
ok "Claude Code logs found ($LOG_COUNT .jsonl files)"

# ── .env setup ────────────────────────────────────────────────────────────
echo ""
sep
echo -e "${BOLD}GitHub Gist setup${NC}"
echo ""

ENV_FILE="$SCRIPT_DIR/.env"
GITHUB_TOKEN=""
GIST_ID=""
GITHUB_USER=""

# Load existing .env values if present
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
  GITHUB_TOKEN="${GITHUB_TOKEN:-}"
  GIST_ID="${GIST_ID:-}"
  GITHUB_USER="${GITHUB_USER:-}"
fi

# Ask for token if missing or invalid
if [ -z "$GITHUB_TOKEN" ]; then
  echo -e "  You need a GitHub token with ${BOLD}gist${NC} scope."
  echo -e "  Create one at: ${CYAN}https://github.com/settings/tokens/new${NC}"
  echo -e "  Select scope: ${BOLD}gist${NC} only → click Generate token"
  echo ""
  while true; do
    read -rsp "  Paste your GitHub token: " GITHUB_TOKEN; echo ""
    [ -n "$GITHUB_TOKEN" ] && break
    warn "Token cannot be empty."
  done
fi

# Validate token
echo ""
echo -e "  Validating token..."
USER_RESP=$(curl -sf -H "Authorization: token $GITHUB_TOKEN" \
  -H "User-Agent: claude-usage-installer" \
  https://api.github.com/user 2>/dev/null || echo '{}')
GITHUB_USER=$(echo "$USER_RESP" | grep '"login"' | head -1 | cut -d'"' -f4)
if [ -z "$GITHUB_USER" ]; then
  err "Token is invalid or has no access. Check it and re-run."
  exit 1
fi
ok "Token valid — GitHub user: ${BOLD}$GITHUB_USER${NC}"

# Create Gist if missing
if [ -z "$GIST_ID" ]; then
  echo -e "  Creating a Gist to relay your usage data..."
  GIST_RESP=$(curl -sf -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" \
    -H "User-Agent: claude-usage-installer" \
    -d '{"description":"Claude Code usage relay","public":true,"files":{"usage.json":{"content":"{}"}}}' \
    https://api.github.com/gists 2>/dev/null || echo '{}')
  GIST_ID=$(echo "$GIST_RESP" | grep '"id"' | head -1 | cut -d'"' -f4)
  if [ -z "$GIST_ID" ]; then
    err "Failed to create Gist. Does your token have the 'gist' scope?"
    exit 1
  fi
  ok "Gist created: ${BOLD}$GIST_ID${NC}"
else
  ok "Gist already configured: ${BOLD}$GIST_ID${NC}"
fi

GIST_URL="https://gist.githubusercontent.com/$GITHUB_USER/$GIST_ID/raw/usage.json"

# Optional reset anchor
echo ""
RESET_ANCHOR="${RESET_ANCHOR_UTC:-}"
if [ -z "$RESET_ANCHOR" ]; then
  echo -e "  ${BOLD}Optional:${NC} your 5-hour reset time in UTC (e.g. 17:30)"
  echo -e "  Find it by watching when Claude Code's usage resets. Press Enter to skip."
  read -rp "  Reset anchor UTC (HH:MM or Enter to skip): " RESET_ANCHOR
fi

# Write .env
{
  echo "GITHUB_TOKEN=$GITHUB_TOKEN"
  echo "GIST_ID=$GIST_ID"
  echo "GITHUB_USER=$GITHUB_USER"
  [ -n "$RESET_ANCHOR" ] && echo "RESET_ANCHOR_UTC=$RESET_ANCHOR"
} > "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok ".env saved"

# ── Test server ───────────────────────────────────────────────────────────
echo ""
sep
echo -e "${BOLD}Testing server...${NC}"
echo ""

fuser -k 5050/tcp 2>/dev/null || true
sleep 1

node "$SCRIPT_DIR/server.js" > /tmp/claude-usage-install-test.log 2>&1 &
SERVER_PID=$!
sleep 4

if ! curl -sf http://127.0.0.1:5050/health | grep -q "ok"; then
  err "Server failed to start."
  echo "     Log: /tmp/claude-usage-install-test.log"
  kill $SERVER_PID 2>/dev/null || true
  exit 1
fi

USAGE=$(curl -s http://127.0.0.1:5050/usage)
CURRENT=$(echo "$USAGE" | grep -o '"current_percent":[^,}]*' | grep -o '[0-9.]*')
WEEKLY=$(echo  "$USAGE" | grep -o '"weekly_percent":[^,}]*'  | grep -o '[0-9.]*')
ok "Server responding"
ok "Current usage: ${BOLD}${CURRENT}%${NC}  Weekly: ${BOLD}${WEEKLY}%${NC}"

kill $SERVER_PID 2>/dev/null || true
sleep 1

# ── Windows Desktop shortcut (WSL only) ───────────────────────────────────
IS_WSL=false
grep -qi "microsoft\|wsl" /proc/version 2>/dev/null && IS_WSL=true

if $IS_WSL; then
  echo ""
  sep
  echo -e "${BOLD}Windows setup...${NC}"
  echo ""
  WIN_USER=$(cmd.exe /c echo %USERNAME% 2>/dev/null | tr -d '\r\n')
  DESKTOP="/mnt/c/Users/$WIN_USER/Desktop"
  PS1_SRC="$SCRIPT_DIR/Start Bridge.ps1"
  PS1_DST="$DESKTOP/Start Claude Usage Bridge.ps1"
  if [ -d "$DESKTOP" ] && [ -f "$PS1_SRC" ]; then
    cp "$PS1_SRC" "$PS1_DST"
    ok "Startup script copied to Windows Desktop"
  else
    warn "Could not find Desktop — copy manually:"
    echo "       $PS1_SRC"
  fi
fi

# ── QR code in terminal ───────────────────────────────────────────────────
echo ""
sep
echo -e "${BOLD}Server QR code${NC} — scan this with your Rabbit R1:"
echo ""

# Use Python (available everywhere) to print a basic QR via qrcode lib,
# falling back to just printing the URL if qrcode isn't installed.
python3 -c "
import sys
try:
    import qrcode
    qr = qrcode.QRCode(border=1)
    qr.add_data('$GIST_URL')
    qr.make(fit=True)
    qr.print_ascii(invert=True)
except ImportError:
    pass
" 2>/dev/null || true

# Also save PNG if node qrcode is available
node -e "
try {
  const QRCode = require('qrcode');
  QRCode.toFile('/tmp/claude-usage-qr.png','$GIST_URL',{width:400,margin:2},e=>{
    if(!e) process.stdout.write('png_saved');
  });
} catch(e) {}
" 2>/dev/null | grep -q "png_saved" && ok "QR saved to /tmp/claude-usage-qr.png" || true

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
sep
echo ""
echo -e "${GREEN}${BOLD}  Install complete!${NC}"
echo ""
echo -e "  ${BOLD}Start the monitor:${NC}"
if $IS_WSL; then
  echo -e "    Double-click ${CYAN}Start Claude Usage Bridge${NC} on your Windows Desktop"
else
  echo -e "    ${CYAN}node $SCRIPT_DIR/start.js${NC}"
fi
echo ""
echo -e "  ${BOLD}Dashboard:${NC}  ${CYAN}http://localhost:5050${NC}"
echo -e "  ${BOLD}Gist URL:${NC}   ${CYAN}$GIST_URL${NC}"
echo -e "  ${BOLD}Server QR:${NC}  Open ${CYAN}http://localhost:5050/qr${NC} in your browser"
echo ""
echo -e "  Paste the Gist URL into the Rabbit app settings,"
echo -e "  or use the QR scanner in the app to fill it in automatically."
echo ""
