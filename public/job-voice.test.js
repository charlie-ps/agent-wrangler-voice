import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHearing, createVoice, MIN_CONF, QUIET_MS, MODEL_URL, modelFrom, verified, loadModel } from './job-voice.js';
import { VOICE_MODEL, VOSK_BROWSER } from './voice-model.js';
import { createHash } from 'node:crypto';
import { WORDS, BUTTON_WORDS, COMMANDS } from './job-keys.js';
import { LABEL_MODES, migrateLabels, labelsOf, swapLabels } from './label-modes.js';

const hearing = (words = ['lamp', 'pond']) => {
  const got = [], asks = [];
  const h = createHearing({ onWord: (w) => got.push(w), settle: () => asks.push(asks.length) });
  h.setWords(words);
  return { h, got, asks };
};
const final = (...words) => ({ text: words.map(([w]) => w).join(' '), result: words.map(([word, conf]) => ({ word, conf, start: 0, end: 0.3 })) });

test('a partial that is exactly one shown word is settled once the mic has gone quiet after it, and only a confident final presses', () => {
  const { h, got, asks } = hearing();
  h.quiet(0); h.partial('lamp');
  assert.equal(asks.length, 0, 'still sounding: it could be the start of a sentence');
  h.quiet(QUIET_MS - 1);
  assert.equal(asks.length, 0);
  h.quiet(QUIET_MS);
  assert.equal(asks.length, 1, 'the word ended: end the utterance now');
  h.quiet(QUIET_MS * 2); h.partial('lamp');
  assert.equal(asks.length, 1, 'asked once');
  assert.deepEqual(got, [], 'a partial alone presses nothing');
  h.final(final(['lamp', 0.98]));
  assert.deepEqual(got, ['lamp']);
  h.quiet(QUIET_MS); h.partial('pond');
  assert.equal(asks.length, 2, 'the next utterance settles again, a partial arriving after the quiet at once');
  h.final(final(['pond', MIN_CONF - 0.01]));
  assert.deepEqual(got, ['lamp'], 'unsure: a word not drawn the grammar had to call something');
});

test('a sentence is never settled: a shown word inside [unk]s, two shown words, or a word turning into speech', () => {
  const { h, asks } = hearing();
  for (const text of ['[unk]', '[unk] lamp', 'lamp [unk]', 'lamp pond', '[unk] pond [unk]', '']) { h.quiet(0); h.partial(text); h.quiet(QUIET_MS * 5); }
  assert.equal(asks.length, 0);
  h.quiet(0); h.partial('pond'); h.partial('pond [unk]'); h.quiet(QUIET_MS * 5);
  assert.equal(asks.length, 0, 'what grew past the word is no longer it');
});

test('a final result presses only exactly one shown word at MIN_CONF', () => {
  const { h, got } = hearing();
  h.final(final(['pond', MIN_CONF]));
  assert.deepEqual(got, ['pond']);
  h.final(final(['pond', MIN_CONF - 0.01]));
  h.final(final(['[unk]', 1]));
  h.final(final(['lamp', 1], ['pond', 1]));
  h.final(final(['[unk]', 1], ['pond', 1]));
  h.final({ text: '', result: [] });
  h.final({ text: 'pond' });
  assert.deepEqual(got, ['pond'], 'unsure, unknown, two words or none: nothing');
});

test('a word no longer drawn is never pressed, and a new set of words starts a fresh utterance', () => {
  const { h, got, asks } = hearing();
  h.partial('lamp');
  h.setWords(['pond']);
  h.quiet(QUIET_MS); h.partial('lamp'); h.final(final(['lamp', 1]));
  assert.deepEqual([got, asks.length], [[], 0]);
  h.quiet(0); h.partial('pond'); h.quiet(QUIET_MS); h.final(final(['pond', 1]));
  assert.deepEqual([got, asks.length], [['pond'], 1]);
});

test('without a microphone Voice fails at once, loading no model', async () => {
  const states = [];
  const v = createVoice({ win: { navigator: {}, performance }, onWord() {}, onState: (...s) => states.push(s) });
  await v.start();
  assert.equal(v.on, false);
  assert.deepEqual(states.map(([s]) => s), ['loading', 'off', 'failed']);
  assert.equal(globalThis.Vosk, undefined, 'the recognizer was never loaded');
});

