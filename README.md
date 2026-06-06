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

- **Claude Code** installed and used at least once (`~/.claude/projects/` must exist with `.jsonl` files)
- **Node.js** v18 or later — installed automatically if missing
- **GitHub account** (free) — for the Gist relay
- **Rabbit R1** device

---

## Install — one command

Pick the line for your OS and paste it into a terminal. That's it.

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/Musclenerd06/claude-rabbit-usage/main/install.sh | bash
```

### Windows (WSL or native — PowerShell)

For WSL, open your WSL terminal and run the Linux command above.

For native Windows without WSL, open PowerShell and run:

```powershell
iwr -useb https://raw.githubusercontent.com/Musclenerd06/claude-rabbit-usage/main/install.ps1 | iex
```

> **First time running PowerShell scripts?** You may need to allow scripts first:
> `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`

### What the installer does

1. **Checks prerequisites** — Node.js, git, Claude Code logs. Installs Node.js automatically if it's missing (via nvm on Linux/macOS, winget on Windows).
2. **Clones the repo** to `~/claude-rabbit-usage` — or pulls the latest update if it's already there.
3. **Installs dependencies** — runs `npm install` for you.
4. **Asks for a GitHub token** — the only thing you paste. Create one at [github.com/settings/tokens/new](https://github.com/settings/tokens/new) with the `gist` scope only.
5. **Creates a Gist automatically** — no manual steps at gist.github.com.
6. **Saves your `.env`** — credentials stored locally, never shared.
7. **Starts the server** and verifies it's working.
8. **Opens the dashboard** in your browser automatically at `http://localhost:5050`.
9. **Prints a QR code** in the terminal — scan it inside the Rabbit app to connect.

Running the command again on an existing install skips the token prompt and just pulls the latest code and restarts.

---

## After install

### Dashboard

Visit **[http://localhost:5050](http://localhost:5050)** — shows your live token usage, server status, and QR codes.

### Install the Rabbit R1 app

**Option A — QR code (easiest)**
1. Open `http://localhost:5050` → click **QR Codes** tab
2. Scan the **Add App to Rabbit R1** code with your Rabbit to install the app
3. Scan the **Your Gist URL** code inside the app (⚙ → Scan QR) to connect it to your server

**Option B — Manual via Rabbit agent**
1. Open a Rabbit agent conversation
2. Upload `~/claude-rabbit-usage/rabbit/main-src.js`
3. Paste the contents of `rabbit/prompt.txt` as your message
4. The agent applies the file and rebuilds

### Start the server again later

**WSL:** Double-click `Start Claude Usage Bridge.ps1` on your Windows Desktop (the installer copies it there automatically).

**Linux / macOS:**
```bash
node ~/claude-rabbit-usage/start.js
```

**Windows (PowerShell):**
```powershell
node $env:USERPROFILE\claude-rabbit-usage\start.js
```

`start.js` auto-restarts the server if it crashes or if you click Restart in the dashboard.

---

## How the Gist rate limit works

GitHub limits Gist writes to **100 per hour**. The server paces pushes automatically:

- Push interval = `time_until_reset / remaining`, clamped between 36s and 120s
- On a fresh quota this works out to exactly 100 pushes/hour
- On a 403 rate limit, the server backs off until the exact reset timestamp GitHub provides

Logs every push:
```
[gist] Pushed 55% OK  (quota: 87 left, next in ~41s)
```

---

## Calibration

Token caps are pre-set for **Claude Max** plan and back-calculated from real readings. If the percentage shown differs from what `/usage` shows in Claude Code:

1. Note the exact percentage Claude Code shows
2. At the same moment, check `current_tokens` in `curl http://localhost:5050/usage`
3. Calculate: `correct_cap = current_tokens / (claude_percent / 100)`
4. Update `MAX_OUTPUT_TOKENS_5H` or `MAX_OUTPUT_TOKENS_7D` in `server.js` and restart

---

## File reference

| File | Purpose |
|------|---------|
| `server.js` | Bridge server — reads logs, serves HTTP, pushes to Gist |
| `start.js` | Launcher with auto-restart on exit code 42 |
| `install.sh` | One-line installer for Linux / macOS / WSL |
| `install.ps1` | One-line installer for native Windows (PowerShell) |
| `dashboard.html` | Web dashboard served at localhost:5050 |
| `.env` | Your credentials (never committed) |
| `Start Bridge.ps1` | WSL startup script (copied to Desktop by installer) |
| `rabbit/main-src.js` | Rabbit R1 app JavaScript source |
| `rabbit/style-src.css` | Rabbit R1 app styles |
| `rabbit/prompt.txt` | Prompt for Rabbit agent to apply the app files |
| `rabbit/app-qr.png` | QR code to install the Rabbit app |

---

## API endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | Dashboard UI |
| `GET /usage` | JSON — current/weekly percent, tokens, reset times |
| `GET /usage/debug` | Full data including raw token counts |
| `GET /health` | `{"status":"ok"}` |
| `GET /qr` | Page with QR of your Gist URL (scan with Rabbit) |
| `GET /gist-qr.png` | Server-generated Gist QR image |
| `GET /app-qr.png` | QR code to install the Rabbit app |
| `GET /api/status` | Server + Gist health |
| `POST /api/config` | Set credentials — `{"github_token":"..."}` — auto-creates Gist |
| `POST /api/restart` | Graceful restart |

---

## Troubleshooting

**App asks for URL every time it opens**
Re-enter the URL once — the app now waits up to 2.5 seconds for Rabbit's storage to initialise before deciding it's a first launch.

**Gist not updating / showing stale data**
The app shows ⚠ when data is older than 3 minutes. Check server logs for `[gist]` lines. If rate limited, the server backs off and resumes automatically at the next reset.

**Percentage doesn't match Claude Code's `/usage`**
Make sure `RESET_ANCHOR_UTC` matches your actual reset time, or recalibrate the cap (see Calibration above).

**Server won't start**
- Check Node.js: `node --version` (need v18+)
- Check `.env` exists: `cat ~/claude-rabbit-usage/.env`
- Check logs: `~/.claude/projects/` must have `.jsonl` files

**Icon broken in Rabbit app**
Re-apply `rabbit/main-src.js` via the Rabbit agent — the icon is a 32-bit RGBA PNG embedded as a data URI, which works in all WebViews.

---

## How token counting works

The server reads `.jsonl` files from `~/.claude/projects/`. Each line with `message.usage.output_tokens` is a billable assistant turn. Cache tokens are excluded — they don't count toward limits.

Two windows:
- **5-hour window** — resets on a fixed UTC schedule (`RESET_ANCHOR_UTC`)
- **Weekly window** — resets every Monday at 17:00 UTC (1:00 PM Eastern)

---

## Contributing

Pull requests welcome. The server has zero npm dependencies beyond `qrcode` for QR generation. The Rabbit app is a single `main.js` + `style.css` with no build step.
