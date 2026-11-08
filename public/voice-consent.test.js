import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { prepareModel, createModelAsk, modelHost, modelSize, DECLINED } from './voice-consent.js';
import { createVoice, loadModel } from './job-voice.js';
import { VOICE_MODEL } from './voice-model.js';

const flow = ({ present = false, yes = false } = {}) => {
  const steps = [];
  return { steps, prepare: () => prepareModel({ check: async () => { steps.push('check'); return present; }, ask: async () => { steps.push('ask'); return yes; }, download: async () => { steps.push('download'); } }) };
};

test('a model already there starts Voice with no prompt, and none there asks first: only Download fetches', async () => {
  const there = flow({ present: true });
  await there.prepare();
  assert.deepEqual(there.steps, ['check']);
  const yes = flow({ yes: true });
  await yes.prepare();
  assert.deepEqual(yes.steps, ['check', 'ask', 'download']);
  const no = flow();
  await assert.rejects(no.prepare(), (err) => err.declined === true && err.message === DECLINED);
  assert.deepEqual(no.steps, ['check', 'ask'], 'Cancel fetches nothing');
});

test('Cancel leaves Voice not listening: declined, the mic never taken and the recognizer never imported', async () => {
  const { prepare, steps } = flow();
  const states = [];
  let took = 0;
  const mic = { waiting: false, async take() { took++; return 16000; }, drop() {}, set onWaiting(_) {} };
  const win = { performance, navigator: { mediaDevices: { getUserMedia() {} } }, AudioWorkletNode: class {} };
  const vosk = async () => { steps.push('import'); return {}; };
  const v = createVoice({ win, mic, prepare, load: (url, p) => loadModel(url, p, { verify: async () => steps.push('verify'), vosk }), onWord() {}, onState: (s) => states.push(s) });
  await v.start();
  assert.deepEqual(states, ['loading', 'off', 'declined']);
  assert.equal(v.on, false);
  assert.equal(took, 0);
  assert.deepEqual(steps, ['check', 'ask']);
});

test('the warning names the size, the host and the pin, and only Download says yes: Cancel, Esc and close say no', async (t) => {
  assert.equal(modelHost(), new URL(VOICE_MODEL.from).host);
  assert.equal(modelSize(), '41 MB');
  const window = new Window();
  t.after(() => window.happyDOM.close());
  const doc = window.document;
  const ask = createModelAsk({ doc });
  const asked = ask.open();
  assert.equal(ask.open(), asked, 'one warning at a time');
  const dialog = doc.querySelector('dialog.job-voice-ask');
  assert.equal(dialog.open, true);
  const text = dialog.textContent;
  for (const bit of ['41 MB', modelHost(), 'SHA-256', 'pinned', VOICE_MODEL.from]) assert.ok(text.includes(bit), bit);
  assert.equal(doc.activeElement?.dataset.voiceAsk, 'cancel', 'Enter on the warning is a Cancel');
  dialog.querySelector('[data-voice-ask="download"]').click();
  assert.equal(await asked, true);
  assert.equal(dialog.open, false);
  assert.equal(ask.asking, false);
  const cancelled = ask.open();
  assert.equal(ask.asking, true);
  doc.querySelector('[data-voice-ask="cancel"]').click();
  assert.equal(await cancelled, false);
  const escaped = ask.open();
  dialog.close();
  assert.equal(await escaped, false);
  const dropped = ask.open();
  ask.close();
  assert.equal(await dropped, false, 'Voice switched off meanwhile');
});
