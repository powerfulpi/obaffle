import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { randomBytes } from 'node:crypto';
import { BotManager, ControlError } from './manager.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultObama = resolve(here, '..');

async function requireFile(path, message) {
  try { await access(path, constants.R_OK); }
  catch { throw new ControlError(message, 422); }
}

async function requireFreePort(port) {
  const probe = createNetServer();
  await new Promise((resolve, reject) => {
    probe.once('error', () => reject(new ControlError(
      `Port ${port} is occupied. Stop the separately running Obama bot, or choose --obama-port.`, 409)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

export function botSpecs({ obamaDir, waffleDir, python, obamaPort, origin }) {
  const pythonPath = python ?? join(waffleDir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return [
    {
      id: 'obama', name: 'Obama', cwd: obamaDir,
      command: process.execPath, args: [join(obamaDir, 'scripts/run.mjs'), '--dev'],
      env: { DASHBOARD_PORT: String(obamaPort), BOT_CONTROL_ORIGIN: origin, NO_COLOR: '1' },
      prepare: async () => {
        await requireFile(join(obamaDir, 'scripts/run.mjs'), `Obama was not found in ${obamaDir}. Set --obama-dir.`);
        await requireFile(join(obamaDir, 'node_modules/typescript/bin/tsc'), 'Obama dependencies are missing. Run npm install in the Obama folder first.');
        await requireFreePort(obamaPort);
      },
    },
    {
      id: 'waffle', name: 'Waffle', cwd: waffleDir,
      command: pythonPath, args: ['-u', '-m', 'waffle.bot'],
      env: { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', NO_COLOR: '1',
        PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` },
      prepare: async () => {
        await requireFile(join(waffleDir, 'waffle/bot.py'), `Waffle was not found in ${waffleDir}. Set --waffle-dir.`);
        if (!python) await requireFile(pythonPath, 'Waffle needs a virtual environment. Create .venv and install Waffle there, or set --python to its Python executable.');
      },
    },
  ];
}

export async function createControlServer({ manager, port = 3001, obamaPort = 3000 }) {
  const token = randomBytes(32).toString('hex');
  const assets = new Map(await Promise.all([
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/index.html', 'index.html', 'text/html; charset=utf-8'],
    ['/index2.html', 'index2.html', 'text/html; charset=utf-8'],
    ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
    ['/style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([route, file, type]) => [route, { body: await readFile(join(here, 'public', file)), type }])));
  const streams = new Set();
  let origin;
  let dashboardAvailable = false;
  let probing = false;
  const dashboardUrl = `http://0.0.0.0:${obamaPort}`;
  const snapshot = () => ({ bots: manager.status(), logs: manager.logs, token, dashboardUrl,
    dashboardAvailable, logLimit: manager.logLimit });
  const send = (response, event, data) => {
    if (response.destroyed) return;
    // Disconnect a stalled browser rather than buffering logs indefinitely.
    if (response.writableLength > 256 * 1024) { response.destroy(); return; }
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const broadcast = (event, data) => { for (const response of streams) send(response, event, data); };
  const onState = (bots) => { broadcast('state', bots); void probeDashboard(); };
  const onLog = (entry) => broadcast('log', entry);
  manager.on('state', onState);
  manager.on('log', onLog);

  async function probeDashboard() {
    if (probing) return;
    probing = true;
    let available = false;
    try {
      if (manager.status().some((bot) => bot.id === 'obama' && bot.state === 'running')) {
        const response = await fetch(`${dashboardUrl}/api/stats`, { signal: AbortSignal.timeout(1200) });
        await response.body?.cancel();
        available = response.ok && manager.status().some((bot) => bot.id === 'obama' && bot.state === 'running');
      }
    } catch { /* The frame appears automatically once Obama's server is ready. */ }
    finally { probing = false; }
    if (available !== dashboardAvailable) {
      dashboardAvailable = available;
      broadcast('dashboard', { available });
    }
  }

  const server = createHttpServer(async (request, response) => {
    const allowedHosts = new Set([new URL(origin).host, `localhost:${server.address().port}`]);
    const host = request.headers.host;
    const requestOrigin = request.headers.origin;
    const allowedOrigins = new Set([origin, `http://localhost:${server.address().port}`]);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src ${dashboardUrl}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    const json = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    // Binding to loopback plus checking Host/Origin prevents cross-site control
    // and DNS rebinding. The action token is only available to this local page.
    //if (!allowedHosts.has(host) || (requestOrigin && !allowedOrigins.has(requestOrigin)) || request.headers['sec-fetch-site'] === 'cross-site') {
      //json(403, { error: 'Only the local dashboard can access this server.' }); return;
   // }
    const path = (request.url ?? '/').split('?')[0];
    if (request.method === 'GET' && path === '/' && host.startsWith('localhost:')) {
      response.writeHead(302, { Location: `${origin}/` }); response.end(); return;
    }
    if ((request.method === 'GET' || request.method === 'HEAD') && assets.has(path)) {
      const asset = assets.get(path);
      response.writeHead(200, { 'Content-Type': asset.type });
      response.end(request.method === 'HEAD' ? undefined : asset.body); return;
    }
    if (request.method === 'GET' && path === '/api/state') { json(200, snapshot()); return; }
    if (request.method === 'GET' && path === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.write('retry: 1500\n\n');
      streams.add(response);
      send(response, 'snapshot', snapshot());
      response.on('close', () => streams.delete(response));
      return;
    }
    const match = /^\/api\/bots\/(obama|waffle)\/(start|stop|restart)$/.exec(path);
    if (match && request.method === 'POST') {
      if (request.headers['x-bot-control'] !== token) { json(403, { error: 'Reload the dashboard to reconnect before using the controls.' }); return; }
      request.resume();
      try {
        await manager.action(match[1], match[2]);
        json(200, { bots: manager.status() });
      } catch (error) { json(error.status ?? 500, { error: error.message }); }
      return;
    }
    json(match ? 405 : 404, { error: match ? 'Use POST for bot controls.' : 'Not found.' });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxRequestsPerSocket = 1000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); });
  });
  origin = `http://0.0.0.0:${server.address().port}`;
  const heartbeat = setInterval(() => { for (const response of streams) send(response, 'ping', {}); }, 15_000);
  const probeTimer = setInterval(() => void probeDashboard(), 2000);
  return {
    server, origin,
    async close() {
      clearInterval(heartbeat); clearInterval(probeTimer);
      manager.off('state', onState); manager.off('log', onLog);
      for (const response of streams) response.end();
      await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    },
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    port: { type: 'string', default: '3001' },
    'obama-port': { type: 'string', default: '3000' },
    'obama-dir': { type: 'string' }, 'waffle-dir': { type: 'string' }, python: { type: 'string' },
    'no-autostart': { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log(`Usage: npm run bots -- [options]
  --port 3001          Control dashboard port
  --obama-port 3000    Obama's embedded dashboard port
  --obama-dir PATH     Obama project folder (default: this project)
  --waffle-dir PATH    Waffle project folder (default: ../Waffle)
  --python PATH        Waffle Python executable (default: its .venv)
  --no-autostart       Open the dashboard with both bots stopped

Starts both bots by default. Ctrl+C stops the launcher and its bot process trees.`);
    return;
  }
  const port = Number(values.port);
  const obamaPort = Number(values['obama-port']);
  for (const value of [port, obamaPort]) if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('Ports must be integers from 1 to 65535.');
  if (port === obamaPort) throw new Error('The control dashboard and Obama must use different ports.');
  const obamaDir = resolve(values['obama-dir'] ?? defaultObama);
  const waffleDir = resolve(values['waffle-dir'] ?? join(obamaDir, '..', 'Waffle'));
  const manager = new BotManager(botSpecs({ obamaDir, waffleDir, python: values.python,
    obamaPort, origin: `http://127.0.0.1:${port}` }));
  let control;
  try { control = await createControlServer({ manager, port, obamaPort }); }
  catch (error) {
    if (error.code === 'EADDRINUSE') throw new Error(`Port ${port} is already in use. Close the other launcher or pass --port with a different number. No bots were started.`);
    throw error;
  }
  console.log(`\nBot control center: ${control.origin}\nCtrl+C stops both bots and the dashboard.\n`);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('\nStopping bots…');
    // Keep the server bound until the bots have stopped, so a second launcher
    // cannot race this one during shutdown.
    await manager.shutdown();
    await control.close();
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  if (!values['no-autostart']) {
    await Promise.allSettled(['obama', 'waffle'].map((id) => manager.action(id, 'start')));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
