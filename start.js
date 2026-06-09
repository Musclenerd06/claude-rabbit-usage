#!/usr/bin/env node
// Launcher — starts server.js + cloudflared tunnel together.
// - Downloads cloudflared automatically if the binary is missing.
// - Restarts the server whenever cloudflared gets a new tunnel URL.
// - Auto-restarts both if either crashes.
'use strict';
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

const DIR      = __dirname;
const SERVER   = path.join(DIR, 'server.js');
const CF_BIN   = path.join(DIR, 'cloudflared');
const ENV_FILE = path.join(DIR, '.env');

let serverProc  = null;
let cfProc      = null;
let knownTunnel = '';
let serverReady = false;

// ── Helpers ──────────────────────────────────────────────────────
function saveTunnelEnv(url) {
  try {
    let txt = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
    txt = txt.match(/^TUNNEL_URL=/m)
      ? txt.replace(/^TUNNEL_URL=.*/m, `TUNNEL_URL=${url}`)
      : txt.trimEnd() + '\nTUNNEL_URL=' + url + '\n';
    fs.writeFileSync(ENV_FILE, txt);
  } catch (_) {}
}

// ── Download cloudflared if missing ──────────────────────────────
function ensureCloudflared() {
  if (fs.existsSync(CF_BIN)) return true;
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const url  = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
  console.log('[launcher] cloudflared missing — downloading...');
  try {
    execSync(`curl -fsSL "${url}" -o "${CF_BIN}" && chmod +x "${CF_BIN}"`, { timeout: 60000 });
    console.log('[launcher] cloudflared ready');
    return true;
  } catch (e) {
    console.error('[launcher] Could not download cloudflared:', e.message);
    return false;
  }
}

// ── Server ───────────────────────────────────────────────────────
function launchServer() {
  console.log('[launcher] Starting server...');
  const proc = spawn(process.execPath, [SERVER], {
    stdio: 'inherit',
    env: { ...process.env },
    cwd: DIR,
  });
  serverProc = proc;
  serverReady = false;
  // Give server a moment to bind before we consider it ready
  setTimeout(() => { serverReady = true; }, 3000);

  proc.on('exit', (code, signal) => {
    serverProc = null;
    if (code === 42 || signal === 'SIGTERM') {
      const reason = code === 42 ? 'restart requested' : 'tunnel URL update';
      console.log(`[launcher] Server stopping (${reason}) — restarting in 1s...`);
      setTimeout(launchServer, 1000);
    } else {
      console.log(`[launcher] Server exited (code=${code}). Stopping.`);
      process.exit(code ?? 1);
    }
  });
}

// ── Cloudflared ──────────────────────────────────────────────────
function startCloudflared() {
  if (cfProc) { try { cfProc.kill(); } catch (_) {} cfProc = null; }

  let cf;
  try {
    cf = spawn(CF_BIN, ['tunnel', '--url', 'http://127.0.0.1:5050'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    console.error('[launcher] Failed to spawn cloudflared:', e.message);
    setTimeout(startCloudflared, 10000);
    return;
  }
  cfProc = cf;
  console.log(`[launcher] cloudflared started (PID ${cf.pid})`);

  const onChunk = (chunk) => {
    const text  = chunk.toString();
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && match[0] !== knownTunnel) {
      knownTunnel = match[0];
      console.log('[launcher] Tunnel URL:', knownTunnel);
      // Update env so the next server spawn picks it up
      process.env.TUNNEL_URL = knownTunnel;
      saveTunnelEnv(knownTunnel);
      // Restart server so it reads the new URL
      if (serverProc && serverReady) {
        console.log('[launcher] Restarting server to apply new tunnel URL...');
        serverProc.kill('SIGTERM');
      }
    }
  };
  cf.stdout.on('data', onChunk);
  cf.stderr.on('data', onChunk);

  cf.on('exit', () => {
    console.log('[launcher] cloudflared exited — restarting in 5s...');
    cfProc = null;
    setTimeout(startCloudflared, 5000);
  });
}

// ── Cleanup on exit ──────────────────────────────────────────────
process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
function shutdown(sig) {
  console.log(`\n[launcher] ${sig} — shutting down...`);
  if (cfProc)     { try { cfProc.kill();     } catch (_) {} }
  if (serverProc) { try { serverProc.kill(); } catch (_) {} }
  process.exit(0);
}

// ── Boot ─────────────────────────────────────────────────────────
// Kill any leftover cloudflared from a previous session
try {
  const { execSync } = require('child_process');
  execSync('pkill -f "cloudflared tunnel" 2>/dev/null || true', { shell: true });
} catch (_) {}

// Load .env so TUNNEL_URL etc. are available before first server spawn
try {
  const envLines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of envLines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch (_) {}

launchServer();
if (ensureCloudflared()) startCloudflared();
