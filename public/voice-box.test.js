import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createSpeech, toPcm16, base64Of, FINAL_WAIT_MS } from './voice-speech.js';
import { createVoiceBox, spliceAt, anchorOf, exitTyped, escapeAt, wordsOf, escapeWordOf, editKey, sameBox, DEFAULT_ESCAPE_WORD, EDITED_NOTE } from './voice-box.js';

function fakeMic() {
  const users = new Set();
  return { users, waiting: false, async take(fn) { users.add(fn); return 16000; }, drop(fn) { users.delete(fn); }, holds: (fn) => users.has(fn), set onWaiting(_) {}, feed(samples) { for (const u of [...users]) u(samples, 16000); } };
}

test('the microphone goes to the server as 16-bit PCM in ~100ms frames, and a stop waits for the final words', async () => {
  assert.deepEqual([...toPcm16(new Float32Array([0, 1, -1, 2]))], [0, 32767, -32768, 32767]);
  assert.equal(base64Of(new Int16Array([1, 2])), Buffer.from(new Int16Array([1, 2]).buffer).toString('base64'));
  const mic = fakeMic(), sent = [];
  const speech = createSpeech({ send: (m) => sent.push(m), mic, tag: 't' });
  const events = [];
  const rec = speech.record({ onEvent: (e) => events.push(e.kind) });
  await rec.open();
  assert.deepEqual(sent[0], { type: 'speech', op: 'start', id: 't-1', rate: 16000 });
  for (let i = 0; i < 3; i++) mic.feed(new Float32Array(512));
  assert.equal(sent.length, 1, '96ms buffered');
  mic.feed(new Float32Array(512));
  assert.equal(sent[1].op, 'audio');
  assert.equal(Buffer.from(sent[1].pcm, 'base64').length, 2048 * 2);
  speech.take({ event: 'speech', id: 't-1', kind: 'partial', text: 'hello' });
  assert.equal(speech.take({ event: 'speech', id: 'other', kind: 'partial', text: 'x' }), false, 'another board’s recording');
  mic.feed(new Float32Array(100));
  const stopped = rec.stop();
  assert.deepEqual(sent.slice(-2).map((m) => m.op), ['audio', 'stop'], 'what was left is sent before the stop');
  assert.equal(mic.users.size, 0, 'the mic is let go at once');
  speech.take({ event: 'speech', id: 't-1', kind: 'final', text: 'hello there', afterStop: 90 });
  assert.deepEqual(await stopped, { event: 'speech', id: 't-1', kind: 'final', text: 'hello there', afterStop: 90 });
  assert.deepEqual(events, ['partial', 'final']);
  let fire;
  const quiet = createSpeech({ send: () => {}, mic: fakeMic(), setTimer: (fn, ms) => { assert.equal(ms, FINAL_WAIT_MS); fire = fn; } }).record();
  await quiet.open();
  const late = quiet.stop();
  fire();
  assert.equal((await late).timedOut, true, 'a server that never answers settles');
  let opened;
  const slowMic = { ...fakeMic(), take(fn) { slowMic.held = fn; return new Promise((r) => { opened = r; }); }, drop(fn) { if (slowMic.held === fn) slowMic.held = null; } };
  const early = [], dropped = createSpeech({ send: (m) => early.push(m.op), mic: slowMic }).record();
  const opening = dropped.open();
  dropped.cancel();
  opened(16000); await opening;
  assert.equal(slowMic.held, null, 'cancelled while the mic opened: it holds nothing');
  assert.deepEqual(early, ['cancel'], 'and starts nothing');
});

