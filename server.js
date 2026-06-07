#!/usr/bin/env node
/**
 * Claude Code Usage Collector + Bridge Server
 *
 * Architecture:
 *   ~/.claude/**\/*.jsonl  →  collector  →  localhost:5050  →  Cloudflare Tunnel  →  Rabbit
 *
 * Zero npm dependencies — pure Node.js built-ins only.
 * Also mirrors output to /mnt/c/Rabbit/data/usage.json as a bonus fallback.
 *
 * Environment variables:
 *   PORT            — HTTP port (default 5050)
 *   BIND            — bind address (default 127.0.0.1; set 0.0.0.0 for direct external)
 *   API_KEY         — shared secret Rabbit sends as x-api-key header (leave empty to disable)
 *   SCAN_INTERVAL   — seconds between scans (default 30)
 *   DEBUG           — set to 1 for verbose logging
 */

'use strict';

const fs    = require('fs');
const path  = require('path');
const http  = require('http');
const https = require('https');
const os    = require('os');
const { exec } = require('child_process');

let QRCode = null;
try { QRCode = require('qrcode'); } catch (_) {}

async function qrPng(text) {
  if (!QRCode) return null;
  return QRCode.toBuffer(text, { width: 300, margin: 2 });
}

// ─────────────────────────────────────────────
// Load .env if present
// ─────────────────────────────────────────────
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────
const PORT         = Number(process.env.PORT || 5050);
const BIND         = process.env.BIND || '127.0.0.1';
const API_KEY      = process.env.API_KEY || '';
const SCAN_MS      = (Number(process.env.SCAN_INTERVAL) || 30) * 1000;
const DEBUG        = process.env.DEBUG === '1';

// Auto-detect runtime environment for platform-specific defaults
function detectPlatform() {
  if (process.platform === 'win32') return 'windows';
  try {
    const v = fs.readFileSync('/proc/version', 'utf8').toLowerCase();
    if (v.includes('microsoft') || v.includes('wsl')) return 'wsl';
  } catch (_) {}
  return 'linux';
}
const PLATFORM = detectPlatform();

// File mirror: WSL → write to Windows filesystem as a bonus fallback.
// Override with FILE_OUTPUT env var; set to empty string to disable.
function resolveFileOutput() {
  if ('FILE_OUTPUT' in process.env) return process.env.FILE_OUTPUT || null;
  if (PLATFORM === 'wsl') return '/mnt/c/Rabbit/data/usage.json';
  return null; // disabled on native Windows/Linux — Gist is the relay
}
const FILE_OUTPUT = resolveFileOutput();
let GITHUB_TOKEN   = process.env.GITHUB_TOKEN || '';
let GIST_ID        = process.env.GIST_ID || '';
let GITHUB_USER    = process.env.GITHUB_USER || '';

const HOME = os.homedir();

const JSONL_GLOBS = [
  path.join(HOME, '.claude', 'projects'),
  path.join(HOME, '.config', 'claude', 'projects'),
];

const HISTORY_FILES = [
  path.join(HOME, '.claude', 'history.jsonl'),
  path.join(HOME, '.config', 'claude', 'history.jsonl'),
];

// Caps back-calculated from real Anthropic dashboard readings:
//   233,736 output tokens = 40% current  → cap = 584,340
//   1,687,875 output tokens = 43% weekly → cap = 3,925,290
//   412,291 output tokens = 72% current  → cap = 572,626  (2026-06-06 recalibration)
//   2,370,452 output tokens = 55% weekly → cap = 4,310,000 (2026-06-06 recalibration)
//   519,683 disk tokens = 98% current   → cap = 530,289   (2026-06-06 recalibration, accounts for in-memory lag)
const MAX_OUTPUT_TOKENS_5H = 530_289;
const MAX_OUTPUT_TOKENS_7D = 4_310_000;
const MAX_MESSAGES_5H      = 300;   // fallback only
const MAX_MESSAGES_7D      = 2_000; // fallback only

