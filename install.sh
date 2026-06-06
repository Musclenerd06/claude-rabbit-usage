#!/usr/bin/env bash
# Claude Usage Monitor — Installer (Linux + macOS + WSL)
# curl -fsSL https://raw.githubusercontent.com/Musclenerd06/claude-rabbit-usage/main/install.sh | bash

set -e

REPO_URL="https://github.com/Musclenerd06/claude-rabbit-usage.git"
INSTALL_DIR="$HOME/claude-rabbit-usage"

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

# ── Detect platform ────────────────────────────────────────────────────────
PLATFORM="linux"
if [[ "$OSTYPE" == "darwin"* ]]; then
  PLATFORM="mac"
elif grep -qi "microsoft\|wsl" /proc/version 2>/dev/null; then
  PLATFORM="wsl"
fi
ok "Platform: $PLATFORM"

kill_port() {
  if [ "$PLATFORM" = "mac" ]; then
    lsof -ti tcp:5050 2>/dev/null | xargs kill -9 2>/dev/null || true
  else
    fuser -k 5050/tcp 2>/dev/null || true
  fi
}

open_browser() {
  if [ "$PLATFORM" = "wsl" ]; then
    cmd.exe /c start http://localhost:5050 2>/dev/null || true
  elif [ "$PLATFORM" = "mac" ]; then
    open http://localhost:5050 2>/dev/null || true
  else
    xdg-open http://localhost:5050 2>/dev/null || true
  fi
}

# ── Prerequisites ──────────────────────────────────────────────────────────
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

if ! command -v git &>/dev/null; then
  err "git is required. Install it and re-run."
  exit 1
fi
ok "git $(git --version | cut -d' ' -f3)"

# Claude Code logs
CLAUDE_LOG_DIR=""
for d in "$HOME/.claude/projects" "$HOME/.config/claude/projects" \
         "$HOME/Library/Application Support/Claude/projects"; do
  if [ -d "$d" ]; then CLAUDE_LOG_DIR="$d"; break; fi
done
if [ -z "$CLAUDE_LOG_DIR" ]; then
  err "Claude Code logs not found. Make sure Claude Code is installed and you've had at least one session."
  exit 1
fi
LOG_COUNT=$(find "$CLAUDE_LOG_DIR" -name "*.jsonl" 2>/dev/null | wc -l)
ok "Claude Code logs found ($LOG_COUNT .jsonl files)"

# ── Clone / update repo ────────────────────────────────────────────────────
echo ""
sep
echo -e "${BOLD}Getting latest code...${NC}"
echo ""

if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only origin main 2>&1 | tail -1
  ok "Updated — $INSTALL_DIR"
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Cloned to $INSTALL_DIR"
fi

cd "$INSTALL_DIR"
npm install --silent
ok "Dependencies installed"

# ── GitHub / Gist setup ────────────────────────────────────────────────────
echo ""
sep
echo -e "${BOLD}GitHub setup${NC}"
echo ""

ENV_FILE="$INSTALL_DIR/.env"
GITHUB_TOKEN=""; GIST_ID=""; GITHUB_USER=""

if [ -f "$ENV_FILE" ]; then
  set -a; source "$ENV_FILE"; set +a
  GITHUB_TOKEN="${GITHUB_TOKEN:-}"; GIST_ID="${GIST_ID:-}"; GITHUB_USER="${GITHUB_USER:-}"
fi

if [ -n "$GITHUB_TOKEN" ] && [ -n "$GIST_ID" ]; then
  ok "Already configured — user: ${BOLD}$GITHUB_USER${NC}  Gist: ${BOLD}$GIST_ID${NC}"
