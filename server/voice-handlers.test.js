import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { makeVoiceModelHandler, makeOpenUrlHandler, asControlHandler, VOICE_HANDLERS, isWsl, openersFor, launch } from './voice-handlers.js';
import { activeHandlers, CONTROL_HANDLERS } from './control/handlers/index.js';

// Ported from Wrangler²'s server/handlers.test.js (its voice-model and job-open-url tests).
const fakeHost = () => { const broadcasts = []; return { broadcasts, host: { broadcast: (m) => broadcasts.push(m), log: () => {} } }; };

test('the voice model is fetched only on an explicit download: any other ask, the old bare one too, only checks the disk', async () => {
  const { host, broadcasts } = fakeHost();
  const calls = [];
  let present = false;
  const { handler } = makeVoiceModelHandler({ platform: 'darwin', has: async () => { calls.push('has'); return present; }, ensure: async ({ onProgress }) => { calls.push('ensure'); onProgress(0.5); present = true; } });
  await handler({}, host);
  await handler({ op: 'check' }, host);
  await handler({ op: 'downloadd' }, host);
  assert.deepEqual(calls, ['has', 'has', 'has'], 'nothing fetched');
  assert.deepEqual(broadcasts.at(-1), { event: 'voice-model', op: 'check', present: false, platform: 'darwin' });
  await handler({ op: 'download' }, host);
  assert.deepEqual(broadcasts.slice(-2), [{ event: 'voice-model', op: 'progress', fraction: 0.5 }, { event: 'voice-model', op: 'download', ok: true }]);
  await handler({}, host);
  assert.deepEqual(broadcasts.at(-1), { event: 'voice-model', op: 'check', present: true, platform: 'darwin' });
  const failing = makeVoiceModelHandler({ platform: 'linux', has: async () => { throw new Error('disk'); }, ensure: async () => { throw new Error('the voice model failed its checksum'); } }).handler;
  await failing({}, host);
  assert.deepEqual(broadcasts.at(-1), { event: 'voice-model', op: 'check', present: false, platform: 'linux' }, 'a check that cannot read the disk says absent');
  await failing({ op: 'download' }, host);
  assert.deepEqual(broadcasts.at(-1), { event: 'voice-model', op: 'download', ok: false, error: 'the voice model failed its checksum' });
});

function urlFixture({ platform = 'darwin', fail = null } = {}) {
  const calls = [];
  const execFile = (cmd, args, cb) => { calls.push([cmd, ...args]); cb(fail, '', fail ? 'LSOpenURLsWithRole() failed' : ''); };
  const { host, broadcasts } = fakeHost();
  const handler = makeOpenUrlHandler({ execFile, platform });
  return { open: (url) => handler.handler({ url }, host), calls, broadcasts };
}

test('open-url hands an http(s) link to macOS open as one argument, re-serialised, and says nothing on success', async () => {
  const f = urlFixture();
  await f.open('https://github.com/acme/widgets/pull/7');
  await f.open('http://localhost:5173/a b?q=1#x');
  assert.deepEqual(f.calls, [['open', 'https://github.com/acme/widgets/pull/7'], ['open', 'http://localhost:5173/a%20b?q=1#x']]);
  assert.deepEqual(f.broadcasts, []);
});

test('open-url refuses anything but an http(s) URL, opens nothing, and tells the board', async () => {
  const f = urlFixture();
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'x-apple.systempreferences:com.apple.preference.security', 'ssh://host', 'vscode://file/etc/hosts', '/Applications/Calculator.app', '-a Calculator', '--args https://x.com', 'not a url', '', null, 42, { href: 'https://x.com' }, `https://x.com/${'a'.repeat(9000)}`]) {
    await f.open(url);
    assert.deepEqual(f.broadcasts.at(-1), { event: 'open-url-failed', error: 'Voice opens only http and https links' }, String(url).slice(0, 40));
  }
  assert.deepEqual(f.calls, []);
  const windows = urlFixture({ platform: 'win32' });
  await windows.open('https://example.com/');
  assert.match(windows.broadcasts.at(-1).error, /supported on macOS, Linux and WSL only/); assert.deepEqual(windows.calls, []);
  const broken = urlFixture({ fail: Object.assign(new Error('exit 1'), { code: 1 }) });
  await broken.open('https://example.com/');
  assert.deepEqual(broken.broadcasts.at(-1), { event: 'open-url-failed', error: 'Could not open https://example.com/: LSOpenURLsWithRole() failed' });
});

test('each Voice handler is a core control handler under voice:, answering only the board that asked', async () => {
  const replies = [], broadcasts = [];
  const ctx = { reply: (m) => replies.push(m), broadcast: (m) => broadcasts.push(m) };
  const h = asControlHandler({ type: 'voice-model', handler: (msg, host) => host.broadcast({ event: 'voice-model', op: 'check', present: msg.op === 'check' }) });
  assert.equal(h.type, 'voice:model');
  await h.handler({ type: 'voice:model', op: 'check' }, ctx);
  assert.deepEqual(replies, [{ type: 'voice:model', op: 'check', present: true }]);
  assert.deepEqual(broadcasts, [], 'a transcript or a model answer never reaches another board');
  const speech = asControlHandler({ type: 'speech', handler: (msg, host) => host.broadcast({ event: 'speech', id: msg.id, kind: 'partial', text: 'hi' }) });
  await speech.handler({ id: 'b-1' }, ctx);
  assert.deepEqual(replies.at(-1), { type: 'voice:speech', id: 'b-1', kind: 'partial', text: 'hi' });
  assert.deepEqual(VOICE_HANDLERS.map((x) => x.type), ['voice:model', 'voice:speech', 'voice:dictation', 'voice:open-url']);
});

