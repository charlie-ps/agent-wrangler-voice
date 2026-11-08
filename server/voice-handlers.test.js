import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeVoiceModelHandler, makeOpenUrlHandler, asControlHandler, VOICE_HANDLERS } from './voice-handlers.js';
import { activeHandlers, CONTROL_HANDLERS } from './control/handlers/index.js';

// Ported from Wrangler²'s server/handlers.test.js (its voice-model and job-open-url tests).
const fakeHost = () => { const broadcasts = []; return { broadcasts, host: { broadcast: (m) => broadcasts.push(m), log: () => {} } }; };

test('the voice model is fetched only on an explicit download: any other ask, the old bare one too, only checks the disk', async () => {
  const { host, broadcasts } = fakeHost();
  const calls = [];
  let present = false;
  const { handler } = makeVoiceModelHandler({ has: async () => { calls.push('has'); return present; }, ensure: async ({ onProgress }) => { calls.push('ensure'); onProgress(0.5); present = true; } });
  await handler({}, host);
  await handler({ op: 'check' }, host);
  await handler({ op: 'downloadd' }, host);
  assert.deepEqual(calls, ['has', 'has', 'has'], 'nothing fetched');
  assert.deepEqual(broadcasts.at(-1), { event: 'voice-model', op: 'check', present: false });
  await handler({ op: 'download' }, host);
  assert.deepEqual(broadcasts.slice(-2), [{ event: 'voice-model', op: 'progress', fraction: 0.5 }, { event: 'voice-model', op: 'download', ok: true }]);
  await handler({}, host);
  assert.deepEqual(broadcasts.at(-1), { event: 'voice-model', op: 'check', present: true });
  const failing = makeVoiceModelHandler({ has: async () => { throw new Error('disk'); }, ensure: async () => { throw new Error('the voice model failed its checksum'); } }).handler;
  await failing({}, host);
  assert.deepEqual(broadcasts.at(-1), { event: 'voice-model', op: 'check', present: false }, 'a check that cannot read the disk says absent');
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
  const linux = urlFixture({ platform: 'linux' });
  await linux.open('https://example.com/');
  assert.match(linux.broadcasts.at(-1).error, /only supported on macOS/); assert.deepEqual(linux.calls, []);
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
