let apiUrl = `https://gist.githubusercontent.com/Musclenerd06/8d5cd0b32306efa71751eb9458d03835/raw/usage.json`;
const REFRESH_INTERVAL = 30000;
const MAX_TOKENS_5H = 572626;
const MAX_TOKENS_7D = 3991104;

let isOnline = false;
let refreshTimer = null;
let showSettings = false;
let firstLaunch = false;
let statusCycleTimer = null;
let currentStatusIdx = 0;
let lastUpdatedTimer = null;
let lastFetchStarted = 0;
let qrStream = null;
let qrAnimFrame = null;
let latestData = null;
let lastFetchedAt = null;
let _displayedCurrentPct = null;
let _displayedWeeklyPct = null;

const STATUS_MESSAGES = ['✱ Syncing..', '✱ Fetching..', '✱ Updating..', '✱ Loading..'];
const CLAUDE_ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23191919'/%3E%3Cg fill='%23FE5F00'%3E%3Cellipse cx='16' cy='5.5' rx='2.2' ry='2.2'/%3E%3Cellipse cx='16' cy='26.5' rx='2.2' ry='2.2'/%3E%3Cellipse cx='5.5' cy='16' rx='2.2' ry='2.2'/%3E%3Cellipse cx='26.5' cy='16' rx='2.2' ry='2.2'/%3E%3Cellipse cx='8.5' cy='8.5' rx='2' ry='2'/%3E%3Cellipse cx='23.5' cy='23.5' rx='2' ry='2'/%3E%3Cellipse cx='23.5' cy='8.5' rx='2' ry='2'/%3E%3Cellipse cx='8.5' cy='23.5' rx='2' ry='2'/%3E%3C/g%3E%3C/svg%3E";

function getBarColor(percent) {
  if (percent >= 80) return '#ef4444';
  if (percent >= 50) return '#eab308';
  return '#22c55e';
}

function fmtTokens(n) {
  if (n == null) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'K';
  return String(n);
}

function timeSince(ts) {
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return secs + 's ago';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  return Math.floor(secs / 3600) + 'h ago';
}