const WINDOW_5H = 5 * 3600 * 1000; // ms

// Weekly resets every Monday at 13:00 Eastern = 17:00 UTC
const WEEKLY_RESET_DAY  = 1;   // Monday
const WEEKLY_RESET_HOUR = 17;  // 17:00 UTC

// 5-hour fixed-window anchor (UTC minutes from midnight).
// Claude Code uses fixed windows, not rolling.
// Set RESET_ANCHOR_UTC in .env to "HH:MM" of any known reset time.
// e.g. RESET_ANCHOR_UTC=17:30 means windows start at 2:30,7:30,12:30,17:30,22:30 UTC.
// Defaults to rolling window if not set.
const RESET_ANCHOR_UTC = process.env.RESET_ANCHOR_UTC || '';

// Dynamic window start: scan the last 10h of token entries and find the most
// recent gap >= 20 min (indicating a reset / idle boundary). That gap's end is
// the start of the current 5h window. Falls back to a rolling 5h window when
// there are no tokens or the gap is older than 5h.
function getDynamicWindowStart(entries) {
  const now = Date.now();
  const floor = now - WINDOW_5H;                  // never go back more than 5h
  const lookback = now - 2 * WINDOW_5H;           // scan last 10h

  const recent = entries
    .filter(e => e.ts >= lookback)
    .sort((a, b) => a.ts - b.ts);

  if (recent.length === 0) return floor;

  // Walk forward; every gap >= 20 min is a candidate window boundary
  const GAP_MS = 20 * 60 * 1000;
  let windowStart = recent[0].ts;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].ts - recent[i - 1].ts >= GAP_MS) {
      windowStart = recent[i].ts;
    }
  }

  return Math.max(windowStart, floor);
}

function getCurrent5hWindowStart(entries) {
  // Legacy anchor path kept as fallback when no token data available
  if (!entries || entries.length === 0) {
    if (!RESET_ANCHOR_UTC) return Date.now() - WINDOW_5H;
    const [hStr, mStr] = RESET_ANCHOR_UTC.split(':');
    const anchorMinutes = Number(hStr) * 60 + Number(mStr);
    const now = Date.now();
    const todayMidnightUTC = new Date();
    todayMidnightUTC.setUTCHours(0, 0, 0, 0);
    const base = todayMidnightUTC.getTime() + anchorMinutes * 60000;
    const elapsed = now - base;
    const windowsElapsed = Math.floor(elapsed / WINDOW_5H);
    return base + windowsElapsed * WINDOW_5H;
  }
  return getDynamicWindowStart(entries);
}

function getNext5hWindowReset(entries) {
  return getCurrent5hWindowStart(entries) + WINDOW_5H;
}


// ─────────────────────────────────────────────
// File discovery
// ─────────────────────────────────────────────
function findJsonlFiles(bases) {
  const results = [];

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); }
      else if (e.isFile() && e.name.endsWith('.jsonl')) { results.push(full); }
    }
  }

  for (const base of bases) {
    if (fs.existsSync(base)) walk(base);
  }

  for (const hf of HISTORY_FILES) {
    if (fs.existsSync(hf) && !results.includes(hf)) results.push(hf);
  }

  return results;
}


// ─────────────────────────────────────────────
// JSONL parsing
// ─────────────────────────────────────────────
/**
 * Returns array of { ts: number(ms), inputTokens, outputTokens }
 * for every assistant message that has a usage field.
 */
function parseUsageEntries(files) {
  const entries = [];

  for (const f of files) {
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); }
    catch (_) { continue; }

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); }
      catch (_) { continue; }

      if (obj.type !== 'assistant') continue;
      const msg   = obj.message;
      if (!msg || typeof msg !== 'object') continue;
      const usage = msg.usage;
      if (!usage) continue;
      const tsStr = obj.timestamp;
      if (!tsStr) continue;

      let ts;
      try { ts = new Date(tsStr).getTime(); }
      catch (_) { continue; }
      if (!Number.isFinite(ts) || ts <= 0) continue;

      entries.push({
        ts,
        inputTokens:  Number(usage.input_tokens  || 0),
        outputTokens: Number(usage.output_tokens || 0),
        model:        msg.model || 'unknown',
      });
    }
  }

  entries.sort((a, b) => a.ts - b.ts);
  return entries;
}

