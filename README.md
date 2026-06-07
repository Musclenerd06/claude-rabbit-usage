# claude-rabbit-usage

**Claude Code usage monitor for Rabbit R1** — tracks your 5-hour and weekly token limits and displays them live on your device.

Built by Arnold Haxinator.

---

## What it does

Reads your local Claude Code logs every 30 seconds, calculates how much of your token quota you've used, and delivers it to your Rabbit R1 via either a **real-time Cloudflare tunnel** (instant) or a **GitHub Gist relay** (1–5 min lag), or both with automatic failover.

```
~/.claude/projects/**/*.jsonl
          │
          ▼
    server.js (your machine)     ← reads token logs every 30s
          │
          ├── localhost:5050      ← dashboard + API
          │
          ├── Cloudflare Tunnel   ← real-time, direct to R1 (no CDN lag)
          │         │
          │         ▼
          │    Rabbit R1 app      ← 10s refresh, instant updates
          │
          └── GitHub Gist         ← free relay, works when PC is off
                    │             ← data may be 1–5 min behind
                    ▼
             Rabbit R1 app        ← automatic fallback if tunnel drops
```

No paid APIs. No cloud accounts. Just GitHub (free) and your existing Claude Code logs.

---

## Requirements

- **Claude Code** installed and used at least once (`~/.claude/projects/` must exist with `.jsonl` files)
- **Node.js** v18 or later — installed automatically if missing
- **GitHub account** (free) — only needed for Gist relay mode
- **Rabbit R1** device

---

## Install — one command

Pick the line for your OS and paste it into a terminal.

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/Musclenerd06/claude-rabbit-usage/main/install.sh | bash
```

### Windows (WSL)

Open your WSL terminal and run the Linux command above.

> **First time running PowerShell scripts?** You may need to allow scripts first:
> `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

### What the installer does

1. **Checks prerequisites** — Node.js, git, Claude Code logs. Installs Node.js automatically if missing.
2. **Clones the repo** to `~/claude-rabbit-usage` — or updates it if already installed.
3. **Installs dependencies** — runs `npm install`.
4. **Sets up GitHub** — asks for a token with `gist` scope, creates the Gist automatically.
5. **Starts a Cloudflare Tunnel** — free, no account needed. Generates a live URL for your R1.
6. **Starts the server** and verifies it's working.
7. **Opens the dashboard** at `http://localhost:5050`.
8. **Prints QR codes** — scan in the terminal or use the QR Codes tab in the dashboard.

Running the command again on an existing install skips the token prompt and just pulls the latest code and restarts.

---

## After install

### Dashboard