test('spoken words go in at the cursor with a space either side where needed, and the escape word leaves wherever it stands as words of its own', () => {
  assert.deepEqual(spliceAt({ before: 'Fix the', after: 'button.' }, 'retry'), { value: 'Fix the retry button.', caret: 13 });
  assert.deepEqual(spliceAt({ before: 'Fix the ', after: '.' }, 'retry button'), { value: 'Fix the retry button.', caret: 20 });
  assert.deepEqual(spliceAt({ before: '', after: '' }, ' Hello. '), { value: 'Hello.', caret: 6 });
  assert.deepEqual(spliceAt({ before: 'a', after: 'b' }, ''), { value: 'ab', caret: 1 });
  assert.deepEqual(spliceAt({ before: 'Please ', after: 'on the page.' }, 'Add a retry button.'), { value: 'Please add a retry button on the page.', caret: 25 }, 'mid-sentence');
  assert.equal(spliceAt({ before: 'Done. ', after: '' }, 'Add a PR check.').value, 'Done. Add a PR check.', 'a new sentence keeps its capital');
  assert.equal(spliceAt({ before: 'ask ', after: '' }, 'PR reviewers').value, 'ask PR reviewers', 'an acronym keeps its capitals');
  assert.equal(spliceAt({ before: 'and ', after: '' }, 'I think so').value, 'and I think so');
  assert.equal(DEFAULT_ESCAPE_WORD, 'lamp');
  for (const s of [{}, { escapeWord: '' }, { escapeWord: '   ' }, undefined]) assert.equal(escapeWordOf(s), 'lamp');
  assert.equal(escapeWordOf({ escapeWord: ' done ' }), 'done');
  assert.equal(exitTyped('Fix the retry limit. Lamp.'), 'Fix the retry limit.');
  assert.equal(exitTyped('lamp'), '');
  assert.equal(exitTyped('Fix the retry limit, lamp.'), 'Fix the retry limit', 'with the comma the transcriber put before it');
  assert.equal(exitTyped('Add a note LAMP!'), 'Add a note');
  for (const s of ['a lampshade', 'flamp', 'lamps', '']) assert.equal(exitTyped(s), null, s);
  assert.deepEqual(escapeAt('Watch this: lamp start'), { kept: 'Watch this:', rest: 'start' }, 'a coalesced partial already holds the next word');
  assert.deepEqual(escapeAt('Retry, Lamp. Start next.'), { kept: 'Retry', rest: 'Start next.' });
  assert.deepEqual(escapeAt('lamp and then more'), { kept: '', rest: 'and then more' });
  assert.deepEqual(escapeAt('Turn the lamp on, lamp'), { kept: 'Turn the', rest: 'on, lamp' }, 'the first one counts: pick a word your prose never says');
  assert.deepEqual(escapeAt('Turn the lamp on, lamp', undefined, { atEnd: true }), { kept: 'Turn the lamp on', rest: '' }, 'only the last, with nothing after');
  assert.equal(escapeAt('Turn the lamp on', undefined, { atEnd: true }), null);
  assert.deepEqual(wordsOf('Start, next. Don’t'), ['start', 'next', 'don', 't']);
  assert.deepEqual(wordsOf(" Bottom! won't "), ['bottom', "won't"]);
  assert.equal(exitTyped('Fix the retry limit. Escape, escape.', 'escape escape'), 'Fix the retry limit.', 'a phrase of several words, punctuated between');
  assert.equal(exitTyped('Fix it lamp', '  '), 'Fix it', 'a blank word is the default');
  assert.equal(exitTyped('Fix it. Done?', 'done'), 'Fix it.');
  assert.equal(exitTyped('Ship it a+b', 'a+b'), 'Ship it', 'the word is taken literally');
  for (const s of ['Ship it aab', 'Ship it a+b.c']) assert.equal(exitTyped(s, 'a+b'), null, s);
  assert.equal(exitTyped('Ship it a.b', 'a.b'), 'Ship it');
  assert.equal(exitTyped('Ship it axb', 'a.b'), null);
});

