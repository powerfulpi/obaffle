import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, get } from 'node:http';
import { fileURLToPath } from 'node:url';
import { BotManager } from '../manager.mjs';
import { createControlServer, botSpecs } from '../server.mjs';

const fixture = fileURLToPath(new URL('./fixtures/bot.mjs', import.meta.url));
const spec = (id = 'obama', args = []) => ({ id, name: id, command: process.execPath, args: [fixture, ...args], cwd: process.cwd() });
const makeManager = (specs = [spec()]) => new BotManager(specs, { echo: false, graceMs: 250 });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  const end = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('Timed out waiting for test process');
    await delay(20);
  }
}
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

test('start is idempotent, output preserves split UTF-8, restart replaces PID, stop reaps it', async (t) => {
  const manager = makeManager();
  t.after(() => manager.shutdown());
  await manager.action('obama', 'start');
  const first = manager.status()[0].pid;
  await manager.action('obama', 'start');
  assert.equal(manager.status()[0].pid, first);
  await until(() => manager.logs.some((line) => line.text === '🧇 streaming output'));
  assert(manager.logs.some((line) => line.stream === 'stderr' && line.text === 'fixture stderr'));
  const restarting = manager.action('obama', 'restart');
  assert.throws(() => manager.action('obama', 'start'), /already changing state/);
  await restarting;
  const second = manager.status()[0].pid;
  assert.notEqual(second, first);
  assert.equal(alive(first), false);
  await manager.action('obama', 'stop');
  assert.equal(alive(second), false);
  assert.equal(manager.status()[0].state, 'stopped');
  assert.equal(manager.status()[0].pid, null);
});

test('stopping a bot kills its stubborn descendants too', async (t) => {
  const manager = makeManager([spec('waffle', ['--tree'])]);
  t.after(() => manager.shutdown());
  await manager.action('waffle', 'start');
  await until(() => manager.logs.some((line) => line.text.startsWith('descendant:')));
  const descendant = Number(manager.logs.find((line) => line.text.startsWith('descendant:')).text.split(':')[1]);
  assert(alive(descendant));
  await manager.action('waffle', 'stop');
  await until(() => !alive(descendant));
});

test('unexpected exits and missing executables produce actionable failure states', async (t) => {
  const manager = makeManager([spec('obama', ['--crash']), { ...spec('waffle'), command: '/no-such-control-test-python' }]);
  t.after(() => manager.shutdown());
  await manager.action('obama', 'start');
  await until(() => manager.status()[0].state === 'failed' && manager.status()[0].pid === null);
  assert.equal(manager.status()[0].lastExit.code, 7);
  await assert.rejects(manager.action('waffle', 'start'), /ENOENT/);
  assert.equal(manager.status()[1].state, 'failed');
  assert.equal(manager.status()[1].pid, null);
});

test('logs are bounded, control characters stripped, and shutdown stops both bots', async () => {
  const manager = makeManager([spec('obama'), spec('waffle')]);
  manager.logLimit = 3;
  for (let i = 0; i < 10; i++) manager.log('obama', 'stdout', `\x1b[31mline ${i}\x1b[0m`);
  assert.equal(manager.logs.length, 3);
  assert.equal(manager.logs[0].text, 'line 7');
  try {
    await Promise.all(['obama', 'waffle'].map((id) => manager.action(id, 'start')));
    const pids = manager.status().map((bot) => bot.pid);
    await manager.shutdown();
    assert(manager.status().every((bot) => bot.state === 'stopped'));
    assert(pids.every((pid) => !alive(pid)));
    assert.throws(() => manager.action('obama', 'start'), /shutting down/);
  } finally { await manager.shutdown(); }
});

test('localhost HTTP controls, SSE replay, and request boundaries work end to end', async (t) => {
  const manager = makeManager([spec('obama'), spec('waffle')]);
  const control = await createControlServer({ manager, port: 0 });
  t.after(async () => { await manager.shutdown(); await control.close(); });
  assert.equal(control.server.address().address, '127.0.0.1');
  const request = (path, options) => fetch(control.origin + path, options);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Obama overview/);
  assert.match(page.headers.get('content-security-policy'), /frame-src http:\/\/127.0.0.1:3000/);
  assert.equal((await request('/.env')).status, 404);
  // fetch normalizes Host to its URL; use raw HTTP to exercise DNS rebinding.
  const reboundStatus = await new Promise((resolve, reject) => {
    get(control.origin + '/api/state', { headers: { Host: 'attacker.example' } }, (response) => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(reboundStatus, 403);
  assert.equal((await request('/api/state', { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await request('/api/bots/obama/start', { method: 'POST' })).status, 403);
  const { token } = await (await request('/api/state')).json();
  const headers = { 'X-Bot-Control': token, Origin: control.origin };
  assert.equal((await request('/api/bots/obama/start', { method: 'POST', headers })).status, 200);
  await until(() => manager.logs.some((entry) => entry.text === 'fixture ready'));
  const abort = new AbortController();
  const events = await request('/api/events', { signal: abort.signal });
  assert.match(events.headers.get('content-type'), /text\/event-stream/);
  const reader = events.body.getReader();
  const initial = new TextDecoder().decode((await reader.read()).value);
  assert.match(initial, /event: snapshot/);
  assert.match(initial, /fixture ready/);
  manager.log('waffle', 'stdout', 'new event after connection');
  const next = new TextDecoder().decode((await reader.read()).value);
  assert.match(next, /event: log/);
  assert.match(next, /new event after connection/);
  abort.abort();
  assert.equal((await request('/api/bots/obama/stop', { method: 'POST', headers })).status, 200);
  assert.equal(manager.status()[0].state, 'stopped');
  assert.equal((await request('/api/bots/obama/start')).status, 405);
  assert.equal((await request('/api/bots/obama/run-shell', { method: 'POST', headers })).status, 404);
});

test('embedded dashboard readiness follows the managed Obama process', async (t) => {
  const overview = createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('{"online":false}'); });
  await new Promise((resolve) => overview.listen(0, '127.0.0.1', resolve));
  const manager = makeManager();
  const control = await createControlServer({ manager, port: 0, obamaPort: overview.address().port });
  t.after(async () => {
    await manager.shutdown(); await control.close();
    await new Promise((resolve) => { overview.close(resolve); overview.closeAllConnections(); });
  });
  const state = async () => (await fetch(control.origin + '/api/state')).json();
  assert.equal((await state()).dashboardAvailable, false);
  await manager.action('obama', 'start');
  let result;
  for (let i = 0; i < 150; i++) {
    result = await state();
    if (result.dashboardAvailable) break;
    await delay(20);
  }
  assert.equal(result.dashboardAvailable, true);
  assert.equal(result.dashboardUrl, `http://127.0.0.1:${overview.address().port}`);
  await manager.action('obama', 'stop');
  assert.equal((await state()).dashboardAvailable, false);
});

test('launch specs use separate working directories and pass the frame origin', () => {
  const specs = botSpecs({ obamaDir: '/example/obama', waffleDir: '/example/Waffle', python: 'my-python', obamaPort: 3030, origin: 'http://127.0.0.1:3001' });
  assert.equal(specs[0].env.BOT_CONTROL_ORIGIN, 'http://127.0.0.1:3001');
  assert.equal(specs[0].env.DASHBOARD_PORT, '3030');
  assert.equal(specs[1].command, 'my-python');
  assert.deepEqual(specs[1].args, ['-u', '-m', 'waffle.bot']);
  assert.equal(specs[1].cwd, '/example/Waffle');
});
