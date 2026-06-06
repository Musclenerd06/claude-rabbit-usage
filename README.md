# claude-rabbit-usage

**Claude Code usage monitor for Rabbit R1** — tracks your 5-hour and weekly token limits and displays them live on your device.

Built by Arnold Haxinator.

---

## What it does

Reads your local Claude Code logs every 30 seconds, calculates how much of your token quota you've used, and pushes that data to a GitHub Gist. Your Rabbit R1 fetches the Gist and displays a live dashboard with progress bars, reset timers, and a status indicator.

```
~/.claude/projects/**/*.jsonl
          │
          ▼
    server.js (your machine)     ← reads token logs every 30–60s
          │
          ├── localhost:5050      ← dashboard + API
          │
          └── GitHub Gist        ← free public relay
                   │
                   ▼
            Rabbit R1 app        ← fetches Gist, displays live usage
```

No paid APIs. No cloud accounts. Just GitHub (free) and your existing Claude Code logs.

---

## Requirements

- **Claude Code** installed and used on this machine (`~/.claude/projects/` must exist with `.jsonl` files)
- **Node.js** v18 or later (`node --version` to check)
- **GitHub account** (free) — for the Gist relay
- **Rabbit R1** device

**Platform support:**
- WSL2 on Windows (recommended — use `Start Bridge.ps1`)
- Native Linux or macOS (run `node start.js` directly)

---

## Quick install

Run this in your terminal (WSL on Windows, or native Linux/macOS):

```bash
git clone https://github.com/Musclenerd06/claude-rabbit-usage.git
cd claude-rabbit-usage
bash install.sh
```

The installer will:
1. Check for Node.js and Claude Code logs
2. Ask for a GitHub token (with `gist` scope) — **that's the only thing you need to paste**
3. Auto-create the GitHub Gist for you
4. Write your `.env` file
5. Test the server and show your current usage
6. On WSL: copy the startup script to your Windows Desktop
7. Print a QR code you can scan with the Rabbit app

---

## Manual setup

### 1 — Create a GitHub token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. Click **Generate new token (classic)**
3. Name it anything (e.g. `claude-usage`)
4. Select **only** the `gist` scope
5. Click **Generate token** and copy it — you only see it once

### 2 — Configure .env

```bash
cp .env.example .env
nano .env
```

```env
GITHUB_TOKEN=ghp_your_token_here
GIST_ID=                          # leave blank — server creates it on first run
GITHUB_USER=your_github_username
RESET_ANCHOR_UTC=17:30            # optional — your known 5h reset time in UTC
```

> **RESET_ANCHOR_UTC** — Claude Code resets usage on fixed 5-hour windows. If you know one of your reset times (visible in `/usage` output), set it here as `HH:MM` UTC. Leave it out and the server uses a rolling window instead.

### 3 — Start the server

**Windows (WSL):** Double-click `Start Bridge.ps1` on your Desktop (created by the installer), or from WSL:
```bash
node start.js
```

**Linux / macOS:**
```bash
node start.js
```

`start.js` is a launcher that automatically restarts the server if it crashes or if you trigger a restart from the dashboard.

### 4 — Open the dashboard

