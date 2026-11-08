import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn as defaultSpawn, execFile as defaultExecFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA_DIR } from './data-dir.js';

// Speech to text for the board's text boxes under Voice labels (public/voice-box.js): the browser records, sends the
// microphone here as 16-bit PCM over the control socket, and Apple's SpeechTranscriber
// (speech-helper.swift) turns it into words on this Mac. The helper is built from source with
// Apple's own swiftc on first use, never shipped as a binary, into DATA_DIR: a Mac's binary allow-listing may let an unsigned
// binary run there but kills one in ~/Library, /tmp or Downloads. Named by its source's hash, so a
// changed source builds afresh. One helper process per recording: closing its stdin finalises it.
// Nothing reaches the helper from the browser but audio bytes and a sample rate.
export const SPEECH_DIR = path.join(DATA_DIR, 'voice-speech');
export const HELPER_SOURCE = fileURLToPath(new URL('./speech-helper.swift', import.meta.url));
// Words the transcriber is primed with (`--context`); the glossary fixes what it still misses.
export const CONTEXT = ['Wrangler', 'Add idea', 'pull request', 'Retry', 'Approve', 'Rework'];
export const MAX_MS = 5 * 60 * 1000;
export const MAX_SESSIONS = 2;
// A setup still installing macOS's model after this is stopped; the first box tries again.
export const SETUP_MS = 10 * 60 * 1000;
const MAX_AUDIO = 256 * 1024;
// Audio a helper has not read yet, past which frames are dropped: a client flooding frames cannot grow the wrangler's memory.
export const MAX_BACKLOG = 2 * 1024 * 1024;

// Measured misses: "pull request" heard as "pool request", "Retry" as "Retrive", and
// "Add idea" said alone as "That idea" ("that idea" inside a sentence is left alone).
const FIXES = [[/\b([Pp])ool (requests?)\b/g, (_, p, r) => `${p}ull ${r}`], [/\bretriv(?:e|ed)\b/gi, (w) => (w[0] === 'R' ? 'Retry' : 'retry')]];
const WHOLE = [[/^\s*that idea[.!]?\s*$/i, 'Add idea']];
export function glossary(text) {
  for (const [re, to] of WHOLE) if (re.test(text)) return to;
  return FIXES.reduce((t, [re, to]) => t.replace(re, to), text);
}

