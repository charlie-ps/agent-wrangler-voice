import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createDictation, ANSWER_MS } from './dictation.js';

function page(t, html) {
  const window = new Window();
  window.document.body.innerHTML = html;
  t.after(() => window.happyDOM.close());
  return window;
}
const tick = () => new Promise((r) => setTimeout(r));

test('start sends an id and answers with the server’s reply to it, not another board’s', async () => {
  const sent = [];
  const d = createDictation((f) => sent.push(f), { tag: 't' });
  const answer = d.start('box');
  assert.deepEqual(sent, [{ type: 'dictation', start: true, id: 't-1' }]);
  assert.equal(d.box, 'box');
  assert.equal(d.take({ event: 'dictation', id: 'other-1', ok: true }), false);
  assert.equal(d.take({ event: 'dictation', id: 't-1', ok: false, reason: 'greyed', error: 'Start Dictation stayed greyed out', ms: 2100 }), true);
  assert.deepEqual(await answer, { ok: false, reason: 'greyed', error: 'Start Dictation stayed greyed out', ms: 2100 });
  assert.equal(d.take({ event: 'dictation', id: 't-1', ok: true }), false, 'answered once');
});

test('only the box Dictation was started for stops it', () => {
  const sent = [];
  const d = createDictation((f) => sent.push(f));
  d.stop('a');
  d.start('a');
  d.stop('b');
  assert.equal(sent.length, 1);
  d.stop('a');
  assert.deepEqual(sent.at(-1), { type: 'dictation', start: false });
  assert.equal(d.box, null);
});

test('a start the server never answers gives up as no-answer', async () => {
  const timers = [];
  const d = createDictation(() => {}, { setTimer: (f, ms) => timers.push([f, ms]) });
  const answer = d.start('a');
  assert.equal(timers[0][1], ANSWER_MS);
  timers[0][0]();
  assert.equal((await answer).reason, 'no-answer');
});

test('attached boxes: focus starts, a move straight to another sends only its start, leaving stops', async (t) => {
  const { document } = page(t, '<textarea id="a"></textarea><textarea id="b"></textarea><button>x</button>');
  const sent = [], heard = [];
  const d = createDictation((f) => sent.push(f), { tag: 't' });
  const [a, b] = ['#a', '#b'].map((s) => document.querySelector(s));
  d.attach(a, (r) => heard.push(['a', r.ok]));
  const detach = d.attach(b, (r) => heard.push(['b', r.ok]));
  a.focus();
  b.focus();
  await tick();
  assert.deepEqual(sent.map((f) => f.start), [true, true], 'no stop between a and b');
  d.take({ id: 't-2', ok: true });
  await tick();
  assert.deepEqual(heard, [['b', true]]);
  document.querySelector('button').focus();
  await tick();
  assert.deepEqual(sent.at(-1), { type: 'dictation', start: false });
  detach();
  b.focus();
  assert.equal(sent.length, 3, 'a detached box starts nothing');
});
