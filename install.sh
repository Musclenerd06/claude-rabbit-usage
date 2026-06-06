#!/usr/bin/env bash
# Claude Usage Monitor — Installer
# Run this in WSL: bash install.sh

set -e

INSTALL_DIR="$HOME/claude-rabbit-usage"
DESKTOP="/mnt/c/Users/$(cmd.exe /c echo %USERNAME% 2>/dev/null | tr -d '\r')/Desktop"

# ── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

echo ""
echo -e "${CYAN}${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${CYAN}${BOLD}║   Claude Usage Monitor — Installer   ║${NC}"
echo -e "${CYAN}${BOLD}║         by Arnold Haxinator           ║${NC}"
echo -e "${CYAN}${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""

# ── Check prerequisites ───────────────────────────────────────────────────
echo -e "${YELLOW}Checking prerequisites...${NC}"

# Node.js
if ! command -v node &>/dev/null; then
  echo -e "${YELLOW}Node.js not found. Installing via nvm...${NC}"
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  source "$NVM_DIR/nvm.sh"
  nvm install --lts
  nvm use --lts
fi
echo -e "  ${GREEN}✓${NC} Node.js $(node --version)"

# Claude Code logs
if [ ! -d "$HOME/.claude/projects" ]; then
  echo -e "  ${RED}✗ ~/.claude/projects not found${NC}"
  echo -e "  Make sure Claude Code is installed and you've had at least one conversation."
  exit 1
fi
echo -e "  ${GREEN}✓${NC} Claude Code logs found"

# ── Clone or update repo ──────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Setting up files...${NC}"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "  Updating existing install..."
  git -C "$INSTALL_DIR" pull --quiet
else
  git clone https://github.com/Musclenerd06/claude-rabbit-usage.git "$INSTALL_DIR" --quiet
fi
echo -e "  ${GREEN}✓${NC} Files ready at $INSTALL_DIR"

# ── Configure .env ────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}Setup — GitHub Gist (free, takes 2 minutes)${NC}"
echo ""

if [ -f "$INSTALL_DIR/.env" ]; then
  echo -e "  ${GREEN}✓${NC} .env already exists — skipping configuration"
  echo -e "  (Delete $INSTALL_DIR/.env and re-run to reconfigure)"
else
  echo -e "  You need a free GitHub account and two things:"
  echo ""
  echo -e "  ${BOLD}Step 1 — Create a Gist:${NC}"
  echo -e "  → Open: ${CYAN}https://gist.github.com${NC}"
  echo -e "  → Create a PUBLIC gist, filename: ${BOLD}usage.json${NC}, content: ${BOLD}{}${NC}"
  echo -e "  → Copy the ID from the URL (the long string at the end)"
  echo ""
  read -rp "  Paste your Gist ID: " GIST_ID
  while [[ -z "$GIST_ID" ]]; do
    read -rp "  Gist ID cannot be empty. Try again: " GIST_ID
  done

  echo ""
  echo -e "  ${BOLD}Step 2 — Create a GitHub token:${NC}"
  echo -e "  → Open: ${CYAN}https://github.com/settings/tokens/new${NC}"
  echo -e "  → Name it anything, select scope: ${BOLD}gist${NC} only, click Generate"
  echo -e "  → Copy the token (you only see it once)"
  echo ""
  read -rp "  Paste your GitHub token: " GITHUB_TOKEN
  while [[ -z "$GITHUB_TOKEN" ]]; do
    read -rp "  Token cannot be empty. Try again: " GITHUB_TOKEN
  done

  cat > "$INSTALL_DIR/.env" <<EOF
GITHUB_TOKEN=${GITHUB_TOKEN}
GIST_ID=${GIST_ID}
EOF
  chmod 600 "$INSTALL_DIR/.env"
  echo -e "  ${GREEN}✓${NC} .env saved"
fi

# ── Test the server ───────────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}Testing server...${NC}"

# Kill any old instance
fuser -k 5050/tcp 2>/dev/null || true
sleep 1

# Start server temporarily to test
node "$INSTALL_DIR/server.js" > /tmp/claude-usage-test.log 2>&1 &
SERVER_PID=$!
sleep 4

if curl -s http://127.0.0.1:5050/health | grep -q "ok"; then
  echo -e "  ${GREEN}✓${NC} Server started and responding"
  USAGE=$(curl -s http://127.0.0.1:5050/usage)
  CURRENT=$(echo "$USAGE" | grep current_percent | grep -o '[0-9]*' | head -1)
  WEEKLY=$(echo "$USAGE" | grep weekly_percent | grep -o '[0-9]*' | head -1)
  echo -e "  ${GREEN}✓${NC} Reading logs — Current: ${BOLD}${CURRENT}%${NC}  Weekly: ${BOLD}${WEEKLY}%${NC}"
else
  echo -e "  ${RED}✗ Server failed to start. Check: /tmp/claude-usage-test.log${NC}"
  kill $SERVER_PID 2>/dev/null || true
  exit 1
fi

# Stop the test instance — the PS1 script will manage it from Windows
kill $SERVER_PID 2>/dev/null || true
sleep 1

# ── Copy Windows startup script to Desktop ────────────────────────────────
echo ""
echo -e "${YELLOW}Creating Windows shortcut...${NC}"

# Update the PS1 with the correct install path
ESCAPED_DIR=$(echo "$INSTALL_DIR" | sed 's/\//\\\//g')
sed "s|/home/workbench/claude-rabbit-usage|$INSTALL_DIR|g" \
  "$INSTALL_DIR/Start Bridge.ps1" > "/tmp/Start Claude Usage Bridge.ps1"

if [ -d "$DESKTOP" ]; then
  cp "/tmp/Start Claude Usage Bridge.ps1" "$DESKTOP/Start Claude Usage Bridge.ps1"
  echo -e "  ${GREEN}✓${NC} Shortcut placed on your Windows Desktop"
else
  echo -e "  ${YELLOW}!${NC} Could not find Windows Desktop — copy this manually:"
  echo -e "     /tmp/Start Claude Usage Bridge.ps1"
fi

# ── Print Gist URL ────────────────────────────────────────────────────────
source "$INSTALL_DIR/.env"
GIST_URL="https://gist.githubusercontent.com/${GIST_ID}/raw/usage.json"

# Try to get GitHub username
GH_USER=$(curl -s -H "Authorization: token $GITHUB_TOKEN" https://api.github.com/gists/$GIST_ID 2>/dev/null | grep '"login"' | head -1 | cut -d'"' -f4)
if [ -n "$GH_USER" ]; then
  GIST_URL="https://gist.githubusercontent.com/$GH_USER/$GIST_ID/raw/usage.json"
fi

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}${BOLD}║            Install complete!          ║${NC}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${BOLD}To start the monitor:${NC}"
echo -e "  → Double-click ${CYAN}Start Claude Usage Bridge${NC} on your Windows Desktop"
echo ""
echo -e "  ${BOLD}Your Gist URL (for the Rabbit app settings):${NC}"
echo -e "  ${CYAN}${GIST_URL}${NC}"
echo ""
echo -e "  ${BOLD}Rabbit app:${NC}"
echo -e "  → Scan the QR code to add the app to your R1"
echo -e "  → Tap ⚙ in the app and paste your Gist URL above"
echo ""