function calcTimeRemaining(resetISO) {
  const now = Date.now();
  const reset = new Date(resetISO).getTime();
  const diff = reset - now;
  if (diff <= 0) return '0m';

  const totalMin = Math.floor(diff / 60000);
  const totalHours = Math.floor(totalMin / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const mins = totalMin % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function startStatusCycle() {
  currentStatusIdx = 0;
  updateStatusText(STATUS_MESSAGES[0]);
  statusCycleTimer = setInterval(() => {
    currentStatusIdx = (currentStatusIdx + 1) % STATUS_MESSAGES.length;
    updateStatusText(STATUS_MESSAGES[currentStatusIdx]);
  }, 600);
}

function stopStatusCycle() {
  if (statusCycleTimer) {
    clearInterval(statusCycleTimer);
    statusCycleTimer = null;
  }
}

function updateStatusText(text) {
  const el = document.getElementById('statusLine');
  if (el) el.textContent = text;
}

/* ── QR Scanner ────────────────────────────────────────────────── */

function loadJsQR() {
  return new Promise((resolve, reject) => {
    if (window.jsQR) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}


function closeQrScanner() {
  if (qrAnimFrame) { cancelAnimationFrame(qrAnimFrame); qrAnimFrame = null; }
  if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; }
  const ov = document.getElementById('qrOverlay');
  if (ov) ov.remove();
}

function scanFrame() {
  const video  = document.getElementById('qrVideo');
  const canvas = document.getElementById('qrCanvas');
  if (!video || !canvas || !window.jsQR) return;

  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(img.data, img.width, img.height);
    if (code) {
      closeQrScanner();
      const input = document.getElementById('urlInput');
      if (input) {
        input.value = code.data;
        input.style.borderColor = '#22c55e';
        setTimeout(() => { input.style.borderColor = ''; }, 1500);
      }
      return;
    }
  }
  qrAnimFrame = requestAnimationFrame(scanFrame);
}

async function openQrScanner() {
  const app = document.getElementById('app');
  const overlay = document.createElement('div');
  overlay.id = 'qrOverlay';
  overlay.className = 'qr-overlay';
  overlay.innerHTML = `
    <div class="qr-header">
      <span class="qr-title">Scan QR Code</span>
      <button class="btn-back" id="btnCancelScan">✕</button>
    </div>
    <div class="qr-body" id="qrBody">
      <video id="qrVideo" class="qr-video" playsinline autoplay muted></video>
      <canvas id="qrCanvas" class="qr-canvas"></canvas>
      <div class="qr-viewfinder"></div>
      <p class="qr-hint">Point at your Gist URL QR code</p>
    </div>
  `;
  app.appendChild(overlay);
  document.getElementById('btnCancelScan').addEventListener('click', closeQrScanner);

  try {
    await loadJsQR();
  } catch (e) {
    document.getElementById('qrBody').innerHTML =
      `<p class="qr-hint" style="color:#ef4444">Could not load scanner.<br>Check internet connection.</p>`;
    return;
  }

  try {
    qrStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    const video = document.getElementById('qrVideo');
    if (!video) { closeQrScanner(); return; }
    video.srcObject = qrStream;
    video.play();
    video.addEventListener('loadedmetadata', scanFrame);
  } catch (e) {
    document.getElementById('qrBody').innerHTML =
      `<p class="qr-hint" style="color:#ef4444">Camera unavailable:<br>${e.message}</p>`;
  }
}

/* ── Settings ─────────────────────────────────────────────────── */

function renderSettings() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="settings-view">
      <div class="settings-header">
        <span class="settings-title">Options</span>
        <button class="btn-back" id="btnBack">✕</button>
      </div>
      <div class="settings-body">
        ${firstLaunch ? `
        <div class="first-launch-banner">
          <div class="first-launch-title">Welcome!</div>
          <div class="first-launch-msg">Scan the QR code from the setup page to connect to your Gist — or paste your URL below.</div>
        </div>` : ''}
        <label class="input-label">Endpoint URL</label>
        <input type="text" id="urlInput" class="url-input" value="${firstLaunch ? '' : apiUrl}" placeholder="Paste your Gist URL or scan QR" />
        <button class="btn-qr-scan" id="btnQrScan">Scan QR Code</button>
        <div class="settings-actions">
          <button class="btn-save" id="btnSave">Save</button>
          <button class="btn-reset" id="btnReset">Reset</button>
        </div>
        <div class="settings-credit">Created by Arnold Haxinator</div>
      </div>
    </div>
  `;

  document.getElementById('btnBack').addEventListener('click', () => {
    showSettings = false;
    _displayedCurrentPct = null;
    _displayedWeeklyPct  = null;
    fetchData();
  });

  document.getElementById('btnQrScan').addEventListener('click', openQrScanner);

  document.getElementById('btnSave').addEventListener('click', async () => {
    const val = document.getElementById('urlInput').value.trim();
    if (val) {
      apiUrl = val;
      firstLaunch = false;
      await saveEndpoint(apiUrl);
      showSettings = false;
      if (!refreshTimer) refreshTimer = setInterval(fetchData, REFRESH_INTERVAL);
      fetchData();
    }
  });

  document.getElementById('btnReset').addEventListener('click', async () => {
    apiUrl = `https://gist.githubusercontent.com/Musclenerd06/8d5cd0b32306efa71751eb9458d03835/raw/usage.json?t=${Date.now()}`;
    document.getElementById('urlInput').value = apiUrl;
    await saveEndpoint(apiUrl);
    showSettings = false;
    fetchData();
  });
}

/* ── Main render ──────────────────────────────────────────────── */

