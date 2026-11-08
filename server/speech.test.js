import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { glossary, makeHelperBuilder, makeSpeech, makeSpeechHandler, SpeechUnavailable, CONTEXT, MAX_SESSIONS, MAX_BACKLOG } from './speech.js';

test('the glossary fixes the transcriber’s measured misses and leaves ordinary words alone', () => {
  assert.equal(glossary('Please open a pool request for it'), 'Please open a pull request for it');
  assert.equal(glossary('Pool requests are waiting'), 'Pull requests are waiting');
  assert.equal(glossary('Retrive'), 'Retry');
  assert.equal(glossary('That idea.'), 'Add idea', 'said alone, it is the button');
  assert.equal(glossary('I like that idea a lot'), 'I like that idea a lot', 'inside a sentence it is left alone');
  assert.equal(glossary('the swimming pool is open'), 'the swimming pool is open');
});

function builder(t, { platform = 'darwin', release = '25.6.0', fail = {}, swiftc = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-speech-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'helper.swift');
  fs.writeFileSync(source, 'print("hi")');
  const ran = [];
  const execFile = (cmd, args, _opts, cb) => {
    ran.push([cmd, ...args]);
    if (fail[cmd]) return setImmediate(() => cb(Object.assign(new Error('failed'), { code: 1 }), '', fail[cmd]));
    if (args[0] === 'swiftc') fs.writeFileSync(args[args.indexOf('-o') + 1], 'binary');
    setImmediate(() => cb(null, '/Library/Developer/CommandLineTools', ''));
  };
  const exists = (p) => (p.startsWith('/Library/Developer/CommandLineTools/') ? swiftc && p.endsWith('/usr/bin/swiftc') : fs.existsSync(p));
  return { dir, source, ran, ensure: makeHelperBuilder({ dir: path.join(dir, 'cache'), source, platform, release, execFile, exists }) };
}

test('the helper is built once with Apple’s swiftc into the cache, named by its source, and reused', async (t) => {
  const b = builder(t);
  const [one, two] = await Promise.all([b.ensure(), b.ensure()]);
  assert.equal(one, two);
  assert.match(path.basename(one), /^w2-speech-[0-9a-f]{16}$/);
  assert.equal(path.dirname(one), path.join(b.dir, 'cache'));
  assert.deepEqual(b.ran.map((r) => r.slice(0, 2)), [['/usr/bin/xcode-select', '-p'], ['/usr/bin/xcrun', 'swiftc']], 'one build for two asks');
  await b.ensure();
  assert.equal(b.ran.length, 2, 'built already: nothing runs');
  fs.writeFileSync(b.source, 'print("changed")');
  assert.notEqual(await b.ensure(), one, 'a changed source builds afresh');
});

test('where the helper cannot run, the reason says why, and nothing is left half built', async (t) => {
  await assert.rejects(builder(t, { platform: 'linux' }).ensure(), (e) => e instanceof SpeechUnavailable && e.reason === 'not-mac');
  await assert.rejects(builder(t, { release: '24.5.0' }).ensure(), (e) => e.reason === 'old-macos');
  for (const noTools of [builder(t, { fail: { '/usr/bin/xcode-select': 'no developer tools' } }), builder(t, { swiftc: false })]) {
    await assert.rejects(noTools.ensure(), (e) => e.reason === 'no-swiftc' && /xcode-select --install/.test(e.message));
    assert.equal(noTools.ran.some((r) => r[0] === '/usr/bin/xcrun'), false, 'the swiftc shim, which opens an install dialog, is never run');
  }
  const broken = builder(t, { fail: { '/usr/bin/xcrun': 'helper.swift:3:1: error: cannot find Speech' } });
  await assert.rejects(broken.ensure(), (e) => e.reason === 'build-failed' && /cannot find Speech/.test(e.message));
  assert.deepEqual(fs.readdirSync(path.join(broken.dir, 'cache')), []);
});

// A helper process the test drives: what the board sent reaches `stdin`, and `say` is its stdout.
function fakeHelper() {
  const procs = [];
  const spawn = (bin, args) => {
    const p = new EventEmitter();
    p.bin = bin; p.args = args; p.exitCode = null; p.got = [];
    p.stdin = new PassThrough(); p.stdout = new PassThrough(); p.stderr = new PassThrough();
    p.stdin.on('data', (d) => p.got.push(d));
    p.stdin.on('finish', () => { p.closed = true; });
    p.say = (...o) => p.stdout.write(o.map((x) => JSON.stringify(x)).join('\n') + '\n');
    p.exit = (code) => { p.exitCode = code; p.emit('close', code); };
    p.kill = () => { p.killed = true; p.exit(null); };
    procs.push(p);
    return p;
  };
  return { procs, spawn };
}
const tick = () => new Promise((r) => setImmediate(r));