else
  echo -e "  You need a GitHub token with ${BOLD}gist${NC} scope."
  echo -e "  Create one at: ${CYAN}https://github.com/settings/tokens/new${NC}"
  echo -e "  Select scope: ${BOLD}gist${NC} only → Generate token"
  echo ""
  while true; do
    read -rsp "  Paste your GitHub token: " GITHUB_TOKEN; echo ""
    [ -n "$GITHUB_TOKEN" ] && break
    warn "Token cannot be empty."
  done

  echo ""
  echo -e "  Validating token..."
  USER_RESP=$(curl -sf -H "Authorization: token $GITHUB_TOKEN" \
    -H "User-Agent: claude-usage-installer" \
    https://api.github.com/user 2>/dev/null || echo '{}')
  GITHUB_USER=$(echo "$USER_RESP" | grep '"login"' | head -1 | cut -d'"' -f4)
  if [ -z "$GITHUB_USER" ]; then
    err "Token invalid or missing gist scope."
    exit 1
  fi
  ok "Token valid — GitHub user: ${BOLD}$GITHUB_USER${NC}"

  echo -e "  Creating Gist..."
  GIST_RESP=$(curl -sf -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" \
    -H "User-Agent: claude-usage-installer" \
    -d '{"description":"Claude Code usage relay","public":true,"files":{"usage.json":{"content":"{}"}}}' \
    https://api.github.com/gists 2>/dev/null || echo '{}')
  GIST_ID=$(echo "$GIST_RESP" | grep '"id"' | head -1 | cut -d'"' -f4)
  if [ -z "$GIST_ID" ]; then
    err "Failed to create Gist. Does your token have 'gist' scope?"
    exit 1
  fi
  ok "Gist created: ${BOLD}$GIST_ID${NC}"

  echo ""
  RESET_ANCHOR="${RESET_ANCHOR_UTC:-}"
  if [ -z "$RESET_ANCHOR" ]; then
    echo -e "  ${BOLD}Optional:${NC} your 5-hour reset time in UTC (e.g. 17:30). Press Enter to skip."
    read -rp "  Reset anchor UTC (HH:MM or Enter): " RESET_ANCHOR
  fi

  { echo "GITHUB_TOKEN=$GITHUB_TOKEN"
    echo "GIST_ID=$GIST_ID"
    echo "GITHUB_USER=$GITHUB_USER"
    [ -n "$RESET_ANCHOR" ] && echo "RESET_ANCHOR_UTC=$RESET_ANCHOR"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok ".env saved"
fi

GIST_URL="https://gist.githubusercontent.com/$GITHUB_USER/$GIST_ID/raw/usage.json"

# ── WSL: copy startup script to Windows Desktop ────────────────────────────
if [ "$PLATFORM" = "wsl" ]; then
  echo ""
  sep
  echo -e "${BOLD}Windows setup...${NC}"
  echo ""
  WIN_USER=$(cmd.exe /c echo %USERNAME% 2>/dev/null | tr -d '\r\n')
  DESKTOP="/mnt/c/Users/$WIN_USER/Desktop"
  PS1_SRC="$INSTALL_DIR/Start Bridge.ps1"
  PS1_DST="$DESKTOP/Start Claude Usage Bridge.ps1"
  if [ -d "$DESKTOP" ] && [ -f "$PS1_SRC" ]; then
    cp "$PS1_SRC" "$PS1_DST"
    ok "Startup script copied to Windows Desktop"
  else
    warn "Could not copy to Desktop — do it manually: $PS1_SRC"
  fi
fi

# ── Start server ───────────────────────────────────────────────────────────
echo ""
sep
echo -e "${BOLD}Starting server...${NC}"
echo ""

kill_port
sleep 1

node "$INSTALL_DIR/start.js" > /tmp/claude-usage.log 2>&1 &
sleep 4

if ! curl -sf http://127.0.0.1:5050/health | grep -q "ok"; then
  err "Server failed to start. Check: /tmp/claude-usage.log"
  exit 1
fi

USAGE=$(curl -s http://127.0.0.1:5050/usage)
CURRENT=$(echo "$USAGE" | grep -o '"current_percent":[^,}]*' | grep -o '[0-9.]*')
WEEKLY=$(echo  "$USAGE" | grep -o '"weekly_percent":[^,}]*'  | grep -o '[0-9.]*')
ok "Server running on port 5050"
ok "Current: ${BOLD}${CURRENT}%${NC}  Weekly: ${BOLD}${WEEKLY}%${NC}"

open_browser

# ── Gist QR in terminal ────────────────────────────────────────────────────
echo ""
sep
echo -e "${BOLD}Gist QR code${NC} — scan inside the Rabbit app (⚙ → Scan QR):"
echo ""
python3 -c "
try:
    import qrcode
    qr = qrcode.QRCode(border=1)
    qr.add_data('$GIST_URL')
    qr.make(fit=True)
    qr.print_ascii(invert=True)
except ImportError:
    print('  (install python3-qrcode to see QR here)')
" 2>/dev/null || true

# ── Done ───────────────────────────────────────────────────────────────────
echo ""
sep
echo ""
echo -e "${GREEN}${BOLD}  All done!${NC}"
echo ""
echo -e "  ${BOLD}Dashboard:${NC}   ${CYAN}http://localhost:5050${NC}"
echo -e "  ${BOLD}Gist URL:${NC}    ${CYAN}$GIST_URL${NC}"
echo -e "  ${BOLD}Gist QR:${NC}     ${CYAN}http://localhost:5050/qr${NC}"
echo ""
if [ "$PLATFORM" = "wsl" ]; then
  echo -e "  To start again: double-click ${CYAN}Start Claude Usage Bridge${NC} on your Desktop"
else
  echo -e "  To start again: ${CYAN}node $INSTALL_DIR/start.js${NC}"
fi
echo ""