// Everything past the microphone stood in: the shared mic (voice-mic.js) hands blocks to its
// holders, and the model's recognizer records its grammar and answers as the worker would.
function fakeVoice(t, { setup, page } = {}) {
  const recs = [], got = [], states = [], holders = new Set();
  let clock = 0, takes = 0;
  class Rec {
    constructor(rate, grammar) { this.rate = rate; this.grammar = grammar === undefined ? null : JSON.parse(grammar); this.on_ = {}; this.removed = false; this.asked = 0; this.fed = 0; recs.push(this); }
    setWords() {}
    on(ev, fn) { this.on_[ev] = fn; }
    acceptWaveformFloat() { this.fed++; }
    retrieveFinalResult() { this.asked++; }
    remove() { this.removed = true; }
  }
  const mic = { waiting: false, async take(fn) { takes++; holders.add(fn); return 16000; }, drop(fn) { holders.delete(fn); }, set onWaiting(_) {} };
  const win = { performance: { now: () => clock }, navigator: { mediaDevices: { getUserMedia() {} } }, AudioWorkletNode: class {}, ...page?.win };
  const v = createVoice({ win, mic, setup, load: async () => ({ KaldiRecognizer: Rec }), onWord: (w, info) => got.push([w, info.ms]), onState: (s) => states.push(s) });
  t.after(() => v.stop());
  const block = (level, ms = 32) => { clock += ms; for (const fn of [...holders]) fn(new Float32Array(512).fill(level), 16000); };
  return { v, recs, got, states, block, holders, takes: () => takes };
}

// A page whose window focus and visibility the test sets, firing the events a browser would.
function fakePage() {
  const on = { win: {}, doc: {} };
  const listen = (where) => ({ addEventListener: (ev, fn) => { (on[where][ev] ??= new Set()).add(fn); }, removeEventListener: (ev, fn) => on[where][ev]?.delete(fn) });
  const page = { focused: true, visibilityState: 'visible' };
  const document = { ...listen('doc'), hasFocus: () => page.focused, get visibilityState() { return page.visibilityState; } };
  const fire = (where, ev) => { for (const fn of on[where][ev] || []) fn(); };
  return {
    win: { ...listen('win'), document },
    blur() { page.focused = false; fire('win', 'blur'); },
    focus() { page.focused = true; fire('win', 'focus'); },
    hide() { page.visibilityState = 'hidden'; fire('doc', 'visibilitychange'); },
    show() { page.visibilityState = 'visible'; fire('doc', 'visibilitychange'); },
    listeners: () => Object.values(on).reduce((n, evs) => n + Object.values(evs).reduce((m, set) => m + set.size, 0), 0),
  };
}
const sayIt = (f, word, rec = f.recs.at(-1)) => {
  f.block(0.2); f.block(0.2);
  rec.on_.partialresult({ result: { partial: word } });
  f.block(0); f.block(0); f.block(0); f.block(0);
  rec.on_.result({ result: { text: word, result: [{ word, conf: 1 }] } });
};

test('words press only while the page is visible and its window focused; away, the mic stays held and nothing half heard presses after', async (t) => {
  const page = fakePage();
  const f = fakeVoice(t, { page });
  f.v.setWords(['pond']);
  await f.v.start();
  sayIt(f, 'pond');
  assert.deepEqual(f.got.map(([w]) => w), ['pond']);
  const first = f.recs[0], asked = first.asked;
  f.block(0.2); f.block(0.2);
  first.on_.partialresult({ result: { partial: 'pond' } });
  page.blur();
  assert.deepEqual([f.states.at(-1), first.removed, f.holders.size, f.takes()], ['paused', true, 1, 1], 'the recognizer goes, the mic stays');
  first.on_.result({ result: { text: 'pond', result: [{ word: 'pond', conf: 1 }] } });
  f.block(0.2); f.block(0); f.block(0); f.block(0); f.block(0);
  assert.equal(first.asked, asked, 'what was half heard is never settled');
  assert.equal(f.recs.length, 1, 'no recognizer hears while away');
  page.focus();
  assert.deepEqual([f.states.at(-1), f.recs.length, f.takes()], ['listening', 2, 1], 'back at once, with a fresh recognizer and no new mic');
  first.on_.result({ result: { text: 'pond', result: [{ word: 'pond', conf: 1 }] } });
  assert.equal(f.got.length, 1, 'the old utterance presses nothing once focus is back');
  sayIt(f, 'pond');
  assert.deepEqual(f.got.map(([w]) => w), ['pond', 'pond'], 'and the word presses again, with no click');
  page.hide();
  assert.equal(f.states.at(-1), 'paused', 'a hidden page is away too');
  page.show();
  assert.equal(f.states.at(-1), 'listening');
});