/**
 * Fallback: collect raw message timestamps (ms) from any field.
 */
function parseMessageTimestamps(files) {
  const ts_list = [];

  for (const f of files) {
    let raw;
    try { raw = fs.readFileSync(f, 'utf8'); }
    catch (_) { continue; }

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); }
      catch (_) { continue; }

      const ts = obj.timestamp;
      if (typeof ts === 'number' && ts > 1e12) {
        ts_list.push(ts);           // already ms
      } else if (typeof ts === 'string') {
        const t = new Date(ts).getTime();
        if (Number.isFinite(t) && t > 0) ts_list.push(t);
      }
    }
  }

  ts_list.sort((a, b) => a - b);
  return ts_list;
}


// ─────────────────────────────────────────────
// Usage calculation
// ─────────────────────────────────────────────
function getWeeklyResetTime() {
  const now = new Date();
  // Find the most recent Monday at WEEKLY_RESET_HOUR UTC
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), WEEKLY_RESET_HOUR, 0, 0, 0));
  // Roll back to Monday
  const dayOfWeek = d.getUTCDay(); // 0=Sun, 1=Mon...
  const daysToLastMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - WEEKLY_RESET_DAY);
  d.setUTCDate(d.getUTCDate() - daysToLastMonday);
  // If that reset is in the future, go back one more week
  if (d.getTime() > now.getTime()) d.setUTCDate(d.getUTCDate() - 7);
  return d; // last weekly reset timestamp
}

function getNextWeeklyResetTime() {
  const last = getWeeklyResetTime();
  return new Date(last.getTime() + 7 * 24 * 3600 * 1000);
}

function calcFromUsageEntries(entries) {
  const now        = Date.now();
  const weekStart  = getWeeklyResetTime().getTime();
  const win5hStart = getCurrent5hWindowStart(entries);

  const e5h   = entries.filter(e => e.ts >= win5hStart);
  const eWeek = entries.filter(e => e.ts >= weekStart);

  const out5h   = e5h.reduce((s, e) => s + e.outputTokens, 0);
  const outWeek = eWeek.reduce((s, e) => s + e.outputTokens, 0);

  const currentPct = Math.min(100, Math.floor(out5h   / MAX_OUTPUT_TOKENS_5H * 100));
  const weeklyPct  = Math.min(100, Math.floor(outWeek / MAX_OUTPUT_TOKENS_7D * 100));

  const nextReset = getNext5hWindowReset(entries);

  return {
    current_percent: currentPct,
    weekly_percent:  weeklyPct,
    current_reset:   new Date(nextReset).toISOString().replace('.000Z', 'Z'),
    weekly_reset:    getNextWeeklyResetTime().toISOString().replace('.000Z', 'Z'),
    last_updated:    new Date().toISOString().replace('.000Z', 'Z'),
    current_tokens:  out5h,
    weekly_tokens:   outWeek,
    max_tokens_5h:   MAX_OUTPUT_TOKENS_5H,
    max_tokens_7d:   MAX_OUTPUT_TOKENS_7D,
    _debug: {
      method:            'token_usage',
      messages_5h:       e5h.length,
      messages_week:     eWeek.length,
      output_tokens_5h:  out5h,
      output_tokens_week: outWeek,
      week_start:        new Date(weekStart).toISOString(),
    }
  };
}