function boxes(t, opts = {}) {
  const window = new Window({ url: 'http://localhost:7878' });
  const document = window.document;
  t.after(() => window.happyDOM.close());
  document.body.innerHTML = '<textarea aria-label="Add idea">Fix the button</textarea><textarea aria-label="Reply"></textarea>';
  const recs = [], dict = [], logs = [], exits = [], said = [];
  const speech = { record: (opts) => { const r = { opts, cancelled: 0, async open() {}, stop: () => new Promise((resolve) => { r.finish = resolve; }), cancel() { r.cancelled++; } }; recs.push(r); return r; } };
  const dictation = { start: async (el) => { dict.push(['start', el.getAttribute('aria-label')]); return { ok: true }; }, stop: (el) => dict.push(['stop', el.getAttribute('aria-label')]) };
  let clock = 0, timerId = 0;
  const timers = new Map();
  const v = createVoiceBox({ doc: document, speech, dictation, log: (m) => logs.push(m), onExit: (el, words) => { exits.push(el.getAttribute('aria-label')); said.push(['exit', ...words]); el.blur(); }, onAfter: (words) => said.push(['after', ...words]), now: () => clock, setTimer: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimer: (id) => timers.delete(id), ...opts });
  return { window, document, v, recs, dict, logs, exits, said, timers, tick: (ms) => { clock += ms; }, box: (l) => document.querySelector(`textarea[aria-label="${l}"]`) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const ev = (f, type, name, init) => new f.window[type](name, { bubbles: true, cancelable: true, ...init });

test('a focused box records at the cursor, partial words replaced as they firm up, and Enter sends once the final words are in, then listens again', async (t) => {
  const f = boxes(t);
  const el = f.box('Add idea');
  el.focus(); el.setSelectionRange(7, 7);
  f.v.start(el);
  await flush();
  assert.equal(f.recs.length, 1);
  assert.equal(f.v.active.state, 'starting');
  f.recs[0].opts.onEvent({ kind: 'ready' });
  assert.equal(f.v.active.state, 'listening');
  assert.match(f.document.querySelector('.voice-hud').textContent, /Listening on this Mac/);
  f.tick(1000);
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'retry' });
  assert.equal(el.value, 'Fix the retry button');
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'retry limit' });
  assert.equal(el.value, 'Fix the retry limit button');
  let sent = 0;
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.metaKey) { sent++; e.preventDefault(); } });
  el.dispatchEvent(ev(f, 'KeyboardEvent', 'keydown', { key: 'Enter', metaKey: true }));
  assert.equal(sent, 0, 'not sent before the final words');
  f.tick(90);
  f.recs[0].finish({ kind: 'final', text: 'retry limits', afterStop: 80 });
  await flush(); await flush();
  assert.equal(el.value, 'Fix the retry limits button');
  assert.equal(sent, 1, 'then the box’s own ⌘↵ sends it');
  assert.match(f.logs.at(-1), /^final text 90ms after stop \(helper: 80ms\), first words 1\.0 s after start/);
  assert.deepEqual(f.v.last, { first: 1000, afterStop: 90 });
  assert.equal(f.recs.length, 2, 'the box still has focus, so it listens again');
});

test('an Enter that sends the box’s words leaves the box and records no more; one that sends nothing listens again', async (t) => {
  const f = boxes(t);
  const el = f.box('Reply');
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.value = ''; } });
  el.focus();
  f.v.start(el);
  await flush();
  el.dispatchEvent(ev(f, 'KeyboardEvent', 'keydown', { key: 'Enter' }));
  f.recs[0].finish({ kind: 'final', text: '' });
  await flush(); await flush();
  assert.equal(f.document.activeElement, el, 'an empty box sent nothing: it keeps focus');
  assert.equal(f.recs.length, 2, 'and listens again');
  f.recs[1].opts.onEvent({ kind: 'partial', text: 'Ship it' });
  el.dispatchEvent(ev(f, 'KeyboardEvent', 'keydown', { key: 'Enter' }));
  f.recs[1].finish({ kind: 'final', text: 'Ship it.' });
  await flush(); await flush();
  assert.notEqual(f.document.activeElement, el, 'the sent box is left');
  assert.equal(f.recs.length, 2, 'with no recording started there');
  assert.equal(f.v.active, null);
});

test('a plain Enter nothing took is a newline, put in once the final words are', async (t) => {
  const f = boxes(t);
  const el = f.box('Reply');
  el.focus();
  f.v.start(el);
  await flush();
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'First line' });
  el.dispatchEvent(ev(f, 'KeyboardEvent', 'keydown', { key: 'Enter' }));
  f.recs[0].finish({ kind: 'final', text: 'First line.' });
  await flush(); await flush();
  assert.equal(el.value, 'First line.\n');
});