test('a scroll command is dropped while away, as a drawn word is', async (t) => {
  const page = fakePage();
  const f = fakeVoice(t, { page });
  f.v.setWords([]);
  await f.v.start();
  const rec = f.recs[0];
  f.block(0.2); f.block(0.2);
  rec.on_.partialresult({ result: { partial: 'down' } });
  f.block(0); f.block(0); f.block(0); f.block(0);
  assert.equal(rec.asked, 1);
  page.blur();
  rec.on_.result({ result: { text: 'down', result: [{ word: 'down', conf: 1 }] } });
  assert.deepEqual(f.got, [], 'settled just before the window lost focus, its final lands after: nothing scrolls');
});

test('a press is dropped when focus went without an event saying so, and Voice started away waits paused', async (t) => {
  const page = fakePage();
  const f = fakeVoice(t, { page });
  f.v.setWords(['pond']);
  await f.v.start();
  const rec = f.recs[0];
  f.block(0.2); f.block(0.2);
  rec.on_.partialresult({ result: { partial: 'pond' } });
  f.block(0); f.block(0); f.block(0); f.block(0);
  page.blur = undefined;
  Object.assign(page.win.document, { hasFocus: () => false });
  rec.on_.result({ result: { text: 'pond', result: [{ word: 'pond', conf: 1 }] } });
  assert.deepEqual([f.got, f.states.at(-1), rec.removed], [[], 'paused', true], 'asked at the press itself');
  const away = fakePage();
  away.blur();
  const g = fakeVoice(t, { page: away });
  await g.v.start();
  assert.deepEqual([g.states, g.recs.length, g.holders.size], [['loading', 'paused'], 0, 1], 'the mic open, ready for the window to come back');
  away.focus();
  assert.deepEqual([g.states.at(-1), g.recs.length], ['listening', 1]);
});

test('a text box and Voice off each leave focus alone: the box keeps the mic away or not, and off stops watching', async (t) => {
  const page = fakePage();
  const f = fakeVoice(t, { page });
  await f.v.start();
  await f.v.dictate(true);
  page.blur(); page.focus();
  assert.deepEqual([f.states.at(-1), f.holders.size, f.recs.length], ['dictating', 0, 1], 'the box’s recording is its own (voice-box.js)');
  page.blur();
  await f.v.dictate(false);
  assert.deepEqual([f.states.at(-1), f.recs.length], ['paused', 1], 'leaving the box while away takes the mic back, paused');
  page.focus();
  assert.equal(f.recs.length, 2);
  f.v.stop();
  assert.equal(page.listeners(), 0);
  page.blur();
  assert.equal(f.states.at(-1), 'off');
});

test('Voice listens with one grammar, the whole word list plus [unk], and presses only a word drawn, timed from the first loud block', async (t) => {
  const f = fakeVoice(t);
  f.v.setWords(['pond', 'ship']);
  await f.v.start();
  assert.deepEqual(f.states, ['loading', 'listening']);
  assert.equal(f.recs.length, 1);
  assert.deepEqual(f.recs[0].grammar, [...WORDS, ...BUTTON_WORDS, ...COMMANDS, '[unk]'], 'the words not drawn are decoys');
  assert.equal(f.recs[0].rate, 16000, 'the model’s own rate');
  f.v.setWords(['pond', 'lamp']);
  assert.equal(f.recs.length, 1, 'new badges rebuild nothing');
  const rec = f.recs[0];
  f.block(0.2); f.block(0.2); f.block(0.2);
  rec.on_.partialresult({ result: { partial: 'gold' } });
  f.block(0); f.block(0); f.block(0); f.block(0);
  assert.equal(rec.asked, 0, 'a word not drawn is never settled');
  rec.on_.result({ result: { text: 'gold', result: [{ word: 'gold', conf: 1 }] } });
  assert.deepEqual(f.got, []);
  f.block(0.2); f.block(0.2); f.block(0.2);
  rec.on_.partialresult({ result: { partial: 'pond' } });
  f.block(0); f.block(0);
  assert.equal(rec.asked, 0, 'not yet quiet long enough');
  f.block(0); f.block(0);
  assert.equal(rec.asked, 1, 'quiet after a lone drawn word: settled at once');
  rec.on_.result({ result: { text: 'pond', result: [{ word: 'pond', conf: 1 }] } });
  assert.deepEqual(f.got, [['pond', 6 * 32]], 'from its first loud block to the press');
  f.v.stop();
  assert.equal(rec.removed, true);
  assert.equal(f.states.at(-1), 'off');
});