function render(data) {
  if (showSettings) {
    renderSettings();
    return;
  }

  if (lastUpdatedTimer) { clearInterval(lastUpdatedTimer); lastUpdatedTimer = null; }

  const app = document.getElementById('app');

  if (!data) {
    app.innerHTML = `
      <div class="main-view">
        <div class="header">
          <img class="claude-icon" src="${CLAUDE_ICON}" alt="C" width="32" height="32" />
          <span class="title">Claude Usage</span>
        </div>
        <div class="usage-card">
          <p class="error-msg">Unable to fetch data</p>
        </div>
        <div class="footer">
          <span class="status-line" id="statusLine">✱ Offline</span>
          <div class="footer-btns">
            <button class="btn-sm" id="btnRefresh">↻</button>
            <button class="btn-sm" id="btnOptions">⚙</button>
          </div>
        </div>
      </div>
    `;
    bindFooterButtons();
    return;
  }

  latestData = data;

  const currentUsed = data.current_percent;
  const weeklyUsed  = data.weekly_percent;
  const currentColor = getBarColor(currentUsed);
  const weeklyColor  = getBarColor(weeklyUsed);
  const isWarning = currentUsed >= 80;

  const tok5h = data.current_tokens;
  const tokWk = data.weekly_tokens;
  const cap5h = data.max_tokens_5h || MAX_TOKENS_5H;
  const cap7d = data.max_tokens_7d || MAX_TOKENS_7D;
  const curTokStr = tok5h != null ? `${fmtTokens(tok5h)} / ${fmtTokens(cap5h)} tokens` : '';
  const wkTokStr  = tokWk != null ? `${fmtTokens(tokWk)} / ${fmtTokens(cap7d)} tokens` : '';

  // Bars start from previously displayed value (not 0) so they don't sweep on every refresh
  const barCurrentStart = _displayedCurrentPct !== null ? _displayedCurrentPct : 0;
  const barWeeklyStart  = _displayedWeeklyPct  !== null ? _displayedWeeklyPct  : 0;

  app.innerHTML = `
    <div class="main-view${isWarning ? ' warning-bg' : ''}">
      <div class="header">
        <img class="claude-icon" src="${CLAUDE_ICON}" alt="C" width="32" height="32" />
        <span class="title">Claude Usage</span>
      </div>

      <div class="usage-card">
        <div class="card-top">
          <div>
            <span class="card-percent" style="color:${currentColor}">${currentUsed}%</span>
            ${curTokStr ? `<div class="token-sub">${curTokStr}</div>` : ''}
          </div>
          <span class="card-badge">Current</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" data-target="${currentUsed}" style="width:${barCurrentStart}%;background:${currentColor}"></div>
        </div>
        <span class="card-reset" id="resetCurrent">Resets in ${calcTimeRemaining(data.current_reset)}</span>
      </div>

      <div class="divider"></div>

      <div class="usage-card">
        <div class="card-top">
          <div>
            <span class="card-percent" style="color:${weeklyColor}">${weeklyUsed}%</span>
            ${wkTokStr ? `<div class="token-sub">${wkTokStr}</div>` : ''}
          </div>
          <span class="card-badge">Weekly</span>
        </div>
        <div class="bar-track">
          <div class="bar-fill" data-target="${weeklyUsed}" style="width:${barWeeklyStart}%;background:${weeklyColor}"></div>
        </div>
        <span class="card-reset" id="resetWeekly">Resets in ${calcTimeRemaining(data.weekly_reset)}</span>
      </div>

      <div class="footer">
        <div class="status-col">
          <span class="status-line" id="statusLine">${data._stale ? '⚠ Stale data' : '<span class="live-dot"></span> Online'}</span>
          <span class="last-updated" id="lastUpdated" style="${data._stale ? 'color:#eab308' : ''}"></span>
        </div>
        <div class="footer-btns">
          <button class="btn-sm" id="btnRefresh">↻</button>
          <button class="btn-sm" id="btnOptions">⚙</button>
        </div>
      </div>
    </div>
  `;

  // Animate bars to target after paint
  requestAnimationFrame(() => {
    document.querySelectorAll('.bar-fill[data-target]').forEach(el => {
      el.style.width = el.dataset.target + '%';
    });
    _displayedCurrentPct = currentUsed;
    _displayedWeeklyPct  = weeklyUsed;
  });

  lastFetchedAt = Date.now();
  function updateLiveInfo() {
    const lu = document.getElementById('lastUpdated');
    if (lu && lastFetchedAt) lu.textContent = 'Updated ' + timeSince(lastFetchedAt);
    const rc = document.getElementById('resetCurrent');
    if (rc && latestData) rc.textContent = 'Resets in ' + calcTimeRemaining(latestData.current_reset);
    const rw = document.getElementById('resetWeekly');
    if (rw && latestData) rw.textContent = 'Resets in ' + calcTimeRemaining(latestData.weekly_reset);
  }
  updateLiveInfo();
  lastUpdatedTimer = setInterval(updateLiveInfo, 1000);

  bindFooterButtons();
}