test('\'lamp\' said alone at the end still leaves the box as before', async (t) => {
  const f = boxes(t);
  const el = f.box('Reply');
  el.focus();
  f.v.start(el);
  await flush();
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'Is the lampshade on' });
  assert.equal(el.value, 'Is the lampshade on', 'inside a word it is prose');
  assert.deepEqual(f.exits, []);
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'What needs me lamp' });
  assert.equal(el.value, 'What needs me');
  assert.deepEqual(f.exits, ['Reply'], 'left in the same tick, no timer');
  assert.deepEqual(f.said, [['exit']], 'with no words after it to press');
  assert.equal(f.timers.size, 0, 'nothing waits to leave');
  f.v.stop();
  f.recs[0].finish({ kind: 'final', text: 'What needs me? Lamp.' });
  await flush(); await flush();
  assert.equal(el.value, 'What needs me', 'the final writes nothing once the box was left');
  assert.deepEqual(f.exits, ['Reply'], 'left once');
  assert.deepEqual(f.said, [['exit']]);
  assert.equal(f.v.active, null);
});

test('\'Watch this: lamp start\' leaves \'Watch this:\' in the box, leaves it, and presses \'start\'', async (t) => {
  const f = boxes(t);
  const el = f.box('Reply'), seen = [];
  el.addEventListener('input', () => seen.push(el.value));
  el.focus();
  f.v.start(el);
  await flush();
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'Watch this:' });
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'Watch this: lamp start' });
  assert.equal(el.value, 'Watch this:', 'only what came before the escape word');
  assert.deepEqual(seen, ['Watch this:'], 'never with “lamp start” in it');
  assert.deepEqual(f.exits, ['Reply']);
  assert.notEqual(f.document.activeElement, el, 'the box is left');
  assert.deepEqual(f.said, [['exit', 'start']], 'and the word after it goes to the labels');
});

test('partials arriving after the escape word never write into the box', async (t) => {
  const f = boxes(t);
  const el = f.box('Reply'), seen = [];
  el.addEventListener('input', () => seen.push(el.value));
  el.focus();
  f.v.start(el);
  await flush();
  const hear = (kind, text) => f.recs[0].opts.onEvent({ kind, text });
  hear('partial', 'Ship it lamp');
  assert.deepEqual([el.value, f.said], ['Ship it', [['exit']]]);
  hear('partial', 'Ship it lamp star');
  hear('partial', 'Ship it lamp start');
  hear('partial', 'Ship it lamp start bottom');
  hear('partial', 'Ship it lamp, and more prose');
  f.v.stop();
  f.recs[0].finish({ kind: 'final', text: 'Ship it. Lamp. Start bottom.' });
  await flush(); await flush();
  assert.equal(el.value, 'Ship it');
  assert.deepEqual(seen, ['Ship it'], 'one write, the one before the escape word');
  assert.deepEqual(f.said, [['exit'], ['after', 'star'], ['after', 'start'], ['after', 'bottom'], ['after', 'and', 'more', 'prose'], ['after', 'start', 'bottom']],
    'each word after it once as it firms up: a word revised in its place is handed again');
});

test('the escape word is read as each word is heard, and the status line names it', async (t) => {
  const f = boxes(t, { escapeWord: () => 'done' });
  const el = f.box('Reply');
  el.focus();
  f.v.start(el);
  await flush();
  f.recs[0].opts.onEvent({ kind: 'ready' });
  assert.match(f.document.querySelector('.voice-hud').textContent, /Esc or “done” leaves the box/);
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'Ship it lamp' });
  assert.deepEqual(f.exits, [], 'the default is not the word now');
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'Ship it. Done!' });
  assert.equal(el.value, 'Ship it.');
  assert.deepEqual(f.exits, ['Reply']);
});

test('where the helper cannot run the box falls back to macOS Dictation and says why, and later boxes go straight there', async (t) => {
  const f = boxes(t);
  const el = f.box('Add idea');
  el.focus();
  f.v.start(el);
  await flush();
  f.recs[0].opts.onEvent({ kind: 'error', reason: 'no-swiftc', error: 'swiftc is not installed' });
  await flush();
  assert.deepEqual(f.dict, [['start', 'Add idea']]);
  assert.equal(f.v.active.state, 'dictation');
  assert.match(f.document.querySelector('.voice-hud').textContent, /macOS Dictation.*Apple’s speech helper can’t run here.*swiftc is not installed/);
  el.value = 'Fix the lamp switch';
  el.dispatchEvent(ev(f, 'Event', 'input', { cancelable: false }));
  assert.deepEqual(f.exits, [], 'a box edited out of what it held is watched only at its end');
  el.value = 'Fix it lamp';
  el.dispatchEvent(ev(f, 'Event', 'input', { cancelable: false }));
  assert.equal(el.value, 'Fix it', 'taken out of what Dictation typed at once');
  assert.deepEqual(f.exits, ['Add idea']);
  assert.deepEqual(f.said, [['exit']]);
  await f.v.stop();
  assert.deepEqual(f.dict.at(-1), ['stop', 'Add idea']);
  f.v.start(f.box('Reply'));
  await flush();
  assert.equal(f.recs.length, 1, 'no second try of the helper');
  assert.deepEqual(f.dict.at(-1), ['start', 'Reply']);
});