Visit **[http://localhost:5050](http://localhost:5050)** — shows live usage, server status, and QR codes.

### Choose your connection mode

The Setup tab in the dashboard asks how your R1 should receive data:

| Mode | Description |
|------|-------------|
| **Real-time only** | Direct tunnel from your PC. Instant updates. Requires PC to be on. |
| **Gist relay only** | GitHub stores your data. Works when PC is off. May lag 1–5 min. |
| **Both (recommended)** | Real-time first. Automatically falls back to Gist if tunnel drops. |

### Install the Rabbit R1 app

1. Open `http://localhost:5050` → click **QR Codes** tab
2. Scan the **Rabbit R1 App** QR (orange) to install the app on your device
3. Inside the app, tap **⚙ → Scan QR** and scan the **Live Endpoint** QR (green) to connect

If you chose Gist-only mode, scan the **Gist Fallback** QR instead.

### Start the server again later

**WSL:** Double-click `Start Claude Usage Bridge.ps1` on your Windows Desktop.

**Linux / macOS:**
```bash
node ~/claude-rabbit-usage/start.js
```

`start.js` auto-restarts the server if it crashes and relaunches the tunnel.

---

## Real-time vs Gist lag

| | Real-time (tunnel) | Gist relay |
|-|-------------------|------------|
| Latency | ~0–30 seconds | 1–5 minutes |
| Requires PC on | Yes | No (shows last pushed data) |
| Requires internet | Yes | Yes |
| Free | Yes | Yes |
| Automatic | Yes (tunnel auto-starts) | Yes |

The tunnel is just a Cloudflare proxy (`cloudflared tunnel --url`) — no configuration or account needed. It generates a new random URL each session, which the server detects and saves to `.env` automatically.

The app refreshes every 10 seconds when on a tunnel connection. The server itself re-collects from Claude Code logs every 30 seconds (or immediately when a log file changes).

---

## How the Gist rate limit works

GitHub limits Gist writes to **100 per hour**. The server paces pushes automatically:

- Push interval = `time_until_reset / remaining`, clamped between 36s and 120s
- On a 403 rate limit, the server backs off until the exact reset timestamp GitHub provides
- Backoff is capped at 20 minutes — a watchdog clears it if it gets stuck

Logs every push:
```
[gist] Pushed 55% OK  (quota: 87 left, next in ~41s)
```

---

## Calibration

Token caps are pre-set for **Claude Max** plan. If the percentage shown differs from what `/usage` shows in Claude Code:

1. Note the exact percentage Claude Code shows
2. At the same moment, check `current_tokens` in `curl http://localhost:5050/usage`
3. Calculate: `correct_cap = current_tokens / (claude_percent / 100)`
4. Update `MAX_OUTPUT_TOKENS_5H` or `MAX_OUTPUT_TOKENS_7D` in `server.js` and restart

---

## File reference

| File | Purpose |
|------|---------|
| `server.js` | Bridge server — reads logs, serves HTTP, pushes to Gist, runs tunnel |
| `start.js` | Launcher with auto-restart |
| `install.sh` | One-line installer for Linux / macOS / WSL |
| `dashboard.html` | Web dashboard at localhost:5050 |
| `.env` | Your credentials (never committed) |
| `Start Bridge.ps1` | WSL startup script (copied to Desktop by installer) |
| `cloudflared` | Cloudflare tunnel binary (downloaded by installer) |
| `rabbit/main-src.js` | Rabbit R1 app source |
| `rabbit/style-src.css` | Rabbit R1 app styles |
| `rabbit/prompt.txt` | Prompt for Rabbit agent to apply the app |

---

## API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard UI |
| `GET /usage` | JSON — current/weekly percent, tokens, reset times |
| `GET /usage/debug` | Full data including raw token counts |
| `GET /health` | `{"status":"ok"}` |
| `GET /api/status` | Server status + `tunnel_url`, `gist_url`, `app_url` |
| `POST /api/config` | Set credentials — `{"github_token":"..."}` — auto-creates Gist |
| `POST /api/tunnel/start` | Spawn cloudflared, wait up to 20s for URL, save to .env |
| `POST /api/restart` | Graceful restart |
| `GET /qr` | Page with all three QR codes (tunnel, gist, app) |
| `GET /tunnel-qr.png` | QR image for live tunnel endpoint |
| `GET /gist-qr.png` | QR image for Gist fallback URL |
| `GET /app-qr.png` | QR to install the Rabbit app |

---

## Troubleshooting

**App shows "Gist fallback" in yellow**
The Cloudflare tunnel is down. The app has automatically switched to the Gist URL. Start the tunnel again from the Setup tab or by running `Start Claude Usage Bridge.ps1`.

**Tunnel URL not detected after start**
Cloudflare sometimes takes longer than 20 seconds. Click "Start Live Connection" again in Setup, or restart the bridge.

**App asks for URL every time it opens**
Re-enter the URL once — the app waits up to 2.5 seconds for Rabbit's storage to initialise before deciding it's a first launch.

**Gist not updating / showing stale data**
The app shows ⚠ when data is older than 3 minutes. Check server logs for `[gist]` lines. If rate limited, the server backs off and resumes automatically.

**Percentage doesn't match Claude Code's `/usage`**
Make sure `RESET_ANCHOR_UTC` matches your actual reset time, or recalibrate the cap (see Calibration above).

**Server won't start**
- Check Node.js: `node --version` (need v18+)
- Check `.env` exists: `cat ~/claude-rabbit-usage/.env`
- Check logs: `~/.claude/projects/` must have `.jsonl` files

---

## How token counting works

The server reads `.jsonl` files from `~/.claude/projects/`. Each line with `message.usage.output_tokens` is a billable assistant turn. Cache tokens are excluded.

Two windows:
- **5-hour window** — resets on a fixed UTC schedule (`RESET_ANCHOR_UTC`)
- **Weekly window** — resets every Monday at 17:00 UTC (1:00 PM Eastern)

---

## Contributing

Pull requests welcome. The server has zero npm dependencies beyond `qrcode` for QR generation. The Rabbit app is a single `main.js` + `style.css` with no build step.
