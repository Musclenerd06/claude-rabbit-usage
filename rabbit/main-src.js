let apiUrl = `https://gist.githubusercontent.com/Musclenerd06/8d5cd0b32306efa71751eb9458d03835/raw/usage.json`;
const REFRESH_INTERVAL = 30000;
const MAX_TOKENS_5H = 572626;
const MAX_TOKENS_7D = 3991104;

let isOnline = false;
let refreshTimer = null;
let showSettings = false;
let statusCycleTimer = null;
let currentStatusIdx = 0;
let lastUpdatedTimer = null;
let lastFetchStarted = 0;

const STATUS_MESSAGES = ['✱ Syncing..', '✱ Fetching..', '✱ Updating..', '✱ Loading..'];
const CLAUDE_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAoAAAAKACAMAAAA7EzkRAAAAFVBMVEVMaXHZd1fZd1babUjZd1faf1rZd1epRaWRAAAABnRSTlMAXawH8g5t5RLrAAAACXBIWXMAAAsTAAALEwEAmpwYAAAFOklEQVR42u3WUQ6EIAxAQcDV+x95r1Bjk2Kdid81wkMdAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADebtHa9gFedPYTIAIUoAAFiAAFKEABIkABClCACFCAAhQgAkSAAkSACFCACBABChABIkABIkAEKEAEiAAFiAARoAARIAIUIAJEgAJEgAhQgAgQAQoQASJAAQpQgAhQgAIUIAIUoAAFiAAFKEABIkABClCACBABChABIkABIkAEKEAEiAAFiAARoAARIAIUIAJEgAJEgAhQgAgQAQoQASJAASJABChABIgABShAASJAAQpQgAhQgAIUIAIUoAAFiAARoAARIAIUIAJEgAJEgAhQgAjwnjNmfq2EGVwYAT4UvO33AqzZDwEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoACTHTHfCzC4MNkBHsnGBYUEiAARIAgQAYIAESAIEAGCABEgCBABggARIAgQAYIAESAIEAGCABEgCBABggARIAgQAYIAESAIEAEiQBAgAgQBIkAQIAIEASJAECACBAEiQBAgAgQBIkAQIAIEASJAECACBAEiQBAgAgQBIkAQIAIEASJABAgCRIAgQAQIAkSAIEAECAJEgCBABAgCRIDwNMCVzJL2lt3LyGaLmr+xdmeLBChABIgABYgAEaAAESACFCACRIACRIAIUIAIEAEKEAEiQAEiQAQoQASIAAWIABGgABEgAhQgAkSAAhSgABGgAAUoQAQoQAEKEAEKUIACRIAIUIAIEAEKEAEiQAEiQAQoQASIAAWIABGgABEgAhQgAkSAAkSACFCACBABChABIkABIkAEKEABChABClCAAkSAAhSgABGgAAUoQAQoQAEKEAEiQAEiQAQoQASIAAWIABGgABEgAhQgAkSAAkSACDDJjFnRBy6aVyb6HKto3mhiJp+4W/OOXa8bX5CZ/EVqU9YbAuzwCyNAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKUIACFKAABShAAQpQgAIUoAAFKEABClCAAhSgAAUoQAEKcEvnDCqaV3cyg86ieQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwJv8Af3P8SOrUE9bAAAAAElFTkSuQmCC';

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

function renderSettings() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div class="settings-view">
      <div class="settings-header">
        <span class="settings-title">Options</span>
        <button class="btn-back" id="btnBack">✕</button>
      </div>
      <div class="settings-body">
        <label class="input-label">Endpoint URL</label>
        <input type="text" id="urlInput" class="url-input" value="${apiUrl}" placeholder="Enter JSON endpoint URL" />
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
    fetchData();
  });

  document.getElementById('btnSave').addEventListener('click', async () => {
    const val = document.getElementById('urlInput').value.trim();
    if (val) {
      apiUrl = val;
      await saveEndpoint(apiUrl);
      showSettings = false;
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

  const currentUsed = data.current_percent;
  const weeklyUsed = data.weekly_percent;
  const currentColor = getBarColor(currentUsed);
  const weeklyColor = getBarColor(weeklyUsed);
  const isWarning = currentUsed >= 80;

  const tok5h  = data.current_tokens;
  const tokWk  = data.weekly_tokens;
  const cap5h  = data.max_tokens_5h  || MAX_TOKENS_5H;
  const cap7d  = data.max_tokens_7d  || MAX_TOKENS_7D;
  const curTokStr = tok5h != null ? `${fmtTokens(tok5h)} / ${fmtTokens(cap5h)} tokens` : '';
  const wkTokStr  = tokWk != null ? `${fmtTokens(tokWk)} / ${fmtTokens(cap7d)} tokens` : '';

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
          <div class="bar-fill" data-target="${currentUsed}" style="width:0%;background:${currentColor}"></div>
        </div>
        <span class="card-reset">Resets in ${calcTimeRemaining(data.current_reset)}</span>
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
          <div class="bar-fill" data-target="${weeklyUsed}" style="width:0%;background:${weeklyColor}"></div>
        </div>
        <span class="card-reset">Resets in ${calcTimeRemaining(data.weekly_reset)}</span>
      </div>

      <div class="footer">
        <div class="status-col">
          <span class="status-line" id="statusLine"><span class="live-dot"></span> Online</span>
          <span class="last-updated" id="lastUpdated"></span>
        </div>
        <div class="footer-btns">
          <button class="btn-sm" id="btnRefresh">↻</button>
          <button class="btn-sm" id="btnOptions">⚙</button>
        </div>
      </div>
    </div>
  `;

  requestAnimationFrame(() => {
    document.querySelectorAll('.bar-fill[data-target]').forEach(el => {
      el.style.width = el.dataset.target + '%';
    });
  });

  const fetchedAt = Date.now();
  function updateLastUpdated() {
    const el = document.getElementById('lastUpdated');
    if (el) el.textContent = 'Updated ' + timeSince(fetchedAt);
  }
  updateLastUpdated();
  lastUpdatedTimer = setInterval(updateLastUpdated, 5000);

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

async function saveEndpoint(url) {
  if (window.creationStorage) {
    try {
      const encoded = btoa(JSON.stringify({ url }));
      await window.creationStorage.plain.setItem('endpoint', encoded);
    } catch (e) { console.error('Save error:', e); }
  } else {
    localStorage.setItem('endpoint', JSON.stringify({ url }));
  }
}

async function loadEndpoint() {
  if (window.creationStorage) {
    try {
      const stored = await window.creationStorage.plain.getItem('endpoint');
      if (stored) {
        const parsed = JSON.parse(atob(stored));
        if (parsed.url) apiUrl = parsed.url;
      }
    } catch (e) { console.error('Load error:', e); }
  } else {
    const stored = localStorage.getItem('endpoint');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed.url) apiUrl = parsed.url;
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadEndpoint();
  fetchData();
  refreshTimer = setInterval(fetchData, REFRESH_INTERVAL);
});

window.addEventListener('sideClick', () => {
  fetchData();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    fetchData();
  }
});