test('a focused text box lets the mic go for its recording, and leaving it takes the mic back with a fresh recognizer', async (t) => {
  const f = fakeVoice(t);
  f.v.setWords(['pond']);
  await f.v.start();
  const first = f.recs[0];
  await f.v.dictate(true);
  assert.deepEqual([f.v.dictating, f.states.at(-1), f.holders.size, first.removed], [true, 'dictating', 0, true], 'the labels let go of the shared mic, for the box');
  first.on_.result({ result: { text: 'pond', result: [{ word: 'pond', conf: 1 }] } });
  assert.deepEqual(f.got, [], 'and nothing half heard before presses');
  await f.v.dictate(false);
  assert.deepEqual([f.states.at(-1), f.takes(), f.holders.size, f.recs.length], ['listening', 2, 1, 2]);
  assert.deepEqual(f.recs[1].grammar, [...WORDS, ...BUTTON_WORDS, ...COMMANDS, '[unk]']);
  f.block(0.2); f.block(0.2);
  f.recs[1].on_.partialresult({ result: { partial: 'pond' } });
  f.block(0); f.block(0); f.block(0); f.block(0);
  f.recs[1].on_.result({ result: { text: 'pond', result: [{ word: 'pond', conf: 1 }] } });
  assert.equal(f.got.at(-1)[0], 'pond', 'the words press again');
  await f.v.dictate(false);
  assert.equal(f.takes(), 2, 'the same mode again changes nothing');
});

test('a text box focused before Voice starts keeps the mic free until it is left', async (t) => {
  const f = fakeVoice(t);
  await f.v.dictate(true);
  await f.v.start();
  assert.deepEqual([f.takes(), f.states.at(-1)], [0, 'dictating']);
  await f.v.dictate(false);
  assert.deepEqual([f.takes(), f.states.at(-1)], [1, 'listening']);
});

test('Voice stays loading, the mic shut, until the rest of its setup is done, and a setup that fails still listens', async (t) => {
  let finish;
  const f = fakeVoice(t, { setup: () => new Promise((r) => { finish = r; }) });
  const started = f.v.start();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([f.states, f.takes()], [['loading'], 0], 'the model is in, the setup is not');
  finish(); await started;
  assert.deepEqual([f.states.at(-1), f.takes()], ['listening', 1]);
  const g = fakeVoice(t, { setup: async () => { throw new Error('no helper'); } });
  await g.v.start();
  assert.equal(g.states.at(-1), 'listening');
});

test('the scroll commands are heard whatever badges are drawn', async (t) => {
  const f = fakeVoice(t);
  f.v.setWords([]);
  await f.v.start();
  const rec = f.recs[0];
  for (const word of COMMANDS) {
    f.block(0.2); f.block(0.2);
    rec.on_.partialresult({ result: { partial: word } });
    f.block(0); f.block(0); f.block(0); f.block(0);
    rec.on_.result({ result: { text: word, result: [{ word, conf: 1 }] } });
  }
  assert.deepEqual(f.got.map(([w]) => w), COMMANDS);
});

test('a model that fails to download fails Voice, freeing its worker, where vosk-browser alone would wait for good', async () => {
  const made = [];
  class Model { constructor(url) { this.url = url; this.ev = {}; this.terminated = false; made.push(this); } on(e, fn) { this.ev[e] = fn; } terminate() { this.terminated = true; } }
  const failing = modelFrom(Model, 'https://example.com/m.tar.gz');
  made[0].ev.error({ error: 'network error' });
  await assert.rejects(failing, /did not load: network error/);
  assert.equal(made[0].terminated, true);
  const refused = modelFrom(Model, 'u');
  made[1].ev.load({ result: false });
  await assert.rejects(refused, /did not load/);
  const fine = modelFrom(Model, 'u');
  made[2].ev.load({ result: true });
  assert.equal(await fine, made[2]);
  made[2].ev.error({ error: 'a recognizer later' });
  assert.equal(made[2].terminated, false, 'an error once loaded is not a failed load');
});