test('a helper Voice’s setup found cannot run sends the first box straight to Dictation; a passing failure does not', async (t) => {
  const f = boxes(t);
  f.v.helperFailed({ reason: 'no-model', error: 'macOS could not install its English speech model' });
  assert.equal(f.v.helperDown, null, 'tried again in the box');
  f.v.helperFailed({ reason: 'no-swiftc', error: 'swiftc is not installed' });
  f.v.start(f.box('Add idea'));
  await flush();
  assert.deepEqual([f.recs.length, f.dict, f.v.active.state], [0, [['start', 'Add idea']], 'dictation']);
});

test('a box left for another stops first, its last words still landing, then the other records; a box a redraw replaced keeps getting the words', async (t) => {
  const f = boxes(t);
  f.v.start(f.box('Add idea'));
  await flush();
  const old = f.box('Add idea');
  old.outerHTML = `<textarea aria-label="Add idea">${old.value}</textarea>`;
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'now' });
  assert.equal(f.box('Add idea').value, 'Fix the button now');
  const next = f.v.start(f.box('Reply'));
  await flush();
  assert.equal(f.recs.length, 1, 'waits for the first box’s final words');
  f.recs[0].finish({ kind: 'final', text: 'now please' });
  await next;
  assert.equal(f.box('Add idea').value, 'Fix the button now please');
  assert.equal(f.recs.length, 2);
  assert.equal(f.v.active.el, f.box('Reply'));
});

test('anchorOf reads the selection, so words replace what was selected', (t) => {
  const f = boxes(t);
  const el = f.box('Add idea');
  el.value = 'one two three'; el.setSelectionRange(4, 7);
  assert.deepEqual(anchorOf(el), { before: 'one ', after: ' three' });
});

test('typing in the box mid-dictation stops listening for good and keeps what was typed; the box’s own writes and a redraw’s input never count', async (t) => {
  const f = boxes(t);
  const el = f.box('Add idea'), hud = f.document.querySelector('.voice-hud');
  el.focus(); el.setSelectionRange(7, 7);
  f.v.start(el);
  await flush();
  f.recs[0].opts.onEvent({ kind: 'ready' });
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'retry' });
  el.dispatchEvent(ev(f, 'Event', 'input', { cancelable: false }));
  el.setSelectionRange(0, 0);
  for (const key of ['Shift', 'Meta', 'Escape', 'Tab']) el.dispatchEvent(ev(f, 'KeyboardEvent', 'keydown', { key }));
  el.dispatchEvent(ev(f, 'KeyboardEvent', 'keydown', { key: 'c', metaKey: true }));
  assert.equal(f.v.active.state, 'listening', 'its own input, a field put back by a redraw, a modifier or ⌘C is no edit');
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'retry limit' });
  assert.equal(el.value, 'Fix the retry limit button');
  el.setSelectionRange(26, 26);
  el.dispatchEvent(ev(f, 'KeyboardEvent', 'keydown', { key: 's' }));
  el.value = 'Fix the retry limit buttons';
  el.dispatchEvent(ev(f, 'Event', 'input', { cancelable: false }));
  assert.equal(f.v.active, null, 'listening stopped');
  assert.equal(f.recs[0].cancelled, 1, 'the recording dropped, the mic let go');
  assert.equal(f.v.paused.el, el);
  assert.equal(hud.textContent, EDITED_NOTE);
  assert.equal(hud.hidden, false);
  assert.match(EDITED_NOTE, /Leave the box and come back to it to dictate again/);
  f.recs[0].opts.onEvent({ kind: 'partial', text: 'retry limit of three' });
  f.recs[0].opts.onEvent({ kind: 'final', text: 'retry limit of three.' });
  assert.equal(el.value, 'Fix the retry limit buttons', 'words still in flight never land over the edit');
  await f.v.stop();
  assert.equal(hud.hidden, true, 'leaving the box clears the line');
  assert.equal(f.v.paused, null);
  f.v.start(el);
  await flush();
  assert.equal(f.recs.length, 2, 'focused again, it records again');
});

