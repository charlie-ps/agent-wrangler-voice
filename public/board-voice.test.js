import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { initBoardVoice, identity, OUT_TYPES, JOBS_VIEW } from './board-voice.js';
import { createKeys, clickables, hintRank } from './job-keys.js';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
function board(t, { labels = 'off', open = true, jobs = false } = {}) {
  const w = new Window({ url: 'http://localhost/' });
  t.after(() => w.happyDOM.abort().then(() => w.close()));
  w.document.body.innerHTML = `<nav id="nav-rail"><div class="rail-zone rail-top"><div class="layouts"><button data-view="grid" title="Tasks"></button></div></div><div class="rail-zone rail-bottom"><button id="settings-btn" title="Settings"></button></div></nav>
    <main><div id="grid"><div class="session-card" role="button" data-sid="s1">One</div></div><div id="ext-views"><div class="ext-view${jobs ? '' : ' hidden'}" data-view="ext:jobs:jobs"></div></div><div id="search" class="hidden"></div></main>
    <div id="modal" class="hidden"></div><div id="settings-modal" class="hidden"></div>`;
  // A browser that can listen: the mic is never opened here, since the model is not there.
  Object.defineProperty(w.navigator, 'mediaDevices', { value: { getUserMedia: async () => { throw new Error('no mic in a test'); } }, configurable: true });
  w.AudioWorkletNode = function AudioWorkletNode() {};
  const settings = { labels, escapeWord: '' }, sent = [];
  let up = open;
  const voice = initBoardVoice({
    doc: w.document,
    send: (m) => { if (!up) return false; sent.push(m); return true; },
    getSetting: (id) => settings[id],
    setSetting: (id, v) => { settings[id] = v; voice.settingChanged(id); },
  });
  return { w, doc: w.document, voice, settings, sent, connect: () => { up = true; }, mic: () => w.document.getElementById('voice-mic') };
}

test('a session card is the same target by its id, however its text changes', () => {
  const w = new Window();
  w.document.body.innerHTML = '<div class="session-card" data-sid="a">idle 2m</div><div class="worker-row" data-sid="b"></div><div class="worker-row team-row" data-lead-sid="c"></div><div class="subagent-row" data-owner-sid="a" data-subagent-id="x"></div><button>Go</button>';
  const [card, worker, team, sub, button] = w.document.body.children;
  assert.deepEqual([card, worker, team, sub, button].map(identity), ['s:a', 's:b', 'team:c', 'sa:a/x', null]);
  w.close();
});

test('the rail’s mic turns Voice on, and Voice asks before the model is fetched: Cancel fetches nothing', async (t) => {
  const b = board(t);
  assert.equal(b.mic().parentElement.className, 'rail-zone rail-bottom', 'in the rail');
  assert.equal(b.mic().dataset.voice, 'off');
  assert.match(b.mic().title, /Click to turn Voice labels on/);
  b.mic().click();
  assert.equal(b.settings.labels, 'voice');
  await tick(10);
  assert.deepEqual(b.sent, [{ type: OUT_TYPES['voice-model'], op: 'check' }], 'only asks whether the server has it');
  assert.equal(b.mic().dataset.voice, 'loading');
  assert.equal(b.voice.take({ type: 'voice:model', op: 'check', present: false }), true);
  await tick(10);
  const ask = b.doc.querySelector('dialog.job-voice-ask');
  assert.ok(ask?.open, 'the warning is up');
  assert.match(ask.textContent, /41 MB/);
  assert.match(ask.textContent, /ccoreilly\.github\.io/);
  assert.match(b.mic().title, /waiting for you to allow the voice model’s download/);
  ask.querySelector('[data-voice-ask="cancel"]').click();
  await tick(10);
  assert.equal(b.mic().dataset.voice, 'declined');
  assert.ok(!b.sent.some((m) => m.op === 'download'), 'nothing fetched');
  b.mic().click();
  assert.equal(b.settings.labels, 'off', 'a click on the lit mic turns Voice off');
});

// Before the download test: job-voice.js keeps one model load in flight per page, as a page has one Voice.
test('what Voice sends before the socket is open waits for its first frame', async (t) => {
  const b = board(t, { labels: 'voice', open: false });
  await tick(10);
  assert.deepEqual(b.sent, []);
  b.connect();
  assert.equal(b.voice.take({ type: 'config' }), false, 'not a Voice frame');
  assert.deepEqual(b.sent, [{ type: 'voice:model', op: 'check' }]);
  b.voice.take({ type: 'voice:model', op: 'check', present: false });
  await tick(10);
  b.doc.querySelector('dialog.job-voice-ask [data-voice-ask="cancel"]').click();
  await tick(10);
});

test('Download asks the server to fetch, and its progress is the setup’s first step', async (t) => {
  const b = board(t);
  b.mic().click();
  await tick(10);
  b.voice.take({ type: 'voice:model', op: 'check', present: false });
  await tick(10);
  b.doc.querySelector('dialog.job-voice-ask [data-voice-ask="download"]').click();
  await tick(10);
  assert.deepEqual(b.sent.at(-1), { type: 'voice:model', op: 'download' });
  b.voice.take({ type: 'voice:model', op: 'progress', fraction: 0.42 });
  await tick(350);
  const panel = b.doc.getElementById('voice-setup');
  assert.equal(panel.hidden, false, 'the setup panel shows once it takes longer than a glance');
  assert.match(panel.textContent, /downloading 41 MB, 42%/);
  assert.match(b.mic().title, /Setting up Voice \(1 of 3\)/);
});