test('a recording streams audio to its helper and answers partial words, then the final text with its latency, logged', async () => {
  const h = fakeHelper(), events = [], logs = [];
  let clock = 1000;
  const speech = makeSpeech({ ensureHelper: async () => '/cache/w2-speech-x', spawn: h.spawn, now: () => clock, log: (m) => logs.push(m) });
  const started = speech.start('b-1', { rate: 16000 }, (e) => events.push(e));
  speech.audio('b-1', Buffer.from([1, 2, 3, 4]).toString('base64'));
  await started;
  const p = h.procs[0];
  assert.equal(p.bin, '/cache/w2-speech-x');
  assert.deepEqual(p.args, ['--rate', '16000', '--context', CONTEXT.join(',')]);
  speech.audio('b-1', Buffer.from([5, 6]).toString('base64'));
  await tick();
  assert.deepEqual(Buffer.concat(p.got), Buffer.from([1, 2, 3, 4, 5, 6]), 'audio sent before the helper started waits for it');
  p.say({ ev: 'ready' });
  clock = 2000;
  p.say({ ev: 'partial', text: 'Please' }, { ev: 'partial', text: 'Please add a pool request' });
  await tick();
  assert.deepEqual(events.filter((e) => e.kind === 'partial'), [{ kind: 'partial', text: 'Please add a pull request' }], 'only the latest of a burst, through the glossary');
  clock = 5000;
  speech.stop('b-1');
  await tick();
  assert.equal(p.closed, true, 'stop closes stdin, which finalises');
  clock = 5090;
  p.say({ ev: 'final', text: 'Please add a pull request. ' });
  p.exit(0);
  await tick();
  assert.deepEqual(events.at(-1), { kind: 'final', text: 'Please add a pull request.', afterStop: 90, first: 1000 });
  assert.deepEqual(logs, ['speech: final 90ms after stop, first words 1000ms after start']);
  assert.equal(speech.active, 0);
});

test('a helper that cannot run answers why; one that dies says so; at most two record at once', async () => {
  const h = fakeHelper(), events = [];
  const down = makeSpeech({ ensureHelper: async () => { throw new SpeechUnavailable('no-swiftc', 'swiftc is not installed'); }, spawn: h.spawn });
  await down.start('x', {}, (e) => events.push(e));
  assert.deepEqual(events, [{ kind: 'error', reason: 'no-swiftc', error: 'swiftc is not installed' }]);
  assert.equal(h.procs.length, 0);

  const got = [];
  const speech = makeSpeech({ ensureHelper: async () => 'bin', spawn: h.spawn, log: () => {} });
  await speech.start('a', {}, (e) => got.push(e));
  h.procs[0].say({ ev: 'error', reason: 'unavailable', error: 'SpeechTranscriber is not available on this Mac' });
  await tick();
  h.procs[0].exit(1);
  assert.deepEqual(got.at(-1), { kind: 'error', reason: 'unavailable', error: 'SpeechTranscriber is not available on this Mac' });

  for (const id of ['p', 'q', 'r']) await speech.start(id, {}, () => {});
  assert.equal(speech.active, MAX_SESSIONS);
  assert.equal(h.procs[1].killed, true, 'the oldest goes');
  speech.cancel('q'); speech.cancel('r');
  assert.equal(speech.active, 0);
});

test('the handler takes only well-formed frames: an id, a sane rate, base64 audio of bounded size', async () => {
  const h = fakeHelper(), sent = [];
  const handler = makeSpeechHandler({ ensureHelper: async () => 'bin', spawn: h.spawn });
  const host = { log: () => {}, broadcast: (m) => sent.push(m) };
  await handler.handler({ type: 'speech', op: 'start' }, host);
  assert.equal(h.procs.length, 0, 'no id, nothing starts');
  await handler.handler({ type: 'speech', op: 'start', id: 'b-1', rate: 1e9 }, host);
  assert.deepEqual(h.procs[0].args.slice(0, 2), ['--rate', '16000']);
  handler.handler({ type: 'speech', op: 'audio', id: 'b-1', pcm: 'A'.repeat(300 * 1024) }, host);
  handler.handler({ type: 'speech', op: 'audio', id: 'b-1', pcm: 'AAEC' }, host);
  await tick();
  assert.deepEqual(Buffer.concat(h.procs[0].got), Buffer.from('AAEC', 'base64'), 'an oversized frame is dropped');
  h.procs[0].say({ ev: 'ready' });
  await tick();
  assert.deepEqual(sent, [{ event: 'speech', id: 'b-1', kind: 'ready' }]);
  handler.handler({ type: 'speech', op: 'cancel', id: 'b-1' }, host);
  assert.equal(h.procs[0].killed, true);
});