test('moving the caret by click or arrow, pasting or deleting stops listening; the click that focused the box does not', async (t) => {
  const f = boxes(t);
  const el = f.box('Reply');
  const listen = async () => { await f.v.stop(); el.focus(); f.v.start(el); await flush(); f.recs.at(-1).opts.onEvent({ kind: 'ready' }); };
  el.dispatchEvent(ev(f, 'PointerEvent', 'pointerdown'));
  await listen();
  assert.equal(f.v.active.state, 'listening', 'a press before the recording began');
  const cases = [['PointerEvent', 'pointerdown'], ['KeyboardEvent', 'keydown', { key: 'ArrowLeft' }], ['KeyboardEvent', 'keydown', { key: 'ArrowLeft', metaKey: true }],
    ['KeyboardEvent', 'keydown', { key: 'Backspace' }], ['KeyboardEvent', 'keydown', { key: 'Enter', shiftKey: true }], ['Event', 'paste'], ['Event', 'cut'], ['Event', 'beforeinput']];
  for (const [type, name, init] of cases) {
    el.dispatchEvent(ev(f, type, name, init));
    assert.equal(f.v.active, null, `${name} ${init?.key ?? ''}`);
    assert.equal(f.document.querySelector('.voice-hud').textContent, EDITED_NOTE);
    await listen();
  }
  f.box('Add idea').dispatchEvent(ev(f, 'PointerEvent', 'pointerdown'));
  assert.equal(f.v.active.state, 'listening', 'a press elsewhere is not an edit here');
  assert.equal(editKey({ key: 'a', metaKey: true }), true, 'select all');
  assert.equal(editKey({ key: 'v', metaKey: true }), false, 'paste comes as its own event');
  assert.equal(editKey({ key: 'Enter', isComposing: true }), true, 'an IME’s commit');
});

test('a box a redraw replaced carries on recording, or stays paused, in its replacement', async (t) => {
  const f = boxes(t);
  const old = f.box('Add idea');
  old.focus();
  f.v.start(old);
  await flush();
  f.recs[0].opts.onEvent({ kind: 'ready' });
  old.outerHTML = `<textarea aria-label="Add idea">${old.value}</textarea>`;
  const now = f.box('Add idea');
  assert.equal(sameBox(old, now), true);
  assert.equal(sameBox(f.box('Reply'), now), false);
  assert.equal(sameBox(now, now.cloneNode()), false, 'a box still on the page is itself only');
  f.v.follow(now);
  assert.equal(f.v.active.el, now);
  assert.equal(f.recs.length, 1);
  now.dispatchEvent(ev(f, 'KeyboardEvent', 'keydown', { key: 'x' }));
  assert.equal(f.v.paused.el, now, 'keys in the replacement are edits of the box');
  now.outerHTML = `<textarea aria-label="Add idea">${now.value}</textarea>`;
  f.v.follow(f.box('Add idea'));
  assert.equal(f.v.paused.el, f.box('Add idea'));
  assert.equal(f.recs.length, 1, 'and stays stopped');
});

test('under Dictation the escape word leaves wherever it stands in what it typed, takes out what came after and presses it, and anything typed once left', async (t) => {
  const f = boxes(t);
  f.v.helperFailed({ reason: 'no-swiftc', error: 'swiftc is not installed' });
  const el = f.box('Add idea');
  el.value = 'Fix the lamp button'; el.focus(); el.setSelectionRange(7, 7);
  f.v.start(el);
  await flush();
  assert.equal(f.v.active.state, 'dictation');
  const typed = (value) => { el.value = value; el.dispatchEvent(ev(f, 'Event', 'input', { cancelable: false })); };
  typed('Fix the retry lamp button');
  assert.deepEqual(f.exits, [], 'the box’s own “lamp” is not what Dictation typed');
  typed('Fix the retry lamp start lamp button');
  assert.equal(el.value, 'Fix the retry lamp button');
  assert.deepEqual(f.exits, ['Add idea']);
  assert.deepEqual(f.said, [['exit', 'start']]);
  typed('Fix the retry Bottom. lamp button');
  assert.equal(el.value, 'Fix the retry lamp button', 'nothing more is kept once left');
  assert.deepEqual(f.said, [['exit', 'start'], ['after', 'bottom']]);
});