function calcFromTimestamps(ts_list) {
  const now       = Date.now();
  const weekStart = getWeeklyResetTime().getTime();

  const ts5h  = ts_list.filter(t => now - t <= WINDOW_5H);
  const tsWeek = ts_list.filter(t => t >= weekStart);

  const currentPct = Math.min(100, +(ts5h.length  / MAX_MESSAGES_5H  * 100).toFixed(1));
  const weeklyPct  = Math.min(100, +(tsWeek.length / MAX_MESSAGES_7D  * 100).toFixed(1));

  const oldest5h = ts5h.length ? ts5h[0] : now;

  return {
    current_percent: currentPct,
    weekly_percent:  weeklyPct,
    current_reset:   new Date(oldest5h + WINDOW_5H).toISOString().replace('.000Z', 'Z'),
    weekly_reset:    getNextWeeklyResetTime().toISOString().replace('.000Z', 'Z'),
    last_updated:    new Date().toISOString().replace('.000Z', 'Z'),
    _debug: {
      method:       'message_count_fallback',
      messages_5h:  ts5h.length,
      messages_week: tsWeek.length,
    }
  };
}


// ─────────────────────────────────────────────
// GitHub helpers
// ─────────────────────────────────────────────
function gistRawUrl() {
  if (!GIST_ID) return '';
  if (GITHUB_USER) return `https://gist.githubusercontent.com/${GITHUB_USER}/${GIST_ID}/raw/usage.json`;
  return ''; // unknown until username resolved
}

// Fetch GitHub username from token if not set — fires once at startup
function resolveGithubUser() {
  if (GITHUB_USER || !GITHUB_TOKEN) return;
  const req = https.request({
    hostname: 'api.github.com',
    path: '/user',
    method: 'GET',
    headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'claude-usage-collector' }
  }, res => {
    let raw = '';
    res.on('data', c => { raw += c; });
    res.on('end', () => {
      try {
        const login = JSON.parse(raw).login;
        if (login) {
          GITHUB_USER = login;
          console.log(`[gist] Resolved GitHub user: ${login}`);
        }
      } catch (_) {}
    });
  });
  req.on('error', () => {});
  req.end();
}

// ─────────────────────────────────────────────
// GitHub Gist push (with rate-limit backoff)
// ─────────────────────────────────────────────
// gist_update resource limit: 100 PATCH/hr.
// We pace pushes dynamically: interval = time_until_reset / remaining,
// floored at 36s (= 100/hr ceiling) and capped at 120s.
let _gistBackoffUntil  = 0;     // epoch ms — skip all pushes until this clears
let _gistLastPushedAt  = 0;     // epoch ms — enforce computed interval
let _gistRemaining     = 100;   // updated from x-ratelimit-remaining header
let _gistResetEpoch    = 0;     // updated from x-ratelimit-reset header
let _lastPushedPercent = null;

function gistIntervalMs() {
  const now = Date.now();
  const timeLeft = _gistResetEpoch > 0 ? (_gistResetEpoch * 1000 - now) : 3600000;
  if (_gistRemaining <= 0 || timeLeft <= 0) return Infinity;
  const dynamic = timeLeft / _gistRemaining;
  return Math.min(Math.max(dynamic, 36000), 120000); // 36s–120s
}