test('a client flooding audio before the helper reads it is cut off at the backlog cap', async () => {
  let release;
  const h = fakeHelper();
  const speech = makeSpeech({ ensureHelper: () => new Promise((r) => { release = () => r('bin'); }), spawn: h.spawn });
  const started = speech.start('f', {}, () => {});
  const frame = Buffer.alloc(150 * 1024).toString('base64');
  for (let i = 0; i < 40; i++) speech.audio('f', frame);
  release(); await started; await tick();
  const got = Buffer.concat(h.procs[0].got).length;
  assert.ok(got <= MAX_BACKLOG && got > MAX_BACKLOG - 150 * 1024, `${got} bytes reached the helper`);
  speech.cancel('f');
});

test('setup builds the helper and installs macOS’s model with nothing recorded, saying how far it has got', async () => {
  let release;
  const h = fakeHelper(), events = [];
  const speech = makeSpeech({ ensureHelper: () => new Promise((r) => { release = () => r('/cache/w2-speech-x'); }), spawn: h.spawn });
  const done = speech.setup((e) => events.push(e));
  await new Promise((r) => setTimeout(r, 70));
  assert.deepEqual(events, [{ kind: 'building' }], 'a build past a glance says so');
  release(); await tick();
  assert.deepEqual(h.procs.map((p) => [p.bin, p.args]), [['/cache/w2-speech-x', ['--setup']]]);
  assert.equal(speech.active, 0, 'no recording');
  const later = [];
  speech.setup((e) => later.push(e));
  assert.deepEqual(later, [{ kind: 'built' }], 'a second board joins the run and hears where it is');
  h.procs[0].say({ ev: 'installing', fraction: 0 }, { ev: 'installing', fraction: 0.4 }, { ev: 'installed' });
  await tick();
  h.procs[0].exit(0);
  await done;
  assert.deepEqual(events, [{ kind: 'building' }, { kind: 'built' }, { kind: 'installing', fraction: 0 }, { kind: 'installing', fraction: 0.4 }, { kind: 'installed' }]);
  assert.deepEqual(later.at(-1), { kind: 'installed' });
  assert.equal(h.procs.length, 1, 'one helper for both');
});

test('a setup the helper cannot do says which half failed', async () => {
  const h = fakeHelper(), down = [], failed = [];
  await makeSpeech({ ensureHelper: async () => { throw new SpeechUnavailable('no-swiftc', 'swiftc is not installed'); }, spawn: h.spawn }).setup((e) => down.push(e));
  assert.deepEqual(down, [{ kind: 'error', step: 'helper', reason: 'no-swiftc', error: 'swiftc is not installed' }]);
  assert.equal(h.procs.length, 0);
  const done = makeSpeech({ ensureHelper: async () => 'bin', spawn: h.spawn, log: () => {} }).setup((e) => failed.push(e));
  await tick(); await tick();
  h.procs[0].say({ ev: 'error', reason: 'no-model', error: 'macOS could not install its English speech model' });
  await tick();
  h.procs[0].exit(1);
  await done;
  assert.deepEqual(failed, [{ kind: 'built' }, { kind: 'error', step: 'model', reason: 'no-model', error: 'macOS could not install its English speech model' }]);
});

test('the handler’s setup answers on the broadcast under the board’s id', async () => {
  const h = fakeHelper(), sent = [];
  const handler = makeSpeechHandler({ ensureHelper: async () => 'bin', spawn: h.spawn });
  const done = handler.handler({ type: 'speech', op: 'setup', id: 'b-setup-1' }, { log: () => {}, broadcast: (m) => sent.push(m) });
  await tick(); await tick();
  h.procs[0].say({ ev: 'installed' }); await tick();
  h.procs[0].exit(0); await done;
  assert.deepEqual(sent, [{ event: 'speech', id: 'b-setup-1', kind: 'built' }, { event: 'speech', id: 'b-setup-1', kind: 'installed' }]);
});
