# Claude Usage Monitor for Rabbit R1

Displays your Claude Code token usage (5-hour rolling window + weekly) on the Rabbit R1 screen. Accurate, live, and stays in sync with what `/usage` shows in Claude Code.

Created by Arnold Haxinator.

---

## How it works

```
~/.claude/projects/**/*.jsonl
         │
         ▼
   server.js (WSL)          ← reads token logs every 30s
         │
         ├── localhost:5050  ← local HTTP endpoint
         │
         └── GitHub Gist    ← public relay, pushed every 30s
                  │
                  ▼
           Rabbit R1 app    ← fetches Gist, displays usage
```

No paid APIs. No cloud accounts. Just GitHub (free) and your existing Claude Code logs.

---

## Prerequisites

- Windows with WSL2 (Ubuntu)
- Claude Code actively used on this machine (`~/.claude/projects/` must exist)
- GitHub account (free)
- Rabbit R1 device
- Node.js installed in WSL (`node --version` to check)

---

## Quick install (recommended)

Run this single command in WSL:

```bash
bash <(curl -sSL https://raw.githubusercontent.com/Musclenerd06/claude-rabbit-usage/main/install.sh)
```

It checks prerequisites, clones the repo, walks you through Gist setup, writes `.env`, tests the server, and puts a shortcut on your Windows Desktop. When it finishes, copy the Gist URL it prints into the Rabbit app settings.

---

## Manual setup

### Step 1 — Clone the repo (in WSL)

```bash
git clone https://github.com/Musclenerd06/claude-rabbit-usage.git ~/claude-rabbit-usage
cd ~/claude-rabbit-usage
```

### Step 2 — Create a GitHub Gist

1. Go to [gist.github.com](https://gist.github.com)
2. Create a **public** gist
3. Filename: `usage.json`
4. Content: `{}`
5. Click **Create public gist**
6. Copy the Gist ID from the URL — it's the long string at the end:
   `https://gist.github.com/YOUR_USERNAME/THIS_PART_IS_THE_ID`

### Step 3 — Create a GitHub token

1. Go to GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)**
2. Click **Generate new token (classic)**
3. Give it a name like `claude-usage-gist`
4. Select scope: **gist** only
5. Click **Generate token**
6. Copy the token — you only see it once

### Step 4 — Configure the server

```bash
cd ~/claude-rabbit-usage
cp .env.example .env
nano .env
```

Fill in your values:
```
GITHUB_TOKEN=ghp_your_token_here
GIST_ID=your_gist_id_here
```

Save and close (`Ctrl+X`, `Y`, `Enter`).

Lock down the file:
```bash
chmod 600 .env
```

### Step 5 — Test the server

```bash
node server.js
```

You should see output like:
```
[collector] Scanning ~/.claude/projects ...
[server] Listening on http://127.0.0.1:5050
[gist] Pushed usage.json OK
```

Test it in another terminal:
```bash
curl http://localhost:5050/usage
```

You should get JSON with `current_percent`, `weekly_percent`, etc.

Press `Ctrl+C` to stop for now.

### Step 6 — Start automatically on Windows

Double-click `Start Bridge.ps1` on Windows.

> If PowerShell blocks it, right-click → **Run with PowerShell**, or open PowerShell and run:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

The script starts the server in the background. You can close the window — the server keeps running in WSL.

### Step 7 — Set up the Rabbit R1 app

1. Open a new Rabbit agent conversation
2. Upload both files from the `rabbit/` folder:
   - `rabbit/main-src.js`
   - `rabbit/style-src.css`
3. Paste the contents of `rabbit/prompt.txt` as your message
4. The agent will replace the app files and rebuild

Your Gist URL (what goes into the app's endpoint) is:
```
https://gist.githubusercontent.com/YOUR_USERNAME/YOUR_GIST_ID/raw/usage.json
```

The app comes pre-configured with the original creator's Gist. You need to change it:
- Open the app on Rabbit → tap ⚙ (Options) → paste your Gist URL → Save

---

## Calibration (important)

The token caps are pre-set for a **Claude Max** plan. If your usage percentage looks off compared to `/usage` in Claude Code, recalibrate:

1. Run `/usage` in Claude Code and note the percentage shown
2. Check what our server shows: `curl http://localhost:5050/usage`
3. At the same moment, note `current_tokens` from the server
4. Calculate: `new_cap = current_tokens / (claude_code_percent / 100)`
5. Edit `server.js` line with `MAX_OUTPUT_TOKENS_5H` and set the new value
6. Restart the server

The weekly cap (`MAX_OUTPUT_TOKENS_7D`) is accurate out of the box and rarely needs changing.

---

## File reference

| File | Purpose |
|------|---------|
| `server.js` | WSL bridge server — reads logs, serves HTTP, pushes to Gist |
| `.env` | Your GitHub token and Gist ID (never commit this) |
| `.env.example` | Template for `.env` |
| `Start Bridge.ps1` | Windows shortcut to start the server |
| `rabbit/main-src.js` | Rabbit R1 app JavaScript |
| `rabbit/style-src.css` | Rabbit R1 app styles |
| `rabbit/prompt.txt` | Prompt to give the Rabbit agent |

---

## Endpoints

Once running, the server exposes:

- `http://localhost:5050/usage` — clean JSON (what the Gist mirrors)
- `http://localhost:5050/usage/debug` — full data including raw token counts
- `http://localhost:5050/health` — returns `{"status":"ok"}`

---

## Troubleshooting

**Server won't start**
- Check Node.js is installed: `node --version`
- Check `.env` has no extra spaces around the `=`
- Check `~/.claude/projects/` exists and has `.jsonl` files

**Gist not updating**
- Gist pushes every 30 seconds — if stale, wait one cycle and refresh
- Check your token has `gist` scope
- Check the token hasn't expired

**Rabbit shows wrong percentage**
- Tap ⚙ → verify the Gist URL is yours, not the original creator's
- The Gist URL must end in `/raw/usage.json`
- If percentage is consistently off, recalibrate (see above)

**Percentage always 100%**
- This means no `.jsonl` files were found — Claude Code logs are missing
- Run Claude Code on the same machine so logs are generated at `~/.claude/projects/`

---

## Notes

- Token counting is based on `output_tokens` from local JSONL logs — the same data Claude Code uses for its own `/usage` display
- ~1-2% drift is normal; recalibrate whenever it drifts more than 3-4%
- The weekly reset is Monday 17:00 UTC (1:00 PM Eastern) matching Anthropic's schedule
- Cache tokens (Hermes/automation tools) are excluded — they don't count toward limits