test('while the Jobs view is in front its own Voice has the mic: this one stays off and draws nothing', async (t) => {
  const b = board(t, { labels: 'voice', jobs: true });
  await tick(10);
  assert.ok(b.doc.querySelector(JOBS_VIEW));
  assert.equal(b.mic().dataset.voice, 'yielded');
  assert.match(b.mic().title, /Jobs view is in front/);
  assert.deepEqual(b.sent, [], 'no model check, no mic');
  assert.equal(b.doc.querySelectorAll('.job-key').length, 0);
});

test('Wrangler²’s control messages go out under this board’s own voice: types', () => {
  assert.deepEqual(OUT_TYPES, { 'voice-model': 'voice:model', speech: 'voice:speech', dictation: 'voice:dictation', 'job-open-url': 'voice:open-url' });
});

// Agent Wrangler's task tiles as cards.js draws them: each head's New session and ⋯ carry no id, data or text.
const tileHtml = (id, name) => `<div class="task-cell" data-taskid="${id}"><div class="task-head"><span class="task-name">${name}</span>
  <button class="task-new-sess" title="New session in this task"><svg></svg></button><button class="task-actions-btn" title="Task actions"><svg></svg></button></div>
  <div class="task-body"><div class="session-card" role="button" data-sid="${id}-s">working</div></div></div>`;
const TILES = ['t1', 't2', 't3', 't4'];
function tiles(t, { voice = true } = {}) {
  const w = new Window({ url: 'http://localhost/' });
  t.after(() => w.happyDOM.abort().then(() => w.close()));
  w.document.body.innerHTML = `<div id="grid">${TILES.map((id) => tileHtml(id, id.toUpperCase())).join('')}<div class="task-cell no-task" data-entity="no-task"><div class="task-head"><button class="task-new-sess"></button><button class="task-actions-btn"></button></div></div></div>`;
  const grid = w.document.getElementById('grid');
  const box = { top: 10, left: 10, bottom: 50, right: 210 };
  const keys = createKeys({ doc: w.document, rectOf: () => box, hintRectOf: () => box, voice: () => voice, identity,
    targets: () => ({ host: grid, items: clickables(grid).map((el) => ({ hint: true, el, rank: hintRank(el), act: () => {} })) }) });
  t.after(() => keys.dispose());
  // Each button's badge, named by its tile and class, so a redraw's new elements read the same.
  const badges = () => Object.fromEntries(keys.drawn().map((d) => [`${d.el.closest('.task-cell').dataset.taskid ?? 'none'} ${d.el.className}`, d.label]));
  return { w, grid, keys, badges };
}

test('a task tile’s buttons are told apart by their task and class, look alike as they do', () => {
  const w = new Window();
  w.document.body.innerHTML = tileHtml('a', 'A') + tileHtml('b', 'B') + '<div class="task-cell" data-entity="no-task"><button class="task-new-sess"></button></div>';
  const ids = [...w.document.querySelectorAll('.task-new-sess, .task-actions-btn, .session-card')].map(identity);
  assert.equal(new Set(ids).size, ids.length, 'no two alike');
  assert.equal(ids.at(-1).startsWith('t:no-task|task-new-sess|'), true, 'the Unassigned tile is a task of its own');
  assert.equal(ids[2], 's:a-s', 'a session card keeps its own id');
  w.close();
});

test('under Voice, repeated syncs over several tasks’ New session and ⋯ keep every word where it was', (t) => {
  const v = tiles(t);
  v.keys.sync();
  const first = v.badges();
  assert.equal(Object.keys(first).length, TILES.length * 3 + 2, 'every button and card has a word');
  assert.equal(new Set(Object.values(first)).size, Object.keys(first).length, 'no word twice');
  // A session updating (its card's text) re-syncs the board, many times over.
  for (let i = 0; i < 6; i++) {
    for (const c of v.grid.querySelectorAll('.session-card')) c.textContent = `idle ${i}m`;
    v.keys.sync();
    assert.deepEqual(v.badges(), first, `sync ${i + 2} moved no word`);
  }
});

test('under Voice, redrawing a task tile leaves its buttons’ words where they were', (t) => {
  const v = tiles(t);
  v.keys.sync();
  const first = v.badges();
  // One tile drawn again (its session changed), then the whole board.
  v.grid.querySelector('[data-taskid="t2"]').outerHTML = tileHtml('t2', 'T2');
  v.keys.sync();
  assert.deepEqual(v.badges(), first, 'one tile redrawn');
  v.grid.innerHTML = v.grid.innerHTML;
  v.keys.sync();
  assert.deepEqual(v.badges(), first, 'the whole board redrawn');
});

test('on Keyboard, a redrawn board hands every task button its own letter back', (t) => {
  const v = tiles(t, { voice: false });
  v.keys.sync();
  const first = v.badges();
  for (let i = 0; i < 3; i++) { v.grid.innerHTML = v.grid.innerHTML; v.keys.sync(); assert.deepEqual(v.badges(), first, `redraw ${i + 1}`); }
});