Visit **[http://localhost:5050](http://localhost:5050)** in your browser. It shows:
- Your current and weekly token usage with live bars
- Server status and Gist push health
- A QR code for the Rabbit app endpoint

### 5 — Install the Rabbit R1 app

Two options:

**Option A — QR code (easiest)**
1. Open `http://localhost:5050/qr` in your browser
2. Show the QR code to your Rabbit R1 camera from within the app's Settings → Scan QR

**Option B — Manual**
1. Open a Rabbit agent conversation
2. Upload `rabbit/main-src.js` from this repo
3. Paste the contents of `rabbit/prompt.txt` as your message
4. The agent replaces the app files and rebuilds

### 6 — Connect the app to your server

When the Rabbit app opens for the first time it shows Settings automatically. Either:
- Scan the QR code from `http://localhost:5050/qr` using the in-app scanner
- Or paste your Gist URL manually:
  ```
  https://gist.githubusercontent.com/YOUR_USERNAME/YOUR_GIST_ID/raw/usage.json
  ```

The URL is saved persistently — the app won't ask again on restart.

---

## How the Gist rate limit works

GitHub limits Gist writes to **100 per hour**. The server paces pushes automatically using the `x-ratelimit-remaining` header from each response:

- Push interval = `time_until_reset / remaining`, clamped between 36s and 120s
- On a full fresh quota this works out to exactly 100 pushes/hour
- If you hit a rate limit, the server backs off until the exact reset timestamp GitHub provides

The server logs every push:
```
[gist] Pushed 24% OK  (quota: 87 left, next in ~41s)
```

---

## Calibration

Token caps are pre-set for **Claude Max** plan. If the percentage shown differs from what `/usage` shows in Claude Code:

1. Note the exact percentage Claude Code shows: `/usage`
2. At the same moment, check: `curl http://localhost:5050/usage/debug`
3. Note the `current_tokens` value
4. Calculate: `correct_cap = current_tokens / (claude_percent / 100)`
5. Set `MAX_OUTPUT_TOKENS_5H` in `server.js` to the new value and restart

---

## File reference

| File | Purpose |
|------|---------|
| `server.js` | Bridge server — reads logs, serves HTTP, pushes to Gist |
| `start.js` | Launcher with auto-restart on exit code 42 |
| `install.sh` | One-command installer (creates Gist, writes .env, tests) |
| `dashboard.html` | Web dashboard served at localhost:5050 |
| `.env` | Your credentials (never committed) |
| `.env.example` | Template |
| `Start Bridge.ps1` | Windows/WSL startup script |
| `rabbit/main-src.js` | Rabbit R1 app JavaScript source |
| `rabbit/style-src.css` | Rabbit R1 app styles |
| `rabbit/prompt.txt` | Strict prompt for Rabbit agent to apply the files |
| `rabbit/app-qr.png` | QR code to install the Rabbit app |

---

## API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard UI |
| `GET /usage` | Clean JSON — current/weekly percent, reset times |
| `GET /usage/debug` | Full data including raw token counts and method used |
| `GET /health` | `{"status":"ok"}` — for uptime checks |
| `GET /qr` | Page with QR code of your Gist URL (scan with Rabbit) |
| `GET /app-qr.png` | QR code to install the Rabbit app |
| `GET /api/status` | Server + Gist health status |
| `POST /api/config` | Hot-reload credentials (`{gist_id, github_token}`) |
| `POST /api/restart` | Graceful restart (exits with code 42 for start.js) |

---

## Troubleshooting

**App asks for URL every time it opens**
The URL is saved to both `localStorage` and Rabbit's `creationStorage`. If it keeps asking, the storage may have been cleared — re-enter the URL once and it will persist.

**Gist not updating / showing stale data**
- The app shows a ⚠ warning when data is older than 3 minutes
- Check server logs for `[gist]` lines — it logs every push attempt
- If rate limited, the server backs off automatically and resumes at the next quota window

**Percentage doesn't match Claude Code's `/usage`**
- Make sure `RESET_ANCHOR_UTC` in `.env` matches your actual reset time
- Recalibrate `MAX_OUTPUT_TOKENS_5H` (see Calibration section above)

**Server won't start**
- Check Node.js version: `node --version` (need v18+)
- Check `.env` exists and has no extra spaces: `cat .env`
- Check Claude Code logs exist: `ls ~/.claude/projects/`

**Broken icon in Rabbit app**
If the icon shows as a broken image, re-apply `rabbit/main-src.js` using the prompt — the icon was updated to an SVG which works in all WebViews.

---

## How token counting works

The server reads `.jsonl` files from `~/.claude/projects/` — the same logs Claude Code uses internally. Each line that contains `message.usage.output_tokens` is a billable assistant turn. Cache tokens (`cache_read_input_tokens`, `cache_creation_input_tokens`) are excluded — they don't count toward limits.

Usage is calculated against two fixed windows:
- **5-hour window** — resets on a fixed UTC schedule (set `RESET_ANCHOR_UTC` to match)
- **Weekly window** — resets every Monday at 17:00 UTC (1:00 PM Eastern)

---

## Contributing

Pull requests welcome. The server has zero npm dependencies — Node.js built-ins only. The Rabbit app is a single `main.js` + `style.css` with no build step required.