function bindFooterButtons() {
  document.getElementById('btnRefresh').addEventListener('click', () => {
    const app = document.getElementById('app');
    if (app) { app.classList.add('flash'); setTimeout(() => app.classList.remove('flash'), 400); }
    fetchData();
  });
  document.getElementById('btnOptions').addEventListener('click', () => {
    showSettings = true;
    renderSettings();
  });
}

/* ── Data fetch ───────────────────────────────────────────────── */

async function fetchData() {
  const now = Date.now();
  if (now - lastFetchStarted < 5000) return;
  lastFetchStarted = now;
  startStatusCycle();
  const url = `${apiUrl}?t=${Date.now()}`;

  fetch(url, { cache: 'no-store' })
    .then(res => res.json())
    .then(data => {
      console.log('FETCHED:', JSON.stringify(data));
      // Warn if the Gist data itself is stale (server stopped pushing)
      if (data.last_updated) {
        const ageMs = Date.now() - new Date(data.last_updated).getTime();
        if (ageMs > 3 * 60 * 1000) data._stale = true;
      }
      return data;
    })
    .then(data => {
      isOnline = true;
      stopStatusCycle();
      render(data);
      const sl = document.getElementById('statusLine');
      if (sl) {
        sl.innerHTML = '✱ Updated ✓';
        sl.style.color = '#22c55e';
        setTimeout(() => {
          const el = document.getElementById('statusLine');
          if (el) { el.innerHTML = '<span class="live-dot"></span> Online'; el.style.color = ''; }
        }, 1500);
      }
    })
    .catch(err => {
      console.error('FETCH ERROR:', err);
      isOnline = false;
      stopStatusCycle();
      render(null);
    });
}

/* ── Storage ──────────────────────────────────────────────────── */

async function saveEndpoint(url) {
  // Always write to localStorage — most reliable across restarts
  try { localStorage.setItem('claude_endpoint', JSON.stringify({ url })); } catch (_) {}
  // Also write to creationStorage if available (Rabbit native API)
  if (window.creationStorage) {
    try { await window.creationStorage.plain.setItem('endpoint', btoa(JSON.stringify({ url }))); } catch (_) {}
  }
}

async function loadEndpoint() {
  let found = false;
  // Try creationStorage first
  if (window.creationStorage) {
    try {
      const stored = await window.creationStorage.plain.getItem('endpoint');
      if (stored) {
        const parsed = JSON.parse(atob(stored));
        if (parsed.url) { apiUrl = parsed.url; found = true; }
      }
    } catch (_) {}
  }
  // Always try localStorage as well — wins if creationStorage had nothing
  if (!found) {
    try {
      const stored = localStorage.getItem('claude_endpoint');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.url) { apiUrl = parsed.url; found = true; }
      }
    } catch (_) {}
  }
  if (!found) firstLaunch = true;
}

/* ── Init ─────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', async () => {
  await loadEndpoint();
  if (firstLaunch) {
    showSettings = true;
    renderSettings();
  } else {
    fetchData();
    refreshTimer = setInterval(fetchData, REFRESH_INTERVAL);
  }
});

window.addEventListener('sideClick', () => {
  fetchData();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    fetchData();
  }
});