// Off a Mac: no helper and no Dictation, so a box records with Vosk in the browser (voice-local.js).
function offMac(t) {
  const local = [];
  const f = boxes(t, { local: { record: (opts) => { const r = { opts, cancelled: 0, async open() {}, stop: () => new Promise((resolve) => { r.finish = resolve; }), cancel() { r.cancelled++; } }; local.push(r); return r; } } });
  return Object.assign(f, { local });
}

test('off a Mac the first box, told not-mac by the server, records in the browser instead, never Dictation, and later boxes go straight there', async (t) => {
  const f = offMac(t);
  const el = f.box('Add idea');
  el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  f.v.start(el);
  await flush();
  f.recs[0].opts.onEvent({ kind: 'error', reason: 'not-mac', error: 'Apple’s speech helper only runs on a Mac' });
  await flush();
  assert.equal(f.local.length, 1, 'the same box, now in the browser');
  assert.deepEqual(f.dict, [], 'Dictation is Mac-only');
  f.local[0].opts.onEvent({ kind: 'ready', where: 'browser' });
  assert.deepEqual(f.v.active, { el, state: 'listening', local: true });
  assert.match(f.document.querySelector('.voice-hud').textContent, /Listening in this browser, with Vosk.*“lamp” leaves the box/);
  f.local[0].opts.onEvent({ kind: 'partial', text: 'add a retry' });
  assert.equal(el.value, 'Fix the button add a retry');
  f.local[0].opts.onEvent({ kind: 'partial', text: 'add a retry limit lamp settings' });
  assert.equal(el.value, 'Fix the button add a retry limit', 'the escape word works the same on Vosk’s lowercase text');
  assert.deepEqual(f.said, [['exit', 'settings']], 'and what followed it presses');
  f.v.stop();
  f.local[0].finish({ kind: 'final', text: 'add a retry limit lamp settings' });
  await flush();
  f.v.start(f.box('Reply'));
  await flush();
  assert.deepEqual([f.recs.length, f.local.length, f.dict], [1, 2, []], 'no second ask of the server');
});

test('a setup that found no Mac sends the first box to the browser; a box Vosk cannot hear says why and starts nothing else', async (t) => {
  const f = offMac(t);
  f.v.helperFailed({ reason: 'not-mac', error: 'Apple’s speech helper only runs on a Mac' });
  f.v.start(f.box('Add idea'));
  await flush();
  assert.deepEqual([f.recs.length, f.local.length], [0, 1]);
  f.local[0].opts.onEvent({ kind: 'error', reason: 'no-model', error: 'The voice model is not there (HTTP 404)' });
  assert.equal(f.v.active, null);
  assert.deepEqual(f.dict, []);
  assert.match(f.document.querySelector('.voice-hud').textContent, /Vosk could not listen here: The voice model is not there/);
  f.document.body.insertAdjacentHTML('beforeend', '<div contenteditable="true" aria-label="Notes"></div>');
  f.v.start(f.document.querySelector('[aria-label="Notes"]'));
  await flush();
  assert.deepEqual([f.local.length, f.dict], [1, []], 'a rich box takes only Dictation’s typing, which is Mac-only');
  assert.match(f.document.querySelector('.voice-hud').textContent, /plain text box/);
});

test('on a Mac nothing changes: with no local recorder offered a not-mac answer still falls to Dictation', async (t) => {
  const f = boxes(t);
  f.v.start(f.box('Add idea'));
  await flush();
  f.recs[0].opts.onEvent({ kind: 'error', reason: 'no-swiftc', error: 'swiftc is not installed' });
  await flush();
  assert.deepEqual(f.dict, [['start', 'Add idea']]);
  assert.equal(f.v.active.local, false);
});