test('Voice never touches the browser’s Web Speech API, and the browser fetches nothing but the model from the board itself', () => {
  for (const f of ['job-voice.js', 'voice-worklet.js', 'voice-mic.js', 'voice-speech.js', 'voice-box.js', 'dictation.js', 'job-keys.js', 'board-voice.js', 'voice-open.js', 'voice-consent.js', 'voice-setup.js', 'voice-settings.js']) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /SpeechRecognition|speechSynthesis/, f);
  }
  for (const f of ['job-voice.js', 'voice-worklet.js', 'voice-mic.js', 'voice-speech.js', 'voice-box.js', 'board-voice.js']) assert.doesNotMatch(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'), /https?:\/\//, `${f} names no remote host`);
  assert.equal(MODEL_URL, new URL(`./voice-model/${VOICE_MODEL.file}`, import.meta.url).href, 'the board’s own public/');
  assert.doesNotMatch(readFileSync(new URL('./job-voice.js', import.meta.url), 'utf8'), /^import .*vendor/m, 'the recognizer is imported only once Voice is on');
});

test('the vendored recognizer is byte for byte npm’s vosk-browser 0.0.8, as pinned', () => {
  const [header, ...body] = readFileSync(new URL('./vendor/vosk-browser.js', import.meta.url), 'utf8').split('\n');
  assert.match(header, new RegExp(`^// vosk-browser ${VOSK_BROWSER.version.replaceAll('.', '\\.')} \\(Apache-2\\.0`));
  assert.equal(createHash('sha256').update(body.join('\n')).digest('hex'), VOSK_BROWSER.sha256);
});

test('the model is hashed in the browser before Vosk sees it, and a mismatch refuses to start', async () => {
  const bytes = new TextEncoder().encode('model bytes');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const fetchImpl = async (url) => ({ ok: url === 'ok', status: url === 'ok' ? 200 : 404, arrayBuffer: async () => bytes.buffer.slice(0) });
  assert.equal(await verified('ok', { sha256, fetchImpl }), 'ok');
  await assert.rejects(verified('ok', { sha256: '0'.repeat(64), fetchImpl }), /failed its checksum/);
  await assert.rejects(verified('gone', { sha256, fetchImpl }), /not there \(HTTP 404\)/);
});

test('loading asks the server for the model, checks it, and only then imports the recognizer; any failure loads nothing and lets the next start retry', async () => {
  const steps = [];
  class Model { constructor() { this.ev = {}; } on(e, fn) { this.ev[e] = fn; if (e === 'load') queueMicrotask(() => fn({ result: true })); } terminate() {} }
  const vosk = async () => { steps.push('import'); return { Model }; };
  await assert.rejects(loadModel('u', async () => { steps.push('prepare'); throw new Error('offline'); }, { verify: async () => steps.push('verify'), vosk }), /offline/);
  await assert.rejects(loadModel('u', async () => steps.push('prepare'), { verify: async () => { steps.push('verify'); throw new Error('bad sum'); }, vosk }), /bad sum/);
  assert.deepEqual(steps, ['prepare', 'prepare', 'verify'], 'nothing imported');
  const model = await loadModel('u', async () => steps.push('prepare'), { verify: async () => steps.push('verify'), vosk });
  assert.ok(model instanceof Model);
  assert.deepEqual(steps.slice(3), ['prepare', 'verify', 'import']);
});

test('Labels is Off, Keyboard or Voice, Keyboard labels on reads as Keyboard, and ⌃⌘V swaps Keyboard and Voice', () => {
  assert.deepEqual(LABEL_MODES, ['off', 'keyboard', 'voice']);
  assert.equal(labelsOf({ keyLabels: true }), 'keyboard');
  assert.equal(labelsOf({ keyLabels: false }), 'off');
  assert.equal(labelsOf({}), 'off');
  assert.equal(labelsOf(undefined), 'off');
  assert.equal(labelsOf({ labels: 'voice', keyLabels: true }), 'voice', 'an explicit pick wins');
  assert.equal(labelsOf({ labels: 'loud' }), 'off');
  assert.deepEqual(migrateLabels({ keyLabels: true, theme: 'space' }), { labels: 'keyboard', theme: 'space' });
  assert.deepEqual(migrateLabels({ labels: 'voice' }), { labels: 'voice' });
  assert.deepEqual([swapLabels('keyboard'), swapLabels('voice'), swapLabels('off')], ['voice', 'keyboard', 'voice']);
});
