const ACCESS_PASSWORD = '12616625';
const AUTH_KEY = 'obama-control-center-auth';
const $ = (id) => document.getElementById(id);
const isLoginPage = document.body?.dataset?.page === 'login';
const isDashboardPage = document.body?.dataset?.page === 'dashboard' || !!$('connection');

if (isLoginPage) {
  const form = $('login-form');
  const passwordInput = $('password');
  const errorBox = $('login-error');

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = passwordInput.value.trim();
    if (value === ACCESS_PASSWORD) {
      sessionStorage.setItem(AUTH_KEY, 'true');
      window.location.href = '/index2.html';
      return;
    }
    if (errorBox) {
      errorBox.hidden = false;
      errorBox.textContent = 'Incorrect password.';
    }
    passwordInput.focus();
    passwordInput.select();
  });

  if (sessionStorage.getItem(AUTH_KEY) === 'true') {
    window.location.href = '/index2.html';
  }
} else if (isDashboardPage) {
  if (sessionStorage.getItem(AUTH_KEY) !== 'true') {
    window.location.href = '/';
  }

  let bots = [], logs = [], token = '', filter = 'all', limit = 1000;
  let connected = false, dashboardAvailable = false, dashboardUrl = '', clearedThrough = 0;
  let renderedFrame = false, renderPending = false;
  const pending = new Set();

  function uptime(start) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(start)) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  function renderBots() {
    for (const bot of bots) {
      const state = $(bot.id + '-state');
      state.textContent = connected ? bot.state[0].toUpperCase() + bot.state.slice(1) : 'Unknown';
      state.className = 'badge ' + (connected ? bot.state : '');
      $(bot.id + '-detail').textContent = connected ? (bot.pid ? `PID ${bot.pid}` : 'No managed process') : 'Launcher disconnected';
      $(bot.id + '-uptime').textContent = connected && bot.startedAt ? `Up ${uptime(bot.startedAt)}` : 'Process status';
      $(bot.id + '-error').textContent = bot.error ?? '';
      $(bot.id + '-error').hidden = !bot.error;
      for (const button of document.querySelectorAll(`[data-bot="${bot.id}"]`)) {
        const active = ['running', 'starting', 'stopping'].includes(bot.state) || bot.pid !== null;
        button.disabled = !connected || bot.busy || pending.has(bot.id)
          || (button.dataset.action === 'start' ? active : !active);
      }
    }
    renderFrame();
  }

  function renderFrame() {
    const obama = bots.find((bot) => bot.id === 'obama');
    const show = connected && obama?.state === 'running' && dashboardAvailable;
    $('frame-dot').className = 'dot' + (show ? ' live' : '');
    $('reload-frame').disabled = !show;
    $('open-dashboard').hidden = !show;
    $('frame-empty').hidden = show;
    $('obama-frame').hidden = !show;
    if (show && !renderedFrame) {
      $('obama-frame').src = dashboardUrl;
      renderedFrame = true;
    } else if (!show && renderedFrame) {
      $('obama-frame').removeAttribute('src');
      renderedFrame = false;
    }
    if (!show) {
      const waiting = ['running', 'starting'].includes(obama?.state);
      $('frame-title').textContent = !connected ? 'Launcher disconnected.' : waiting ? 'Waiting for Obama…' : obama?.state === 'failed' ? 'Obama needs attention.' : 'Obama is stopped.';
      $('frame-note').textContent = !connected ? 'This view reconnects when the launcher returns.' : waiting ? 'The overview will appear when its web server is ready.' : obama?.state === 'failed' ? 'Check the output, then start Obama again.' : 'Start Obama to open its live dashboard here.';
    }
  }

  function scheduleLogs() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => { renderPending = false; renderLogs(); });
  }

  function renderLogs() {
    const container = $('log-scroll');
    const scrollTop = container.scrollTop;
    const visible = logs.filter((entry) => entry.id > clearedThrough && (filter === 'all' || entry.bot === filter));
    const fragment = document.createDocumentFragment();
    for (const entry of visible) {
      const row = document.createElement('div'); row.className = `log-line ${entry.bot} ${entry.stream}`;
      const time = document.createElement('time'); time.className = 'log-time'; time.dateTime = entry.time;
      time.textContent = new Date(entry.time).toLocaleTimeString([], { hour12: false });
      const bot = document.createElement('span'); bot.className = 'log-bot'; bot.textContent = entry.bot;
      const message = document.createElement('span'); message.className = 'log-text'; message.textContent = entry.text;
      row.append(time, bot, message); fragment.append(row);
    }
    $('logs').replaceChildren(fragment);
    $('empty-logs').hidden = visible.length > 0;
    $('line-count').textContent = visible.length.toLocaleString();
    $('retention').textContent = `Last ${limit.toLocaleString()} lines · memory only`;
    $('last-output').textContent = visible.length ? `Last output ${new Date(visible.at(-1).time).toLocaleTimeString()}` : 'Waiting for output';
    container.scrollTop = $('follow').checked ? container.scrollHeight : scrollTop;
  }

  function connection(value) {
    connected = value;
    $('connection').textContent = value ? 'Launcher connected' : 'Disconnected · retrying';
    $('connection-dot').className = 'dot' + (value ? ' live' : '');
    renderBots();
  }

  const events = new EventSource('/api/events');
  events.addEventListener('snapshot', (event) => {
    const data = JSON.parse(event.data);
    if (token && token !== data.token) clearedThrough = 0;
    token = data.token; bots = data.bots; logs = data.logs; limit = data.logLimit;
    dashboardUrl = data.dashboardUrl; dashboardAvailable = data.dashboardAvailable;
    $('frame-address').textContent = new URL(dashboardUrl).host;
    $('open-dashboard').href = dashboardUrl;
    connection(true); scheduleLogs();
  });
  events.addEventListener('state', (event) => { bots = JSON.parse(event.data); renderBots(); });
  events.addEventListener('log', (event) => {
    logs.push(JSON.parse(event.data));
    if (logs.length > limit) logs.splice(0, logs.length - limit);
    scheduleLogs();
  });
  events.addEventListener('dashboard', (event) => { dashboardAvailable = JSON.parse(event.data).available; renderFrame(); });
  events.onerror = () => connection(false);

  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', async () => {
    const { bot, action } = button.dataset;
    if (!connected || pending.has(bot)) return;
    pending.add(bot); $('error').hidden = true; renderBots();
    try {
      const response = await fetch(`/api/bots/${bot}/${action}`, {
        method: 'POST', headers: { 'X-Bot-Control': token }, signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'The action failed.');
      bots = data.bots;
    } catch (error) {
      $('error').textContent = error.name === 'TimeoutError' ? 'The action is taking longer than expected. Check the process status and output before trying again.' : error.message;
      $('error').hidden = false;
    } finally { pending.delete(bot); renderBots(); }
  }));
  document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    filter = button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    scheduleLogs();
  }));
  $('clear').addEventListener('click', () => { clearedThrough = logs.at(-1)?.id ?? clearedThrough; scheduleLogs(); });
  $('follow').addEventListener('change', () => { if ($('follow').checked) $('log-scroll').scrollTop = $('log-scroll').scrollHeight; });
  $('reload-frame').addEventListener('click', () => { if (renderedFrame) $('obama-frame').src = dashboardUrl; });
  setInterval(renderBots, 1000);
}