function pushToGist(data) {
  if (!GITHUB_TOKEN || !GIST_ID) return;
  const now = Date.now();
  if (now < _gistBackoffUntil) return; // rate-limited
  if (now - _gistLastPushedAt < gistIntervalMs()) return; // pacing

  // Skip push if nothing changed (saves quota)
  if (data.current_percent === _lastPushedPercent) return;

  const publicData = Object.fromEntries(
    Object.entries(data).filter(([k]) => !k.startsWith('_'))
  );
  const body = JSON.stringify({
    files: { 'usage.json': { content: JSON.stringify(publicData, null, 2) } }
  });

  _gistLastPushedAt = now; // mark attempt time before the async response

  const req = https.request({
    hostname: 'api.github.com',
    path: `/gists/${GIST_ID}`,
    method: 'PATCH',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'claude-usage-collector',
      'Content-Length': Buffer.byteLength(body),
    }
  }, res => {
    // Always track remaining quota from headers
    const remaining  = Number(res.headers['x-ratelimit-remaining'] ?? _gistRemaining);
    const resetEpoch = Number(res.headers['x-ratelimit-reset'] || 0);
    _gistRemaining = remaining;
    if (resetEpoch > 0) _gistResetEpoch = resetEpoch;

    let raw = '';
    res.on('data', c => { raw += c; });
    res.on('end', () => {
      if (res.statusCode === 200 || res.statusCode === 201) {
        _lastPushedPercent = data.current_percent;
        const nextSec = Math.round(gistIntervalMs() / 1000);
        console.log(`[gist] Pushed ${data.current_percent}% OK  (quota: ${remaining} left, next in ~${nextSec}s)`);
      } else if (res.statusCode === 403 || res.statusCode === 429) {
        // Use Retry-After if present, else wait until the reset epoch, else 20 min
        const retryAfterSec = Number(res.headers['retry-after'] || 0);
        let backoffUntil;
        if (retryAfterSec > 0) {
          backoffUntil = Date.now() + retryAfterSec * 1000;
        } else if (resetEpoch > 0) {
          backoffUntil = resetEpoch * 1000 + 5000; // 5s past reset
        } else {
          backoffUntil = Date.now() + 20 * 60 * 1000;
        }
        _gistBackoffUntil = backoffUntil;
        let msg = raw;
        try { msg = JSON.parse(raw).message || raw; } catch (_) {}
        const waitMin = Math.ceil((backoffUntil - Date.now()) / 60000);
        console.log(`[gist] HTTP ${res.statusCode} — backing off ${waitMin} min. ${msg}`);
      } else {
        console.log(`[gist] HTTP ${res.statusCode}: ${raw.slice(0, 200)}`);
      }
    });
  });

  req.on('error', err => {
    console.log(`[gist] Push error: ${err.message}`);
  });
  req.write(body);
  req.end();
}

// ─────────────────────────────────────────────
// Collector state (in-memory cache)
// ─────────────────────────────────────────────
let _latestData = null;

function collect() {
  const files   = findJsonlFiles(JSONL_GLOBS);
  const entries = parseUsageEntries(files);

  let data;
  if (entries.length > 0) {
    data = calcFromUsageEntries(entries);
  } else {
    const ts_list = parseMessageTimestamps(files);
    data = calcFromTimestamps(ts_list);
  }

  _latestData = data;

  // Push to Gist on every collect (every 30s)
  pushToGist(data);

  // Mirror to filesystem (best-effort, WSL-only by default)
  if (FILE_OUTPUT) {
    try {
      const dir = path.dirname(FILE_OUTPUT);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const publicData = Object.fromEntries(
        Object.entries(data).filter(([k]) => !k.startsWith('_'))
      );
      const tmp = FILE_OUTPUT + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(publicData, null, 2));
      fs.renameSync(tmp, FILE_OUTPUT);
    } catch (_) { /* not fatal */ }
  }

  // Schedule an immediate re-collect right when the oldest token exits the 5h window.
  // Catches resets even when the 30s poll fires late (e.g. after WSL sleep).
  scheduleResetCollect(data.current_reset);

  if (DEBUG) {
    const d = data._debug;
    console.log(
      `[${data.last_updated}] current=${data.current_percent}%  weekly=${data.weekly_percent}%` +
      (d.output_tokens_5h !== undefined
        ? `  out5h=${d.output_tokens_5h.toLocaleString()} msgs5h=${d.messages_5h}`
        : `  msgs5h=${d.messages_5h} [fallback]`)
    );
  }

  return data;
}

let _resetTimer = null;
function scheduleResetCollect(resetISO) {
  if (_resetTimer) { clearTimeout(_resetTimer); _resetTimer = null; }
  if (!resetISO) return;
  const delay = new Date(resetISO).getTime() - Date.now();
  if (delay <= 0 || delay > WINDOW_5H) return;
  _resetTimer = setTimeout(() => {
    _resetTimer = null;
    collect();
  }, delay + 500);
}


