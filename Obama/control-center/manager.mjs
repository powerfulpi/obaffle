import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ControlError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

// One process group per bot keeps FFmpeg, the restart launcher, and its children
// together. Never signal processes that were not started by this manager.
async function stopTree(child, graceMs) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    await new Promise((resolve, reject) => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true, stdio: 'ignore', shell: false,
      });
      killer.once('error', reject);
      killer.once('exit', (code) => {
        if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolve();
        else reject(new Error(`Windows could not stop process tree ${child.pid} (taskkill ${code})`));
      });
    });
    return;
  }
  const signalGroup = (signal) => {
    try { process.kill(-child.pid, signal); return true; }
    catch (error) {
      if (error.code === 'ESRCH') return false;
      // EPERM on an existence probe still means the group exists. macOS can
      // report it briefly while the last process in a group is being reaped.
      if (signal === 0 && error.code === 'EPERM') return true;
      throw error;
    }
  };
  if (!signalGroup('SIGTERM')) return;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!signalGroup(0)) return;
    await pause(50);
  }
  signalGroup('SIGKILL');
}

export class BotManager extends EventEmitter {
  constructor(specs, { logLimit = 1000, graceMs = 5000, echo = true } = {}) {
    super();
    this.logLimit = logLimit;
    this.graceMs = graceMs;
    this.echo = echo;
    this.logs = [];
    this.sequence = 0;
    this.closing = false;
    this.bots = new Map(specs.map((spec) => [spec.id, {
      spec, child: null, state: 'stopped', startedAt: null,
      lastExit: null, error: null, busy: false, operation: null, cleanup: null,
    }]));
  }

  status() {
    return [...this.bots].map(([id, bot]) => ({
      id, name: bot.spec.name, state: bot.state, busy: bot.busy,
      pid: bot.child?.pid ?? null, startedAt: bot.startedAt,
      lastExit: bot.lastExit, error: bot.error,
    }));
  }

  changed() { this.emit('state', this.status()); }

  log(id, stream, message) {
    const text = stripVTControlCharacters(message).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
    if (!text.trim()) return;
    const entry = { id: ++this.sequence, bot: id, stream, text: text.slice(0, 8192), time: new Date().toISOString() };
    this.logs.push(entry);
    if (this.logs.length > this.logLimit) this.logs.shift();
    if (this.echo) process.stdout.write(`[${id}/${stream}] ${entry.text}\n`);
    this.emit('log', entry);
  }

  capture(stream, id, type) {
    const decoder = new StringDecoder('utf8');
    let pending = '';
    const consume = (chunk, flush = false) => {
      pending += chunk;
      const lines = pending.split(/\r\n|[\r\n]/);
      pending = lines.pop() ?? '';
      for (const line of lines) this.log(id, type, line);
      while (pending.length >= 8192) {
        this.log(id, type, pending.slice(0, 8192));
        pending = pending.slice(8192);
      }
      if (flush && pending) { this.log(id, type, pending); pending = ''; }
    };
    stream.on('data', (chunk) => consume(decoder.write(chunk)));
    stream.on('end', () => consume(decoder.end(), true));
  }

  action(id, action) {
    const bot = this.bots.get(id);
    if (!bot || !['start', 'stop', 'restart'].includes(action)) throw new ControlError('Unknown bot or action.', 404);
    if (this.closing) throw new ControlError('The launcher is shutting down.', 503);
    if (bot.busy) throw new ControlError(`${bot.spec.name} is already changing state.`);
    bot.busy = true;
    this.changed();
    bot.operation = (async () => {
      try {
        if (action === 'stop' || action === 'restart') await this.stop(bot);
        if (action === 'start' || action === 'restart') await this.start(bot);
      } catch (error) {
        bot.error = error.message;
        if (!bot.child) bot.state = 'failed';
        this.log(id, 'system', error.message);
        throw error;
      } finally {
        bot.busy = false;
        this.changed();
      }
    })();
    return bot.operation;
  }

  async start(bot) {
    if (bot.child) return;
    if (bot.cleanup) await bot.cleanup;
    bot.state = 'starting';
    bot.error = null;
    this.changed();
    await bot.spec.prepare?.();
    if (this.closing) throw new ControlError('The launcher is shutting down.', 503);
    const child = spawn(bot.spec.command, bot.spec.args, {
      cwd: bot.spec.cwd, env: { ...process.env, ...bot.spec.env },
      stdio: ['ignore', 'pipe', 'pipe'], shell: false,
      detached: process.platform !== 'win32', windowsHide: true,
    });
    bot.child = child;
    this.capture(child.stdout, bot.spec.id, 'stdout');
    this.capture(child.stderr, bot.spec.id, 'stderr');
    child.on('error', (error) => {
      bot.error = error.message;
      this.log(bot.spec.id, 'system', `Process error: ${error.message}`);
    });
    child.once('exit', (code, signal) => {
      bot.lastExit = { code, signal, time: new Date().toISOString() };
      this.log(bot.spec.id, 'system', `Exited (${signal ?? `code ${code}`}).`);
      if (bot.state !== 'stopping') {
        // A crashed parent must not leave a player/encoder behind.
        bot.state = code === 0 ? 'stopped' : 'failed';
        if (code !== 0) bot.error ??= `Process exited with ${signal ?? `code ${code}`}. See the output below.`;
        bot.cleanup = stopTree(child, this.graceMs).catch((error) => {
          bot.error = error.message;
          this.log(bot.spec.id, 'system', `Cleanup failed: ${error.message}`);
        }).finally(() => {
          if (bot.child === child) bot.child = null;
          bot.startedAt = null;
          this.changed();
        });
      }
      this.changed();
    });
    try {
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
    } catch (error) {
      bot.child = null;
      bot.state = 'failed';
      throw error;
    }
    bot.startedAt = new Date().toISOString();
    bot.lastExit = null;
    bot.state = 'running';
    this.log(bot.spec.id, 'system', `Started process ${child.pid}.`);
    this.changed();
  }

  async stop(bot) {
    if (bot.cleanup) await bot.cleanup;
    const child = bot.child;
    if (!child) {
      bot.state = 'stopped'; bot.error = null; this.changed(); return;
    }
    bot.state = 'stopping';
    this.changed();
    this.log(bot.spec.id, 'system', 'Stopping process tree…');
    await stopTree(child, this.graceMs);
    // Wait for the root to be reaped before a subsequent start.
    if (child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => child.once('exit', resolve));
    }
    bot.child = null;
    bot.startedAt = null;
    bot.state = 'stopped';
    bot.error = null;
    this.changed();
  }

  async shutdown() {
    this.closing = true;
    await Promise.allSettled([...this.bots.values()].map(async (bot) => {
      await bot.operation?.catch(() => {});
      await this.stop(bot);
    }));
  }
}