// Why the helper cannot run here, as `reason` on the reply; the board falls back to the Mac's own Dictation.
export class SpeechUnavailable extends Error {
  constructor(reason, message) { super(message); this.reason = reason; }
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
const run = (execFile, cmd, args, opts) => new Promise((resolve, reject) => execFile(cmd, args, opts, (err, out, stderr) => (err ? reject(Object.assign(err, { stderr: String(stderr || '') })) : resolve(String(out)))));

export function makeHelperBuilder({ dir = SPEECH_DIR, source = HELPER_SOURCE, platform = process.platform, release = os.release(), execFile = defaultExecFile, exists = fs.existsSync } = {}) {
  let building = null;
  return function ensureHelper() {
    if (platform !== 'darwin') return Promise.reject(new SpeechUnavailable('not-mac', 'Apple’s speech helper only runs on a Mac'));
    // Darwin 25 is macOS 26, the first with SpeechTranscriber.
    if (Number(String(release).split('.')[0]) < 25) return Promise.reject(new SpeechUnavailable('old-macos', 'Apple’s speech helper needs macOS 26'));
    const bin = path.join(dir, `w2-speech-${sha(source)}`);
    if (exists(bin)) return Promise.resolve(bin);
    return (building ??= (async () => {
      // /usr/bin/swiftc without the Command Line Tools opens Apple's install dialog, so look for it first.
      const tools = await run(execFile, '/usr/bin/xcode-select', ['-p'], { timeout: 5000 }).catch(() => '');
      if (!['usr/bin/swiftc', 'Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc'].some((p) => tools.trim() && exists(path.join(tools.trim(), p)))) {
        throw new SpeechUnavailable('no-swiftc', 'swiftc is not installed: xcode-select --install adds it');
      }
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const part = `${bin}.${process.pid}.part`;
      try {
        await run(execFile, '/usr/bin/xcrun', ['swiftc', '-O', '-o', part, source], { timeout: 180000 });
        fs.renameSync(part, bin);
      } catch (e) {
        fs.rmSync(part, { force: true });
        const why = (e.stderr || e.message || '').split('\n').find((l) => /error/i.test(l)) || e.message;
        throw new SpeechUnavailable('build-failed', `the speech helper did not build: ${String(why).trim().slice(0, 200)}`);
      }
      return bin;
    })().finally(() => { building = null; }));
  };
}

// The recordings in flight, by the board's own id. `emit(event)` is the broadcast (`kind`: building,
// installing, ready, partial, final, error; a setup's: building, built, installing, installed, error); `log` the wrangler's log, where each recording's
// latency lands: first words after start, and final text after stop.
export function makeSpeech({ ensureHelper = makeHelperBuilder(), spawn = defaultSpawn, now = () => performance.now(), log = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const sessions = new Map();
  function end(id) {
    const s = sessions.get(id);
    if (!s) return;
    sessions.delete(id);
    clearTimer(s.timer);
    if (s.proc && s.proc.exitCode === null) s.proc.kill();
  }
  function stop(id) {
    const s = sessions.get(id);
    if (!s || s.stopAt != null) return;
    s.stopAt = now();
    if (s.proc) s.proc.stdin.end(); else s.stopEarly = true;
  }
  // The helper, with `building` said if it takes longer than a glance.
  async function helper(say) {
    const ready = ensureHelper();
    if (!(await Promise.race([ready.then(() => true, () => true), new Promise((r) => setTimer(() => r(false), 50))]))) say();
    return ready;
  }
  // Voice turned on (`setup`): the helper built and macOS's English model installed, with nothing
  // recorded, so the first box listens at once. One at a time: a second board joins the run in flight
  // and hears where it has got to.
  let setting = null, lastSetup = null;
  const watchers = new Set();
  function setup(emit) {
    watchers.add(emit);
    if (setting) { if (lastSetup) emit(lastSetup); return setting; }
    const tell = (e) => { lastSetup = e; for (const w of watchers) w(e); };
    return (setting = (async () => {
      let bin;
      try { bin = await helper(() => tell({ kind: 'building' })); } catch (e) { tell({ kind: 'error', step: 'helper', reason: e.reason || 'failed', error: e.message }); return; }
      tell({ kind: 'built' });
      await new Promise((resolve) => {
        const proc = spawn(bin, ['--setup'], { stdio: ['ignore', 'pipe', 'pipe'] });
        const timer = setTimer(() => proc.kill(), SETUP_MS);
        let pending = '', failed = null, done = false, err = '';
        proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
        proc.stdout.on('data', (d) => {
          const lines = (pending + d).split('\n');
          pending = lines.pop();
          for (const line of lines) {
            let o;
            try { o = JSON.parse(line); } catch { continue; }
            if (o.ev === 'installing') tell({ kind: 'installing', fraction: Number.isFinite(o.fraction) ? Math.max(0, Math.min(1, o.fraction)) : null });
            else if (o.ev === 'installed') done = true;
            else if (o.ev === 'error') failed = o;
          }
        });
        proc.on('error', (e) => { failed = { reason: 'spawn', error: e.message }; });
        proc.on('close', (code) => {
          clearTimer(timer);
          if (done && !code) tell({ kind: 'installed' });
          else {
            log('speech setup failed', failed?.error || err.trim() || `exit ${code}`);
            tell({ kind: 'error', step: 'model', reason: failed?.reason || 'failed', error: failed?.error || err.trim().split('\n').pop() || `the speech helper stopped (exit ${code})` });
          }
          resolve();
        });
      });
    })().finally(() => { setting = null; lastSetup = null; watchers.clear(); }));
  }
  async function start(id, { rate = 16000 } = {}, emit) {
    if (sessions.has(id)) end(id);
    while (sessions.size >= MAX_SESSIONS) end(sessions.keys().next().value);
    const s = { startAt: now(), firstAt: null, stopAt: null, proc: null, queue: [], said: '', timer: null };
    sessions.set(id, s);
    s.timer = setTimer(() => stop(id), MAX_MS);
    let bin;
    try {
      bin = await helper(() => sessions.get(id) === s && emit({ kind: 'building' }));
    } catch (e) {
      if (sessions.get(id) === s) { end(id); emit({ kind: 'error', reason: e.reason || 'failed', error: e.message }); }
      return;
    }
    if (sessions.get(id) !== s) return;
    const proc = s.proc = spawn(bin, ['--rate', String(rate), '--context', CONTEXT.join(',')], { stdio: ['pipe', 'pipe', 'pipe'] });
    proc.stdin.on('error', () => {});
    let pending = '', failed = null, err = '';
    proc.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    proc.stdout.on('data', (d) => {
      const lines = (pending + d).split('\n');
      pending = lines.pop();
      let partial = null;
      for (const line of lines) {
        let o;
        try { o = JSON.parse(line); } catch { continue; }
        if (o.ev === 'partial') partial = glossary(String(o.text || ''));
        else if (o.ev === 'error') failed = o;
        else if (o.ev === 'final') {
          const text = glossary(String(o.text || '').trim()), at = now();
          const afterStop = s.stopAt == null ? null : Math.round(at - s.stopAt), first = s.firstAt == null ? null : Math.round(s.firstAt - s.startAt);
          log(`speech: final ${afterStop}ms after stop, first words ${first}ms after start`);
          emit({ kind: 'final', text, afterStop, first });
          s.done = true;
        } else if (o.ev === 'installing' || o.ev === 'ready') emit({ kind: o.ev });
      }
      if (partial != null && partial !== s.said && sessions.get(id) === s) {
        if (s.firstAt == null && partial.trim()) s.firstAt = now();
        s.said = partial;
        emit({ kind: 'partial', text: partial });
      }
    });
    proc.on('error', (e) => { failed = { reason: 'spawn', error: e.message }; });
    proc.on('close', (code) => {
      if (!s.done && (failed || code)) {
        log('speech helper failed', failed?.error || err.trim() || `exit ${code}`);
        emit({ kind: 'error', reason: failed?.reason || 'failed', error: failed?.error || err.trim().split('\n').pop() || `the speech helper stopped (exit ${code})` });
      }
      if (sessions.get(id) === s) end(id);
    });
    for (const b of s.queue) proc.stdin.write(b);
    s.queue = [];
    if (s.stopEarly) proc.stdin.end();
  }
  return {
    start,
    setup,
    stop,
    cancel: end,
    audio(id, pcm) {
      const s = sessions.get(id);
      if (!s || s.stopAt != null || typeof pcm !== 'string' || pcm.length > MAX_AUDIO) return;
      const b = Buffer.from(pcm, 'base64');
      const backlog = s.proc ? s.proc.stdin.writableLength : s.queue.reduce((n, q) => n + q.length, 0);
      if (backlog + b.length > MAX_BACKLOG) return;
      if (s.proc) s.proc.stdin.write(b); else s.queue.push(b);
    },
    get active() { return sessions.size; },
  };
}

// The control-socket half: `{type:'speech', op, id}`, op setup, start (rate), audio (pcm: base64), stop or cancel. Every board gets the replies, so each
// carries the id its board chose.
export function makeSpeechHandler(opts = {}) {
  let speech = null;
  return {
    type: 'speech',
    handler(msg, host) {
      speech ??= makeSpeech({ log: (...a) => host.log(...a), ...opts });
      const id = typeof msg.id === 'string' && msg.id.length <= 64 ? msg.id : null;
      if (!id) return;
      if (msg.op === 'audio') speech.audio(id, msg.pcm);
      else if (msg.op === 'start') {
        const rate = Number.isInteger(msg.rate) && msg.rate >= 8000 && msg.rate <= 48000 ? msg.rate : 16000;
        return speech.start(id, { rate }, (e) => host.broadcast({ event: 'speech', id, ...e }));
      } else if (msg.op === 'setup') return speech.setup((e) => host.broadcast({ event: 'speech', id, ...e }));
      else if (msg.op === 'stop') speech.stop(id);
      else if (msg.op === 'cancel') speech.cancel(id);
    },
  };
}