// ─────────────────────────────────────────────
// File watcher — re-collect when logs change
// ─────────────────────────────────────────────
function watchLogs() {
  for (const base of JSONL_GLOBS) {
    if (!fs.existsSync(base)) continue;
    try {
      fs.watch(base, { recursive: true }, (_event, filename) => {
        if (filename && filename.endsWith('.jsonl')) {
          collect();
        }
      });
      if (DEBUG) console.log(`Watching: ${base}`);
    } catch (_) {
      if (DEBUG) console.log(`Cannot watch ${base} — falling back to poll`);
    }
  }
}


// ─────────────────────────────────────────────
// HTTP server
// ─────────────────────────────────────────────
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
}

function sendJSON(res, status, body) {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

function checkAuth(req, res) {
  if (!API_KEY) return true;                           // auth disabled
  const key = req.headers['x-api-key'] || '';
  if (key === API_KEY) return true;
  cors(res);
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'forbidden' }));
  return false;
}

function createServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url.split('?')[0];

    // /health is always public (Cloudflare health checks, etc.)
    if (url !== '/health' && !checkAuth(req, res)) return;

    if (url === '/usage') {
      if (!_latestData) collect();
      const publicData = Object.fromEntries(
        Object.entries(_latestData).filter(([k]) => !k.startsWith('_'))
      );
      sendJSON(res, 200, publicData);

    } else if (url === '/usage/debug') {
      if (!_latestData) collect();
      sendJSON(res, 200, _latestData);

    } else if (url === '/health') {
      sendJSON(res, 200, { status: 'ok', timestamp: new Date().toISOString() });

    } else if (url === '/gist-qr.png') {
      const gistUrl = gistRawUrl();
      if (!gistUrl) { sendJSON(res, 404, { error: 'Gist not configured' }); return; }
      const buf = await qrPng(gistUrl);
      if (!buf) { sendJSON(res, 503, { error: 'qrcode package not installed — run npm install' }); return; }
      cors(res);
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
      res.end(buf);

    } else if (url === '/qr') {
      const gistUrl = gistRawUrl();
      cors(res);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Claude Usage — Share QR</title>
<style>
  body { margin:0; background:#000; color:#fff; font-family:-apple-system,sans-serif;
         display:flex; flex-direction:column; align-items:center; justify-content:center;
         min-height:100vh; padding:24px; box-sizing:border-box; }
  h2 { font-size:1.3rem; margin:0 0 8px; color:#FE5F00; }
  p  { font-size:.85rem; color:#6b7280; margin:0 0 24px; text-align:center; }
  img { border:4px solid #fff; border-radius:12px; width:300px; height:300px; background:#fff; }
  .url { margin-top:20px; font-size:.75rem; color:#4b5563; word-break:break-all;
         max-width:340px; text-align:center; font-family:monospace; }
  .none { color:#ef4444; font-size:1rem; }
</style>
</head>
<body>
<h2>Scan to configure Rabbit app</h2>
<p>Point your Rabbit at this code — it fills in the endpoint automatically.</p>
${gistUrl
  ? `<img src="/gist-qr.png" alt="QR code"><p class="url">${gistUrl}</p>`
  : `<p class="none">GIST_ID not configured in .env — set it up first.</p>`}
</body>
</html>`);

    } else if (url === '/api/status') {
      const files = findJsonlFiles(JSONL_GLOBS);
      if (!_latestData) collect();
      const d = _latestData;
      const gistUrl = gistRawUrl();
      sendJSON(res, 200, {
        server:           'running',
        logs_found:       files.length > 0,
        log_count:        files.length,
        gist_configured:  !!(GITHUB_TOKEN && GIST_ID),
        gist_url:         gistUrl,
        current_percent:  d ? d.current_percent  : null,
        weekly_percent:   d ? d.weekly_percent   : null,
        current_reset:    d ? d.current_reset    : null,
        weekly_reset:     d ? d.weekly_reset     : null,
        last_updated:     d ? d.last_updated     : null,
        current_tokens:   d ? d.current_tokens   : null,
        weekly_tokens:    d ? d.weekly_tokens    : null,
      });

    } else if (url === '/api/config' && req.method === 'POST') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', async () => {
        try {
          const { github_token, gist_id } = JSON.parse(body);
          if (!github_token) return sendJSON(res, 400, { error: 'github_token is required' });
          const token = github_token.trim();

          // Validate token + resolve username
          const userResp = await new Promise((resolve, reject) => {
            const r = https.request({
              hostname: 'api.github.com', path: '/user', method: 'GET',
              headers: { 'Authorization': `token ${token}`, 'User-Agent': 'claude-usage-installer' }
            }, rr => { let d = ''; rr.on('data', c => d += c); rr.on('end', () => resolve(d)); });
            r.on('error', reject); r.end();
          });
          const login = JSON.parse(userResp).login;
          if (!login) return sendJSON(res, 400, { error: 'Invalid token or missing gist scope' });

          // Use provided gist_id or auto-create one
          let resolvedGistId = (gist_id || '').trim();
          if (!resolvedGistId) {
            const gistResp = await new Promise((resolve, reject) => {
              const gBody = JSON.stringify({ description: 'Claude Code usage relay', public: true, files: { 'usage.json': { content: '{}' } } });
              const r = https.request({
                hostname: 'api.github.com', path: '/gists', method: 'POST',
                headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json',
                  'User-Agent': 'claude-usage-installer', 'Content-Length': Buffer.byteLength(gBody) }
              }, rr => { let d = ''; rr.on('data', c => d += c); rr.on('end', () => resolve(d)); });
              r.on('error', reject); r.write(gBody); r.end();
            });
            resolvedGistId = JSON.parse(gistResp).id;
            if (!resolvedGistId) return sendJSON(res, 400, { error: 'Failed to create Gist — does token have gist scope?' });
          }

          // Write .env — preserve existing keys
          const envPath = path.join(__dirname, '.env');
          const updates = { GITHUB_TOKEN: token, GIST_ID: resolvedGistId, GITHUB_USER: login };
          let existing = [];
          if (fs.existsSync(envPath)) {
            existing = fs.readFileSync(envPath, 'utf8').split('\n')
              .filter(l => { const m = l.match(/^([A-Z_]+)=/); return m && !(m[1] in updates); });
          }
          const lines = [...existing, ...Object.entries(updates).map(([k, v]) => `${k}=${v}`)];
          fs.writeFileSync(envPath, lines.join('\n') + '\n');
          fs.chmodSync(envPath, 0o600);
          // Hot-reload
          GITHUB_TOKEN = token;
          GIST_ID      = resolvedGistId;
          GITHUB_USER  = login;
          collect();
          sendJSON(res, 200, { ok: true, gist_id: resolvedGistId, github_user: login });
        } catch (e) {
          sendJSON(res, 400, { error: e.message });
        }
      });

    } else if (url === '/api/restart' && req.method === 'POST') {
      sendJSON(res, 200, { ok: true, message: 'Restarting...' });
      setTimeout(() => process.exit(42), 300); // 42 = restart signal for start.js

    } else if (url === '/telegram/launch' && req.method === 'POST') {
      exec('adb shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p org.telegram.messenger', (err, stdout, stderr) => {
        if (err) {
          console.error('[telegram] launch failed:', err.message);
          sendJSON(res, 500, { ok: false, error: err.message });
        } else {
          console.log('[telegram] launched');
          sendJSON(res, 200, { ok: true, action: 'launch' });
        }
      });

    } else if (url === '/telegram/close' && req.method === 'POST') {
      exec('adb shell am force-stop org.telegram.messenger', (err, stdout, stderr) => {
        if (err) {
          console.error('[telegram] close failed:', err.message);
          sendJSON(res, 500, { ok: false, error: err.message });
        } else {
          console.log('[telegram] closed');
          sendJSON(res, 200, { ok: true, action: 'close' });
        }
      });

    } else if (url === '/') {
      // Serve dashboard
      const dashPath = path.join(__dirname, 'dashboard.html');
      if (fs.existsSync(dashPath)) {
        cors(res);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(fs.readFileSync(dashPath, 'utf8'));
      } else {
        cors(res);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Claude Usage Bridge running. dashboard.html not found.');
      }

    } else if (url === '/app-qr.png') {
      const qrPath = path.join(__dirname, 'rabbit', 'app-qr.png');
      if (fs.existsSync(qrPath)) {
        cors(res);
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(fs.readFileSync(qrPath));
      } else {
        sendJSON(res, 404, { error: 'app-qr.png not found' });
      }

    } else {
      sendJSON(res, 404, { error: 'not found' });
    }
  });
}


// ─────────────────────────────────────────────
// Discovery mode (--discover flag)
// ─────────────────────────────────────────────
function runDiscovery() {
  console.log('\n=== LOG DISCOVERY ===');
  const files = findJsonlFiles(JSONL_GLOBS);
  console.log(`Found ${files.length} JSONL file(s):`);
  files.slice(0, 8).forEach(f => {
    const size = fs.statSync(f).size;
    console.log(`  ${f}  (${(size / 1024).toFixed(1)} KB)`);
  });
  if (files.length > 8) console.log(`  ... and ${files.length - 8} more`);

  console.log('\n=== SCHEMA SAMPLE ===');
  const entries = parseUsageEntries(files.slice(0, 5));
  console.log(`Usage entries found: ${entries.length}`);
  if (entries.length) {
    const e = entries[entries.length - 1];
    console.log(`Latest entry: ${new Date(e.ts).toISOString()}  model=${e.model}  out=${e.outputTokens}`);
  }

  console.log('\n=== CURRENT STATS ===');
  const data = collect();
  const d = data._debug;
  console.log(`current_percent : ${data.current_percent}%`);
  console.log(`weekly_percent  : ${data.weekly_percent}%`);
  console.log(`current_reset   : ${data.current_reset}`);
  console.log(`weekly_reset    : ${data.weekly_reset}`);
  console.log(`method          : ${d.method}`);
  if (d.output_tokens_5h !== undefined) {
    console.log(`output_tokens_5h: ${d.output_tokens_5h.toLocaleString()}`);
    console.log(`output_tokens_7d: ${d.output_tokens_7d.toLocaleString()}`);
  }
  console.log(`messages_5h     : ${d.messages_5h}`);
  console.log(`messages_7d     : ${d.messages_7d}`);
  console.log(`\nFile output     : ${FILE_OUTPUT}`);
}


// ─────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--discover')) {
  runDiscovery();
  process.exit(0);
}

// Initial collect
console.log('Claude Code Usage Bridge starting...');
resolveGithubUser();
collect();

// Poll every SCAN_MS for local/in-memory updates
setInterval(collect, SCAN_MS);

// Gist push now happens inside collect() on every scan cycle

// Watch log directories for fast updates
watchLogs();

// Start HTTP server
const server = createServer();
server.listen(PORT, BIND, () => {
  console.log(`Listening on http://${BIND}:${PORT}`);
  console.log(`  /usage        — stats for Rabbit`);
  console.log(`  /usage/debug  — stats + breakdown`);
  console.log(`  /health       — heartbeat`);
  console.log(`Auth: ${API_KEY ? 'enabled (x-api-key header)' : 'disabled (use tunnel)'}`);
  console.log(`File mirror: ${FILE_OUTPUT || 'disabled'}`);
  console.log(`\nPress Ctrl+C to stop.`);
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Set PORT=<other> to change.`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