test('the board routes voice: frames, and no core or Wrangler² type is taken', () => {
  const types = activeHandlers({ ext: { handlers: [] } }).map((h) => h.type);
  for (const t of ['voice:model', 'voice:speech', 'voice:dictation', 'voice:open-url']) assert.ok(types.includes(t), t);
  assert.equal(new Set(types).size, types.length, 'every type once');
  const core = new Set(CONTROL_HANDLERS.map((h) => h.type));
  // Wrangler²'s own Voice handlers, which its extension registers when installed.
  for (const t of ['voice-model', 'speech', 'dictation', 'job-open-url']) assert.ok(!core.has(t) && !types.includes(t), t);
});

// A fake spawn: each command either is not installed (`missing`), exits with a code, or keeps running.
function spawnFixture(outcomes) {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    const child = Object.assign(new EventEmitter(), { unref: () => { child.unrefd = true; } });
    const o = outcomes[cmd] ?? 'missing';
    setImmediate(() => {
      if (o === 'missing') child.emit('error', Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' }));
      else if (typeof o === 'number') child.emit('exit', o, null);
    });
    return child;
  };
  return { spawn, calls };
}
function offMac({ platform = 'linux', wsl = false, outcomes = {} } = {}) {
  const s = spawnFixture(outcomes), { host, broadcasts } = fakeHost();
  const execFile = () => assert.fail('macOS open is never run off a Mac');
  const handler = makeOpenUrlHandler({ spawn: s.spawn, execFile, platform, wsl: () => wsl });
  return { open: (url) => handler.handler({ url }, host), calls: s.calls, broadcasts };
}

test('on Linux a link goes to xdg-open as one argument, detached with no pipes, and says nothing on success', async () => {
  const f = offMac({ outcomes: { 'xdg-open': 0 } });
  await f.open('https://github.com/acme/widgets/pull/7');
  await f.open('http://localhost:5173/a b?q=1#x');
  assert.deepEqual(f.calls.map((c) => [c.cmd, ...c.args]), [['xdg-open', 'https://github.com/acme/widgets/pull/7'], ['xdg-open', 'http://localhost:5173/a%20b?q=1#x']]);
  assert.deepEqual(f.calls[0].opts, { detached: true, stdio: 'ignore' }, 'no shell, and the browser it starts holds none of the wrangler’s pipes');
  assert.deepEqual(f.broadcasts, []);
  for (const url of ['file:///etc/passwd', '-a', 'javascript:alert(1)']) await f.open(url);
  assert.equal(f.calls.length, 2, 'the same refusals as on a Mac');
});

test('on Linux a missing or failing xdg-open is said on the board', async () => {
  const missing = offMac();
  await missing.open('https://example.com/');
  assert.deepEqual(missing.broadcasts, [{ event: 'open-url-failed', error: 'Could not open https://example.com/: xdg-open is not installed (xdg-open comes with xdg-utils)' }]);
  const failing = offMac({ outcomes: { 'xdg-open': 3 } });
  await failing.open('https://example.com/');
  assert.deepEqual(failing.broadcasts, [{ event: 'open-url-failed', error: 'Could not open https://example.com/: xdg-open exited 3' }]);
});

test('under WSL a link goes to the Windows browser: wslview, else explorer.exe, whose exit code 1 is its success', async () => {
  const wslview = offMac({ wsl: true, outcomes: { wslview: 0, 'explorer.exe': 1 } });
  await wslview.open('https://example.com/x');
  assert.deepEqual(wslview.calls.map((c) => [c.cmd, ...c.args]), [['wslview', 'https://example.com/x']]);
  assert.deepEqual(wslview.broadcasts, []);
  const explorer = offMac({ wsl: true, outcomes: { 'explorer.exe': 1 } });
  await explorer.open('https://example.com/x');
  assert.deepEqual(explorer.calls.map((c) => [c.cmd, ...c.args]), [['wslview', 'https://example.com/x'], ['explorer.exe', 'https://example.com/x']]);
  assert.deepEqual(explorer.broadcasts, [], 'explorer.exe exits 1 having opened it');
  const neither = offMac({ wsl: true });
  await neither.open('https://example.com/x');
  assert.match(neither.broadcasts.at(-1).error, /wslview or explorer\.exe is not installed \(wslview comes with wslu\)/);
  assert.deepEqual(openersFor('darwin', false), ['open']);
  assert.deepEqual(openersFor('linux', false), ['xdg-open']);
  assert.deepEqual(openersFor('win32', false), []);
});

test('an opener still running after a few seconds counts as launched, and is let go', async () => {
  const { spawn, calls } = spawnFixture({ 'xdg-open': 'running' });
  let fire;
  const r = launch('xdg-open', 'https://example.com/', { spawn, setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
  await new Promise((res) => setImmediate(res));
  fire();
  assert.deepEqual(await r, {});
  assert.equal(calls.length, 1);
});

test('WSL is told by its environment or the kernel’s release', () => {
  assert.equal(isWsl({ env: { WSL_DISTRO_NAME: 'Ubuntu' }, release: () => '6.8.0-generic' }), true);
  assert.equal(isWsl({ env: { WSL_INTEROP: '/run/WSL/1_interop' }, release: () => '' }), true);
  assert.equal(isWsl({ env: {}, release: () => '5.15.153.1-microsoft-standard-WSL2' }), true, 'sudo drops the environment');
  assert.equal(isWsl({ env: {}, release: () => '6.8.0-45-generic' }), false);
  assert.equal(isWsl({ env: {}, release: () => { throw new Error('ENOENT'); } }), false, 'not Linux at all');
});
