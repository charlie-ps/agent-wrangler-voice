import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalSpeech, joinSaid } from './voice-local.js';
import { FINAL_WAIT_MS } from './voice-speech.js';

function fakeMic() {
  const users = new Set();
  return { users, async take(fn) { users.add(fn); return 16000; }, drop(fn) { users.delete(fn); }, feed(samples) { for (const u of [...users]) u(samples, 16000); } };
}
// Vosk's model as vosk-browser gives it: each recognizer made, with what it was made with and fed.
function fakeModel() {
  const made = [];
  class KaldiRecognizer {
    constructor(rate, grammar) { Object.assign(this, { rate, grammar, fed: 0, finals: 0, removed: false, handlers: {} }); made.push(this); }
    on(ev, fn) { this.handlers[ev] = fn; }
    acceptWaveformFloat(samples) { this.fed += samples.length; }
    retrieveFinalResult() { this.finals++; }
    remove() { this.removed = true; }
    say(ev, result) { this.handlers[ev]?.({ result }); }
  }
  return { made, KaldiRecognizer };
}

test('a box’s recording is Vosk in the browser with no word list, each partial the whole text so far, and a stop waits for the last result', async () => {
  const mic = fakeMic(), model = fakeModel(), events = [];
  let clock = 0;
  const speech = createLocalSpeech({ mic, model: async () => model, now: () => clock });
  const rec = speech.record({ onEvent: (e) => events.push(e) });
  await rec.open();
  const r = model.made[0];
  assert.deepEqual([r.rate, r.grammar], [16000, undefined], 'free speech, not the labels’ grammar');
  assert.deepEqual(events.shift(), { kind: 'ready', where: 'browser' });
  mic.feed(new Float32Array(512));
  assert.equal(r.fed, 512);
  clock = 300;
  r.say('partialresult', { partial: 'add a' });
  r.say('partialresult', { partial: 'add a' });
  r.say('partialresult', { partial: 'add a retry' });
  r.say('result', { text: 'add a retry button' });
  r.say('partialresult', { partial: 'on the' });
  assert.deepEqual(events.map((e) => e.text), ['add a', 'add a retry', 'add a retry button', 'add a retry button on the'], 'an utterance Vosk ended at a pause stays, the next added after it');
  clock = 1000;
  const stopped = rec.stop();
  assert.equal(mic.users.size, 0, 'the mic is let go at once');
  assert.equal(r.finals, 1);
  r.say('partialresult', { partial: 'ignored' });
  clock = 1080;
  r.say('result', { text: 'on the page' });
  const final = await stopped;
  assert.deepEqual(final, { kind: 'final', text: 'add a retry button on the page', afterStop: 80, first: 300 });
  assert.equal(r.removed, true);
  assert.equal(speech.take({ id: 'x' }), false, 'nothing comes from the server');
  assert.equal(joinSaid([' a ', '', null, 'b']), 'a b');
});

test('a stop Vosk never answers settles on what was heard; a cancel or a stop while the model loads holds nothing', async () => {
  let fire;
  const model = fakeModel(), mic = fakeMic();
  const quiet = createLocalSpeech({ mic, model: async () => model, setTimer: (fn, ms) => { assert.equal(ms, FINAL_WAIT_MS); fire = fn; } }).record();
  await quiet.open();
  model.made[0].say('partialresult', { partial: 'hello' });
  const late = quiet.stop();
  fire();
  assert.deepEqual(await late, { kind: 'final', text: 'hello', afterStop: 0, first: 0, timedOut: true });
  let loaded;
  const slow = createLocalSpeech({ mic, model: () => new Promise((r) => { loaded = r; }) });
  const early = slow.record(), opening = early.open();
  assert.equal((await early.stop()).text, '', 'stopped before the model was there');
  loaded(model); await opening;
  assert.equal(mic.users.size, 0);
  assert.equal(model.made.length, 1, 'no recognizer made for it');
  const dropped = createLocalSpeech({ mic, model: async () => model }).record();
  await dropped.open();
  dropped.cancel();
  assert.equal(model.made.at(-1).removed, true);
  assert.equal(mic.users.size, 0);
});

test('a model that will not load is an error the box can say, not a throw', async () => {
  const events = [];
  const rec = createLocalSpeech({ mic: fakeMic(), model: async () => { throw new Error('The voice model failed its checksum'); } }).record({ onEvent: (e) => events.push(e) });
  await rec.open();
  assert.deepEqual(events, [{ kind: 'error', reason: 'no-model', error: 'The voice model failed its checksum' }]);
});
