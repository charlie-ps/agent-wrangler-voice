import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { hintLabels, HINT_CHARS, HINT_USE, hintRank, CHAT_KEY, DIGITS, PLATE_LETTERS, HINT_RESERVED, plateKey, bareKey, typing, clippedRect, shownRect, clickables, reach, createKeys, scrollKey, ownsScrollKey, scrollByKey, LINE, PAGE, WORDS, BUTTON_WORDS, COMMANDS, FINE_PX, scrollStep, wordLabels, targetWord, dictatable } from './job-keys.js';

function page(t, html = '') {
  const window = new Window({ url: 'http://localhost:7878', width: 1024, height: 768 });
  window.document.body.innerHTML = html;
  t.after(() => window.happyDOM.close());
  return window;
}
const key = (window, k, init = {}) => new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
const box = (top, left = 10) => ({ top, left, bottom: top + 40, right: left + 200 });

test('hint letters never spend the chat key or a digit, take w back in Agent Wrangler’s place, and stay prefix-free past one letter', () => {
  assert.ok(!HINT_CHARS.includes(CHAT_KEY));
  assert.ok(!/\d/.test(HINT_CHARS));
  assert.equal(HINT_CHARS, 'frdesawqtgzxcvbjkliounmphy'.replace(CHAT_KEY, ''), 'Agent Wrangler’s order, less i');
  assert.equal(new Set(HINT_CHARS).size, HINT_CHARS.length);
  assert.deepEqual(hintLabels(3), ['f', 'r', 'd']);
  assert.deepEqual(hintLabels(0), []);
  const many = hintLabels(HINT_CHARS.length + 4);
  assert.equal(new Set(many).size, many.length);
  assert.ok(many.every((a) => many.every((b) => a === b || !b.startsWith(a))), 'no label is a prefix of another');
  assert.ok(many.every((l) => !l.includes(CHAT_KEY)));
});

test('a plate’s key is its digit up to the ninth, then a letter a–m without the chat key, then none', () => {
  assert.equal(PLATE_LETTERS, 'abcdefghjklm');
  assert.ok(!PLATE_LETTERS.includes(CHAT_KEY));
  assert.deepEqual(Array.from({ length: 12 }, (_, n) => plateKey(n)), ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c']);
  assert.equal(plateKey(DIGITS + 7), 'h');
  assert.equal(plateKey(DIGITS + 8), 'j', 'i is skipped');
  assert.equal(plateKey(DIGITS + PLATE_LETTERS.length - 1), 'm');
  assert.equal(plateKey(DIGITS + PLATE_LETTERS.length), undefined, 'the letters ran out');
  assert.equal(plateKey(60), undefined);
});

test('the plates never take a reserved hint letter, and enough are reserved for two-letter labels', () => {
  assert.equal(HINT_RESERVED, 'nopqrstuvwxyz');
  assert.ok([...HINT_RESERVED].every((c) => HINT_CHARS.includes(c) && !PLATE_LETTERS.includes(c)));
  const keys = new Set(Array.from({ length: 100 }, (_, n) => plateKey(n)).filter(Boolean));
  assert.ok([...HINT_RESERVED].every((c) => !keys.has(c)), 'however many plates');
  const left = [...HINT_CHARS].filter((c) => !keys.has(c)).join('');
  assert.ok(left.length >= 2);
  assert.equal(hintLabels(50, left).length, 50);
});

test('a board of 40+ plates leaves its other targets labelled from the reserved letters, prefix-free beside the plates’ keys', (t) => {
  const plates = 45, others = 30;
  const w = page(t, `<div id="host">${Array.from({ length: plates }, (_, i) => `<a id="p${i}">P${i}</a>`).join('')}${Array.from({ length: others }, (_, i) => `<button id="b${i}">B${i}</button>`).join('')}</div>`);
  const host = w.document.getElementById('host'), hits = [];
  const keyed = Array.from({ length: plates }, (_, i) => ({ label: plateKey(i), el: w.document.getElementById(`p${i}`), silent: true, badge: true, act: () => hits.push(`p${i}`) })).filter((it) => it.label);
  const keys = createKeys({ doc: w.document, rectOf: () => box(10), hintRectOf: () => box(10),
    targets: () => ({ host, items: [...keyed, ...[...host.querySelectorAll('button')].map((el) => ({ hint: true, el, act: () => hits.push(el.id) }))] }) });
  t.after(() => keys.dispose());
  keys.sync();
  const drawn = keys.drawn();
  const hinted = drawn.filter((d) => d.el.tagName === 'BUTTON').map((d) => d.label);
  assert.equal(drawn.filter((d) => d.el.tagName === 'A').length, DIGITS + PLATE_LETTERS.length, 'the first 21 plates keep 1–9 and a–m');
  assert.equal(hinted.length, others, 'every other target keeps a badge');
  assert.ok(hinted.every((l) => [...l].every((c) => HINT_RESERVED.includes(c))), `only reserved letters: ${hinted}`);
  const all = drawn.map((d) => d.label);
  assert.ok(all.every((a) => all.every((b) => a === b || !b.startsWith(a))), 'prefix-free with the plates’ keys');
  assert.equal(keys.press(key(w, 'a')), true);
  const last = hinted.at(-1);
  for (const c of last) keys.press(key(w, c));
  assert.deepEqual(hits, ['p9', `b${others - 1}`]);
});

test('a bare key has no modifier, no repeat and no composition; typing is any field that takes text, or an editable', (t) => {
  assert.equal(bareKey({ key: 'w' }), true);
  for (const m of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'repeat', 'isComposing']) assert.equal(bareKey({ key: 'w', [m]: true }), false, m);
  const w = page(t, `<input id="i"><input id="num" type="number"><textarea id="t"></textarea><select id="s"></select><div contenteditable="true"><b id="e">x</b></div><div contenteditable="false"><b id="n">x</b></div><button id="b">Go</button>
    <input id="box" type="checkbox"><input id="radio" type="radio"><input id="file" type="file">`);
  const $ = (id) => w.document.getElementById(id);
  for (const id of ['i', 'num', 't', 's', 'e']) assert.equal(typing($(id)), true, id);
  for (const id of ['n', 'b', 'box', 'radio', 'file']) assert.equal(typing($(id)), false, `${id}: a switch a label left focused still lets the next label through`);
  assert.equal(typing(w.document.body), false);
});

test('a target clipped out by a scrolling ancestor or the viewport has no rect', (t) => {
  const w = page(t, '<div id="scroll" style="overflow:auto"><button id="b">Go</button></div>');
  const b = w.document.getElementById('b'), scroll = w.document.getElementById('scroll');
  b.getBoundingClientRect = () => ({ ...box(500), width: 200, height: 40 });
  scroll.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 300, right: 800 });
  assert.equal(clippedRect(b), null, 'scrolled below its box');
  scroll.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 2000, right: 800 });
  assert.deepEqual(clippedRect(b), box(500));
  b.getBoundingClientRect = () => ({ ...box(900), width: 200, height: 40 });
  assert.equal(clippedRect(b), null, 'below the window');
  b.remove();
  assert.equal(clippedRect(b), null);
});

function keyed(t, { items, host = 'host' } = {}) {
  const w = page(t, '<div id="host"><button id="a">A</button><button id="b">B</button></div><input id="field">');
  const $ = (id) => w.document.getElementById(id);
  const hits = [], rects = new Map([['a', box(10)], ['b', box(100)]]);
  const state = { items: items ?? [{ label: '1', id: 'a' }, { label: 'w', id: 'b' }], host };
  const keys = createKeys({
    doc: w.document,
    rectOf: (el) => rects.get(el.id) || null,
    targets: () => (state.host ? { host: $(state.host), items: state.items.map((it) => ({ label: it.label, silent: it.silent, el: $(it.id), act: (e) => hits.push([it.label, e.key]) })) } : null),
  });
  t.after(() => keys.dispose());
  const badges = () => [...w.document.querySelectorAll('.job-keys .job-key')].map((k) => k.textContent);
  return { w, $, hits, rects, state, keys, badges };
}

test('each target on screen gets one badge in a layer of its own, and the target is left as it was', (t) => {
  const k = keyed(t);
  const before = k.$('host').innerHTML;
  k.keys.sync();
  assert.deepEqual(k.badges(), ['1', 'w']);
  assert.equal(k.$('a').textContent, 'A', 'the badge is not in the button');
  assert.equal(k.w.document.querySelector('.job-keys').getAttribute('aria-hidden'), 'true');
  assert.equal(k.$('host').innerHTML.replace(/<div class="job-keys".*<\/div>$/, ''), before);
  const marker = k.w.document.querySelector('[data-key="w"]');
  k.keys.sync();
  assert.ok(k.w.document.querySelector('[data-key="w"]') === marker, 'a sync with nothing moved touches nothing');
  k.rects.set('b', null); k.keys.sync();
  assert.deepEqual(k.badges(), ['1'], 'scrolled away, its badge goes');
  k.state.host = null; k.keys.sync();
  assert.equal(k.w.document.querySelector('.job-keys'), null, 'no surface, no layer');
});

test('a key acts only on a badge already drawn, and again once re-resolved', (t) => {
  const k = keyed(t);
  const e = key(k.w, 'w');
  assert.equal(k.keys.press(e), false, 'no badge drawn yet: nothing');
  assert.deepEqual(k.hits, []); assert.equal(e.defaultPrevented, false);
  k.keys.sync();
  const hit = key(k.w, 'w');
  assert.equal(k.keys.press(hit), true);
  assert.deepEqual(k.hits, [['w', 'w']]); assert.equal(hit.defaultPrevented, true);
  assert.equal(k.keys.press(key(k.w, 'x')), false, 'a key with no badge is left alone');
  k.state.host = null;
  assert.equal(k.keys.press(key(k.w, '1')), false, 'drawn before, but gone once re-resolved (a dialog opened)');
  assert.deepEqual(k.hits, [['w', 'w']]);
});

test('a redraw re-resolves the badge onto the new element', async (t) => {
  const k = keyed(t, { items: [{ label: '1', id: 'a' }] });
  k.keys.sync();
  k.$('host').innerHTML = '<button id="a">A again</button>';
  k.keys.press(key(k.w, '1'));
  assert.deepEqual(k.hits, [['1', '1']]);
  assert.deepEqual(k.badges(), ['1']);
});

test('the observer redraws the badges when what it watches changes', async (t) => {
  const w = page(t, '<div id="host"></div>');
  const host = w.document.getElementById('host');
  const keys = createKeys({ doc: w.document, watch: [host], rectOf: () => box(10), targets: () => ({ host, items: [...host.querySelectorAll('button')].map((el, i) => ({ label: String(i + 1), el, act() {} })) }) });
  t.after(() => keys.dispose());
  host.innerHTML = '<button>A</button><button>B</button>';
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([...host.querySelectorAll('.job-key')].map((k) => k.textContent), ['1', '2']);
  host.querySelector('button').remove();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual([...host.querySelectorAll('.job-key')].map((k) => k.textContent), ['1']);
});

test('a target that moves with no mutation, resize or scroll takes its badge along on the next frame', async (t) => {
  // A plate just drawn is measured inside its content-visibility placeholder, then grows once the
  // browser finds it on screen; a fade, a thumbnail or a font moves a target the same silent way.
  const w = page(t, '<div id="host"><div id="plate"><img id="shot"><button id="go">Go</button></div></div>');
  const host = w.document.getElementById('host'), go = w.document.getElementById('go');
  let top = 100;
  const keys = createKeys({ doc: w.document, watch: [host], rectOf: () => box(top, 100), targets: () => ({ host, items: [{ label: '1', el: go, act() {} }] }) });
  t.after(() => keys.dispose());
  keys.sync();
  const at = () => host.querySelector('[data-key="1"]').style.top;
  const frame = () => new Promise((r) => setTimeout(r, 50));
  await frame();
  assert.equal(at(), '100px');
  for (const [type, el] of [['contentvisibilityautostatechange', 'plate'], ['transitionend', 'plate'], ['animationend', 'go'], ['load', 'shot']]) {
    top += 150;
    w.document.getElementById(el).dispatchEvent(new w.Event(type));
    assert.equal(at(), `${top - 150}px`, `${type}: not before the frame it settles in`);
    await frame();
    assert.equal(at(), `${top}px`, `${type} on #${el} re-syncs`);
  }
  keys.dispose();
  top += 150;
  go.dispatchEvent(new w.Event('transitionend'));
  await frame();
  assert.equal(host.querySelector('.job-key'), null, 'disposed: nothing listens');
});

test('a dialog closing anywhere hands the keys back without a redraw of the view', (t) => {
  const w = page(t, '<div id="host"><button id="a">A</button></div><dialog id="d"></dialog>');
  const host = w.document.getElementById('host'), d = w.document.getElementById('d');
  const keys = createKeys({ doc: w.document, rectOf: () => box(10), targets: () => (d.open ? null : { host, items: [{ label: '1', el: w.document.getElementById('a'), act() {} }] }) });
  t.after(() => keys.dispose());
  d.showModal(); keys.sync();
  assert.equal(host.querySelector('.job-key'), null, 'none under another dialog');
  d.close();
  assert.equal(host.querySelector('.job-key')?.textContent, '1');
});

test('a silent item draws no badge and acts on what targets() gives at the press, on screen or not', (t) => {
  const k = keyed(t, { items: [{ label: '1', id: 'a' }, { label: 'w', id: 'b' }] });
  k.state.items[0].silent = true;
  k.keys.sync();
  assert.deepEqual(k.badges(), ['w']);
  k.rects.set('a', null);
  const e = key(k.w, '1');
  assert.equal(k.keys.press(e), true);
  assert.equal(e.defaultPrevented, true);
  assert.deepEqual(k.hits, [['1', '1']]);
  k.state.host = null;
  assert.equal(k.keys.press(key(k.w, '1')), false, 'nothing to give, nothing done');
});

test('a silent item’s letter leaves the hint labels, so they stay prefix-free beside it, drawn or not', (t) => {
  const w = page(t, `<div id="host"><button id="p">P</button>${Array.from({ length: HINT_CHARS.length }, (_, i) => `<button id="b${i}">B${i}</button>`).join('')}</div>`);
  const host = w.document.getElementById('host'), hits = [];
  const state = { badge: false };
  const keys = createKeys({ doc: w.document, rectOf: () => box(10), hintRectOf: () => box(10),
    targets: () => ({ host, items: [
      { label: 'f', el: w.document.getElementById('p'), silent: true, badge: state.badge, act: () => hits.push('p') },
      { label: 'a', el: w.document.getElementById('p'), silent: true, act: () => hits.push('p2') },
      ...[...host.querySelectorAll('button[id^="b"]')].map((el) => ({ hint: true, el, act: () => hits.push(el.id) }))] }) });
  t.after(() => keys.dispose());
  keys.sync();
  const labels = keys.drawn().map((d) => d.label);
  assert.equal(labels.length, HINT_CHARS.length, 'neither silent item draws a badge');
  assert.ok(labels.every((l) => !l.includes('f') && !l.includes('a')), `no hint spends f or a: ${labels}`);
  assert.ok(labels.every((a) => labels.every((b) => a === b || !b.startsWith(a))), 'still prefix-free');
  assert.deepEqual(labels, hintLabels(HINT_CHARS.length, HINT_CHARS.replace(/[fa]/g, '')), 'the cheapest letters left');
  state.badge = true; keys.sync();
  assert.ok(keys.drawn().some((d) => d.label === 'f'), 'with its badge, f is drawn on its own target');
  assert.equal(keys.press(key(w, 'f')), true);
  assert.equal(keys.press(key(w, 'a')), true);
  assert.deepEqual(hits, ['p', 'p2']);
});

function hinted(t, n) {
  const w = page(t, `<div id="host">${Array.from({ length: n }, (_, i) => `<button id="b${i}" data-n="${i}">B${i}</button>`).join('')}<button id="p" class="primary">Go</button></div>`);
  const host = w.document.getElementById('host'), hits = [], rects = new Map();
  const items = () => [{ label: '1', el: w.document.getElementById('p'), act: () => hits.push('1') },
    ...[...host.querySelectorAll('button[data-n]')].map((el) => ({ hint: true, el, act: () => hits.push(el.id) }))];
  const keys = createKeys({ doc: w.document, rectOf: () => box(10), hintRectOf: (el) => (rects.has(el.id) ? rects.get(el.id) : box(10)), targets: () => ({ host, items: items() }) });
  t.after(() => keys.dispose());
  const shown = () => [...host.querySelectorAll('.job-key:not([hidden])')].map((k) => k.dataset.key);
  return { w, host, hits, rects, keys, shown };
}

test('hint items take the letter labels in order, and only those on screen take one', (t) => {
  const h = hinted(t, 3);
  h.rects.set('b0', null);
  h.keys.sync();
  assert.deepEqual(h.keys.drawn().map((d) => [d.label, d.el.id]), [['1', 'p'], ['f', 'b1'], ['r', 'b2']]);
  h.keys.press(key(h.w, 'r'));
  assert.deepEqual(h.hits, ['b2']);
});

test('hint items take the cheapest labels by rank, ties in the order drawn, and a press hands its act the label typed', (t) => {
  const w = page(t, '<div id="host"><button id="a">A</button><button id="b">B</button><button id="c">C</button><button id="d">D</button></div>');
  const host = w.document.getElementById('host'), got = [];
  const ranks = { a: 2, b: 0, c: 1, d: 0 };
  const keys = createKeys({ doc: w.document, rectOf: () => box(10), hintRectOf: () => box(10),
    targets: () => ({ host, items: [...host.querySelectorAll('button')].map((el) => ({ hint: true, el, rank: ranks[el.id], act: (e, label) => got.push([el.id, label]) })) }) });
  t.after(() => keys.dispose());
  keys.sync();
  assert.deepEqual(keys.drawn().map((d) => [d.label, d.el.id]), [['e', 'a'], ['f', 'b'], ['d', 'c'], ['r', 'd']]);
  keys.press(key(w, 'd'));
  assert.deepEqual(got, [['c', 'd']]);
});

test('a target keeps its label while it stays on screen, and gets it back after scrolling away and back', (t) => {
  const h = hinted(t, 8);
  const ids = (from, to) => Array.from({ length: to - from }, (_, i) => `b${from + i}`);
  const labelOf = () => Object.fromEntries(h.keys.drawn().filter((d) => d.el.id !== 'p').map((d) => [d.el.id, d.label]));
  for (const id of ids(5, 8)) h.rects.set(id, null);
  h.keys.sync();
  const first = labelOf();
  assert.deepEqual(first, { b0: 'f', b1: 'r', b2: 'd', b3: 'e', b4: 's' });
  // Scrolled down: b0 and b1 leave the top, b5–b7 come in at the bottom; those still on screen keep theirs.
  for (const id of ['b0', 'b1']) h.rects.set(id, null);
  for (const id of ids(5, 8)) h.rects.delete(id);
  h.keys.sync();
  const down = labelOf();
  for (const id of ['b2', 'b3', 'b4']) assert.equal(down[id], first[id], `${id} kept its letter`);
  assert.deepEqual([down.b5, down.b6, down.b7], ['a', 'w', 'q'], 'the newcomers take what is free, cheapest first, sparing f and r for b0 and b1');
  // A content-visibility settle re-syncing with nothing moved changes nothing.
  h.keys.sync();
  assert.deepEqual(labelOf(), down);
  // Scrolled back: b0 and b1 get theirs back and nobody else moves.
  h.rects.delete('b0'); h.rects.delete('b1');
  for (const id of ids(5, 8)) h.rects.set(id, null);
  h.keys.sync();
  assert.deepEqual(labelOf(), first);
  // Across a redraw too, which hands every element over to its twin.
  for (const id of ['b0', 'b1']) h.rects.set(id, null);
  h.keys.sync();
  for (const b of [...h.host.querySelectorAll('button')]) b.replaceWith(b.cloneNode(true));
  h.rects.delete('b0'); h.rects.delete('b1');
  h.keys.sync();
  assert.deepEqual(labelOf(), first);
});

test('a two-letter label stays while its target is on screen, though the rest would fit one letter each again', (t) => {
  const n = HINT_CHARS.length + 1;
  const h = hinted(t, n);
  h.keys.sync();
  const two = Object.fromEntries(h.keys.drawn().map((d) => [d.el.id, d.label]));
  assert.equal(two[`b${n - 1}`].length, 2);
  h.rects.set('b3', null); h.rects.set('b4', null);
  h.keys.sync();
  const fewer = Object.fromEntries(h.keys.drawn().map((d) => [d.el.id, d.label]));
  for (const [id, l] of Object.entries(fewer)) assert.equal(l, two[id], `${id} kept ${l}`);
  h.rects.set(`b${n - 1}`, null); h.rects.set(`b${n - 2}`, null);
  h.keys.sync();
  const one = h.keys.drawn().filter((d) => d.el.id !== 'p').map((d) => d.label);
  assert.ok(one.every((l) => l.length === 1), `with no two-letter label left on screen, the cheap set comes back: ${one}`);
});

test('with no letter free, the set grows a prefix rather than hand a newcomer what a target scrolled away holds', (t) => {
  const n = HINT_CHARS.length;
  const h = hinted(t, n + 2);
  h.rects.set(`b${n}`, null); h.rects.set(`b${n + 1}`, null);
  h.keys.sync();
  const one = Object.fromEntries(h.keys.drawn().map((d) => [d.el.id, d.label]));
  h.rects.set('b0', null); h.rects.set('b1', null);
  h.rects.delete(`b${n}`); h.rects.delete(`b${n + 1}`);
  h.keys.sync();
  const grown = Object.fromEntries(h.keys.drawn().map((d) => [d.el.id, d.label]));
  assert.equal(one.b0, 'f', 'b0 held the letter that becomes the prefix');
  assert.ok(![grown[`b${n}`], grown[`b${n + 1}`]].includes(one.b1), 'b1’s letter is kept for it');
  for (let i = 2; i < n; i++) assert.equal(grown[`b${i}`], one[`b${i}`], `b${i} kept ${one[`b${i}`]}`);
  h.rects.delete('b1');
  h.keys.sync();
  const back = Object.fromEntries(h.keys.drawn().map((d) => [d.el.id, d.label]));
  assert.equal(back.b1, one.b1, 'b1 comes back to its letter');
  const all = Object.values(back);
  assert.ok(all.every((x) => all.every((y) => x === y || !y.startsWith(x))), `prefix-free: ${all}`);
});

test('past one letter each, only a target whose letter became a prefix loses it, and the labels stay prefix-free', (t) => {
  const n = HINT_CHARS.length + 2;
  const h = hinted(t, n);
  const labelOf = () => Object.fromEntries(h.keys.drawn().filter((d) => d.el.id !== 'p').map((d) => [d.el.id, d.label]));
  for (const id of ['b0', `b${n - 2}`, `b${n - 1}`]) h.rects.set(id, null);
  h.keys.sync();
  const one = labelOf();
  assert.ok(Object.values(one).every((l) => l.length === 1));
  h.rects.clear();
  h.keys.sync();
  const two = labelOf();
  const set = hintLabels(HINT_CHARS.length * 2 - 1);
  assert.ok(Object.values(two).every((l) => set.includes(l)), 'from the prefix-free set one prefix makes');
  assert.equal(new Set(Object.values(two)).size, n);
  assert.equal(one.b1, 'f');
  assert.notEqual(two.b1, 'f', 'f is now the prefix of the overflow');
  for (const [id, l] of Object.entries(one)) if (l !== 'f') assert.equal(two[id], l, `${id} kept ${l}`);
  // One scrolling away keeps the prefix, so every two-letter label left stays put too.
  h.rects.set('b0', null);
  h.keys.sync();
  const fewer = labelOf();
  for (const [id, l] of Object.entries(fewer)) assert.equal(l, two[id], `${id} kept ${l}`);
});

test('hintRank puts a dialog’s primary and the session cards first, ways to start a session next, then views and tabs, and the rail’s other tools last', (t) => {
  const w = page(t, `<nav id="nav-rail"><div class="layouts"><button id="grid" data-view="grid"></button></div><button id="new-task"></button><button id="new-session"></button><button id="usage-btn"></button></nav>
    <div id="grid"><div id="card" class="session-card" role="button" data-sid="a">Card</div><div id="worker" class="worker-row" role="button" data-sid="b">W</div><button id="task-new" class="task-new-sess"></button><button id="kebab" class="task-actions-btn"></button></div>
    <div id="modal"><button id="go" class="primary">Launch</button><button id="cancel">Cancel</button><div role="tablist"><button id="tab" role="tab">Chat</button></div></div>`);
  const rank = (id) => hintRank(w.document.getElementById(id));
  const tiers = [['card', 'worker', 'go'], ['task-new', 'new-task', 'new-session'], ['grid', 'tab'], ['kebab', 'cancel'], ['usage-btn']];
  tiers.forEach((ids, n) => ids.forEach((id) => assert.equal(rank(id), n, id)));
  assert.equal(HINT_USE.length, tiers.length);
});

test('a two-letter label narrows after its first letter, and the second clicks', (t) => {
  const h = hinted(t, HINT_CHARS.length + 2);
  h.keys.sync();
  const two = h.keys.drawn().filter((d) => d.label.length === 2);
  assert.deepEqual(two.map((d) => d.label), ['ff', 'fr', 'fd']);
  const first = key(h.w, 'f');
  assert.equal(h.keys.press(first), true);
  assert.equal(first.defaultPrevented, true);
  assert.deepEqual(h.hits, [], 'one letter of two clicks nothing');
  assert.equal(h.keys.typed(), 'f');
  assert.deepEqual(h.shown(), ['ff', 'fr', 'fd'], 'only the labels it starts stay, the primary steps aside too');
  assert.equal(h.host.querySelector('[data-key="fr"] .job-key-typed').textContent, 'f');
  assert.equal(h.host.querySelector('[data-key="fr"]').textContent, 'fr');
  h.keys.press(key(h.w, 'r'));
  assert.deepEqual(h.hits, [two[1].el.id]);
  assert.equal(h.keys.typed(), '');
  assert.equal(h.shown().length, HINT_CHARS.length + 3, 'every badge is back');
});

test('Esc or a wrong letter drops a half-typed label, and Esc is left alone with nothing typed', (t) => {
  const h = hinted(t, HINT_CHARS.length + 2);
  h.keys.sync();
  const idle = key(h.w, 'Escape');
  assert.equal(h.keys.press(idle), false);
  assert.equal(idle.defaultPrevented, false, 'Esc still goes back');
  h.keys.press(key(h.w, 'f'));
  const esc = key(h.w, 'Escape');
  assert.equal(h.keys.press(esc), true);
  assert.equal(esc.defaultPrevented, true, 'this Esc only clears');
  assert.equal(h.keys.typed(), '');
  assert.equal(h.host.querySelector('.job-key-typed'), null);
  h.keys.press(key(h.w, 'f'));
  const slip = key(h.w, 'z');
  assert.equal(h.keys.press(slip), true);
  assert.equal(slip.defaultPrevented, true);
  assert.equal(h.keys.typed(), '');
  h.keys.press(key(h.w, 'f'));
  h.keys.press(key(h.w, '1'));
  assert.deepEqual(h.hits, [], 'no slip, not even a fixed key, clicks anything');
});

test('a label a redraw handed to another target clicks nothing; one drawn again on its twin does', (t) => {
  const h = hinted(t, 2);
  h.keys.sync();
  h.host.innerHTML = '<button id="b0" data-n="0">B0</button><button id="b1" data-n="1">B1</button><button id="p" class="primary">Go</button>';
  h.keys.press(key(h.w, 'r'));
  assert.deepEqual(h.hits, ['b1'], 'the same step drawn again');
  h.host.innerHTML = '<button id="x" data-n="x">New</button><button id="b1" data-n="1">B1</button><button id="p" class="primary">Go</button>';
  h.keys.sync();
  h.host.innerHTML = '<button id="y" data-n="y">Other</button><button id="b1" data-n="1">B1</button><button id="p" class="primary">Go</button>';
  assert.equal(h.keys.press(key(h.w, 'f')), false, 'f was on New, and is now on Other');
  assert.deepEqual(h.hits, ['b1']);
  assert.deepEqual(h.keys.drawn().map((d) => [d.label, d.el.id]), [['1', 'p'], ['f', 'y'], ['r', 'b1']], 'the free f went to Other, and B1 kept r');
  h.keys.press(key(h.w, 'f'));
  assert.deepEqual(h.hits, ['b1', 'y']);
});

test('clickables are what a pointer clicks: no disabled ones, no lent session panel, a checkbox by its label', (t) => {
  const w = page(t, `<div id="r"><a id="a" href="#x">A</a><a id="na">no href</a><button id="b">B</button><button id="d" disabled>D</button>
    <details><summary id="s">S</summary></details><div id="g" role="button" tabindex="0">G</div><button id="ad" aria-disabled="true">AD</button>
    <label id="l"><input id="c" type="checkbox">Flag</label><input id="lone" type="checkbox"><div class="job-mc-host"><button id="m">M</button></div>
    <div id="h" hidden><button id="hb">H</button></div><textarea id="t"></textarea><input id="hid" type="hidden"><textarea id="dt" disabled></textarea></div>`);
  assert.deepEqual(clickables(w.document.getElementById('r')).map((el) => el.id), ['a', 'b', 's', 'g', 'l', 'lone', 't']);
  let clicks = 0; w.document.getElementById('b').onclick = () => clicks++;
  reach(w.document.getElementById('b'));
  assert.equal(clicks, 1, 'a button is clicked');
  reach(w.document.getElementById('t'));
  assert.ok(w.document.activeElement === w.document.getElementById('t'), 'a field is focused, to type into');
});

test('what a closed <details> folds away is not clickable; its summary is, and so is all of an open one', (t) => {
  const w = page(t, `<div id="r"><details><summary id="s">Conversation</summary><div><a id="in" href="#x">link</a></div>
    <details><summary id="ns">Nested</summary><button id="nb">B</button></details></details>
    <details open><summary id="os">Place</summary><div class="pop"><button id="ob">Write</button></div></details></div>`);
  const ids = () => clickables(w.document.getElementById('r')).map((el) => el.id);
  assert.deepEqual(ids(), ['s', 'os', 'ob']);
  w.document.querySelector('details').open = true;
  assert.deepEqual(ids(), ['s', 'in', 'ns', 'os', 'ob'], 'opened, its content and a nested summary are');
});

test('a badge hangs on its item’s `at`, not on the wide box it clicks', (t) => {
  const w = page(t, '<div id="host"><button id="n"><span id="tile">T</span>Step</button></div>');
  const host = w.document.getElementById('host'), seen = [];
  const keys = createKeys({ doc: w.document, rectOf: () => box(10), hintRectOf: (el) => { seen.push(el.id); return box(el.id === 'tile' ? 60 : 10, el.id === 'tile' ? 300 : 10); },
    targets: () => ({ host, items: [{ hint: true, el: w.document.getElementById('n'), at: w.document.getElementById('tile'), act() {} }] }) });
  t.after(() => keys.dispose());
  keys.sync();
  assert.deepEqual(seen, ['tile']);
  const k = host.querySelector('.job-key');
  assert.equal(k.style.left, '300px'); assert.equal(k.style.top, '60px');
});

test('what a shut <details> holds is never reached, its summary is', (t) => {
  const w = page(t, `<div id="r"><details id="d"><summary id="s">Any model</summary><label id="l">Agent<select id="sel"><option>a</option></select></label><button id="in">In</button></details>
    <details open><summary id="s2">Steps</summary><button id="shown">Shown</button></details></div>`);
  const ids = () => clickables(w.document.getElementById('r')).map((el) => el.id);
  assert.deepEqual(ids(), ['s', 's2', 'shown'], 'a browser still lays out what a shut <details> holds, so its box is no guide');
  w.document.getElementById('d').open = true;
  assert.deepEqual(ids(), ['s', 'sel', 'in', 's2', 'shown'], 'opened, all of it');
});

test('a chart’s points take no label at all, the one Tab stops at included', (t) => {
  const w = page(t, `<div id="r"><svg><g id="a" role="radio" tabindex="-1"></g><g id="b" role="radio" tabindex="0"></g><g id="c" role="button" tabindex="-1"></g></svg><button id="x">X</button></div>`);
  assert.deepEqual(clickables(w.document.getElementById('r')).map((el) => el.id), ['x']);
});

test('a hint’s corner is tried a little way in, inside a round button’s curve, never past 12px', (t) => {
  const w = page(t, '<button id="b">×</button><button id="wide">Wide</button>');
  const tried = [];
  w.document.elementFromPoint = (x, y) => { tried.push([x, y]); return w.document.getElementById(tried.length === 1 ? 'b' : 'wide'); };
  w.document.getElementById('b').getBoundingClientRect = () => ({ top: 100, left: 100, bottom: 140, right: 140, width: 40, height: 40 });
  w.document.getElementById('wide').getBoundingClientRect = () => ({ top: 100, left: 100, bottom: 300, right: 500, width: 400, height: 200 });
  assert.ok(shownRect(w.document.getElementById('b')));
  assert.ok(shownRect(w.document.getElementById('wide')));
  assert.deepEqual(tried, [[112, 112], [112, 112]]);
});

test('a hint is drawn only where nothing covers its corner', (t) => {
  const w = page(t, '<nav id="bar"></nav><button id="b">B</button>');
  const b = w.document.getElementById('b'), bar = w.document.getElementById('bar');
  b.getBoundingClientRect = () => ({ ...box(10), width: 200, height: 40 });
  w.document.elementFromPoint = () => b.firstChild?.parentNode ?? b;
  assert.deepEqual(shownRect(b), box(10));
  w.document.elementFromPoint = () => bar;
  assert.equal(shownRect(b), null, 'under the sticky trail');
});

// The corner of a box the pointer never meets lands on what is drawn behind it, an ancestor (the page,
// the graph): that hit alone once let a badge float over the wallpaper.
test('a hint is drawn only on what is painted and takes the pointer, even when its corner hits an ancestor', (t) => {
  const w = page(t, '<button id="b">B</button>');
  const b = w.document.getElementById('b'), bg = w.document.body;
  b.getBoundingClientRect = () => ({ ...box(10), width: 200, height: 40 });
  w.document.elementFromPoint = () => bg;
  assert.deepEqual(shownRect(b), box(10), 'shown: the corner may fall on its ancestor');
  bg.style.visibility = 'hidden';
  assert.equal(shownRect(b), null, 'visibility:hidden');
  bg.style.visibility = '';
  b.style.pointerEvents = 'none';
  assert.equal(shownRect(b), null, 'pointer-events:none');
  b.style.pointerEvents = '';
  b.checkVisibility = () => false;
  assert.equal(shownRect(b), null, 'not painted, as Chrome answers for what a closed <details> folds away (content-visibility:hidden)');
});

test('a badge stays whole inside the window, even on a target flush with its edge', (t) => {
  const w = page(t, '<div id="host"><button id="a">A</button><button id="b">B</button><button id="c">C</button></div>');
  for (const [prop, px] of [['offsetWidth', 24], ['offsetHeight', 26]]) Object.defineProperty(w.HTMLElement.prototype, prop, { configurable: true, get: () => px });
  const host = w.document.getElementById('host');
  const rects = { a: { top: 0, left: 0, bottom: 40, right: 200 }, b: { top: 100, left: 100, bottom: 140, right: 300 }, c: { top: 750, left: 1010, bottom: 768, right: 1024 } };
  const keys = createKeys({ doc: w.document, rectOf: (el) => rects[el.id], targets: () => ({ host, items: ['a', 'b', 'c'].map((id, i) => ({ label: String(i + 1), el: w.document.getElementById(id), act() {} })) }) });
  t.after(() => keys.dispose());
  keys.sync();
  const at = (label) => { const k = host.querySelector(`[data-key="${label}"]`); return [k.style.left, k.style.top]; };
  assert.deepEqual(at('1'), ['4px', '4px'], 'a plate flush with the top-left corner keeps its badge on screen');
  assert.deepEqual(at('2'), ['93px', '92px'], 'anywhere else it hangs over the corner by a third of its size');
  assert.deepEqual(at('3'), [`${1024 - 24 - 4}px`, `${768 - 26 - 4}px`], 'and at the far corner, inside it too');
});

test('a field in a label is reached, a choice or a file picker through its label, and `also` adds parts in the order drawn', (t) => {
  const w = page(t, `<div id="r"><label id="lc">Agents<input id="n" type="number"></label><label id="lf">Attach<input id="f" type="file"></label>
    <label id="lb"><input id="c" type="checkbox">Flag</label><button id="chip">Chip<span id="out" data-out>↗</span></button><button id="next">Next</button></div>`);
  const ids = (els) => els.map((el) => el.id);
  const r = w.document.getElementById('r');
  assert.deepEqual(ids(clickables(r)), ['n', 'lf', 'lb', 'chip', 'next']);
  assert.deepEqual(ids(clickables(r, '[data-out]')), ['n', 'lf', 'lb', 'chip', 'out', 'next']);
  reach(w.document.getElementById('n'));
  assert.ok(w.document.activeElement === w.document.getElementById('n'), 'focused, to type a number into');
});

test('a badge is Agent Wrangler’s hint marker: opaque hint tokens with the host’s values behind them, never the page’s --bg or --fg', () => {
  const css = readFileSync(new URL('./voice.css', import.meta.url), 'utf8');
  const rule = css.match(/\n:root \.job-key \{([^}]*)\}/)[1];
  assert.match(rule, /background:var\(--hint, #f2cc60\)/);
  assert.match(rule, /color:var\(--hint-fg, #1c1400\)/);
  assert.match(rule, /border:1px solid var\(--hint-border, #9a6700\)/);
  assert.match(rule, /font:700 16px\/24px /);
  assert.doesNotMatch(rule, /var\(--(bg|fg)\)/);
  assert.doesNotMatch(rule, /transform:translate/, 'placed by job-keys.js, which keeps it inside the window');
});

test('Voice’s words are one syllable, distinct, never a letter’s or a digit’s name, and share no rhyme', () => {
  assert.equal(new Set(WORDS).size, WORDS.length);
  assert.ok(WORDS.length >= 40, 'enough for a busy board');
  assert.ok(WORDS.every((w) => /^[a-z]+$/.test(w) && w.length >= 3 && w.length <= 6), 'short lowercase words');
  const names = ['bee', 'see', 'sea', 'tea', 'pea', 'gee', 'jay', 'kay', 'why', 'you', 'are', 'eye', 'owe', 'oh', 'queue', 'ex', 'one', 'won', 'two', 'too', 'to', 'three', 'four', 'for', 'five', 'six', 'eight', 'ate', 'nine', 'ten', 'zero'];
  assert.deepEqual(WORDS.filter((w) => names.includes(w)), []);
  // A rhyme by spelling (vowels on): no two words may end the same from their stressed vowel group, the
  // first in every word here (bottom, upper, lower), a silent e kept on it, as it lengthens the vowel
  // (rope is not top's rhyme, hope is; lower is not upper's, as -er is unstressed).
  const rime = (w) => w.replace(/e$/, '').match(/[aeiouy].*$/)[0] + (/[aeiou][^aeiouy]e$/.test(w) ? 'e' : '');
  assert.deepEqual([...WORDS, ...COMMANDS].filter((w) => w.replace(/e$/, '').match(/[aeiouy]+/g).length > 1), ['upper', 'lower', 'bottom'],
    'a new word of two syllables needs its stress checked before the rime above holds for it');
  const seen = new Map();
  for (const w of [...WORDS, ...COMMANDS]) { assert.ok(!seen.has(rime(w)), `${w} rhymes with ${seen.get(rime(w))}`); seen.set(rime(w), w); }
  assert.deepEqual([rime('rope'), rime('hope'), rime('top'), rime('horse'), rime('lower'), rime('upper')], ['ope', 'ope', 'op', 'ors', 'ower', 'upper'], 'a silent e parts rope from top, never from hope; a rhyme starts at the stress');
  assert.deepEqual(COMMANDS.filter((c) => WORDS.includes(c)), [], 'a command is never a badge');
});

test('a command scrolls by most of a screen, a few lines, or to either end', () => {
  const box = { scrollTop: 1000, scrollHeight: 5000, clientHeight: 800 };
  assert.deepEqual(['up', 'down', 'upper', 'lower', 'top', 'bottom'].map((w) => scrollStep(w, box)), [-560, 560, -FINE_PX, FINE_PX, -1000, 3200]);
  assert.ok(FINE_PX < 560 / 4, 'a fine step is visibly less than up or down');
  assert.equal(scrollStep('bottom', { scrollTop: 4200, scrollHeight: 5000, clientHeight: 800 }), 0, 'already at the end');
  assert.equal(scrollStep('top', { scrollTop: 0, scrollHeight: 5000, clientHeight: 800 }), 0);
  assert.deepEqual(COMMANDS.toSorted(), ['bottom', 'down', 'lower', 'top', 'up', 'upper'], 'every command has a step');
});

test('words go out by rank, clearest first, and a redraw keeps each target’s word while the rest take the clearest free', () => {
  const same = (a, b) => a === b;
  const hints = ['a', 'b', 'c'].map((el) => ({ el }));
  const first = wordLabels(hints, [], { same });
  assert.deepEqual(hints.map((h) => first.get(h)), WORDS.slice(0, 3));
  // 'a' went away and 'd' came first in rank: 'b' and 'c' keep theirs, 'd' takes the clearest free word.
  const before = hints.map((h) => ({ el: h.el, label: first.get(h) }));
  const next = ['d', 'b', 'c'].map((el) => ({ el }));
  assert.deepEqual(next.map((h) => wordLabels(next, before, { same }).get(h)), [WORDS[0], WORDS[1], WORDS[2]]);
  const moved = ['c', 'd', 'b'].map((el) => ({ el }));
  assert.deepEqual(moved.map((h) => wordLabels(moved, before, { same }).get(h)), [WORDS[2], WORDS[0], WORDS[1]], 'a reorder moves no word');
  const many = Array.from({ length: WORDS.length + 2 }, (_, i) => ({ el: i }));
  const out = wordLabels(many, [], { same });
  assert.equal(out.size, WORDS.length, 'past the last word a target takes none');
  assert.equal(wordLabels(hints, [{ el: 'a', label: 'f' }], { same }).get(hints[0]), WORDS[0], 'a letter label is not a word to keep');
});

test('a button’s own words are distinct, never a fallback word, a command, a letter’s or a digit’s name', () => {
  assert.equal(new Set(BUTTON_WORDS).size, BUTTON_WORDS.length);
  assert.ok(BUTTON_WORDS.every((w) => /^[a-z]+$/.test(w)), 'lowercase letters only');
  const names = ['bee', 'see', 'sea', 'tea', 'pea', 'gee', 'jay', 'kay', 'why', 'you', 'are', 'eye', 'owe', 'oh', 'queue', 'ex', 'one', 'won', 'two', 'too', 'to', 'three', 'four', 'for', 'five', 'six', 'eight', 'ate', 'nine', 'ten', 'zero'];
  assert.deepEqual(BUTTON_WORDS.filter((w) => names.includes(w) || w.length < 3 || WORDS.includes(w) || COMMANDS.includes(w)), []);
});

test('a target’s word is the first of its leading words a button may say, from its text, else its aria-label or title', (t) => {
  const w = page(t, `<button id="approve">✓ Approve &amp; open PR</button><button id="merge">Merge #12</button><button id="gear" aria-label="Automation settings" title="Automation settings"><svg></svg></button>
    <button id="how" title="How Jobs works"></button><button id="proof">Show me proof</button><a id="long" href="#">Merge the flaky login test fix once checks pass</a><button id="poss">Move a step’s work</button><button id="none">Frobnicate</button>
    <input id="field" aria-label="Agents at once" value="pause"><button id="tab" data-filter="all">In flight<span>3</span></button><button id="quote">Don’t merge</button>`);
  const $ = (id) => w.document.getElementById(id);
  assert.deepEqual(['approve', 'merge', 'gear', 'how', 'proof', 'long', 'poss', 'none', 'field', 'tab', 'quote'].map((id) => targetWord($(id))),
    ['approve', 'merge', 'automation', 'jobs', 'proof', '', '', '', 'agents', 'flight', ''], 'prose, a possessive, an unknown word and a no say nothing');
  assert.equal(targetWord($('approve'), ['open']), 'open', 'any vocabulary, the first of its leading words');
  assert.equal(targetWord('a'), '', 'nothing to read, no word');
});

test('a target takes its own word, the first in rank keeps one that two share, and the rest fall back to WORDS', () => {
  const same = (a, b) => a === b;
  const of = { approve: 'approve', merge1: 'merge', merge2: 'merge', odd: '', fake: 'lamp' };
  const wordOf = (el) => of[el] ?? '';
  const hints = ['merge1', 'approve', 'odd', 'merge2', 'fake'].map((el) => ({ el }));
  const first = wordLabels(hints, [], { same, wordOf });
  assert.deepEqual(hints.map((h) => first.get(h)), ['merge', 'approve', WORDS[0], WORDS[1], WORDS[2]], 'a word outside BUTTON_WORDS is never its own');
  // merge1 went away: merge2 keeps the fallback it had, so a redraw moves no word, and a new Merge button takes "merge".
  const before = hints.map((h) => ({ el: h.el, label: first.get(h) }));
  const next = ['merge2', 'merge3', 'approve'].map((el) => ({ el }));
  of.merge3 = 'merge';
  assert.deepEqual(next.map((h) => wordLabels(next, before, { same, wordOf }).get(h)), [WORDS[1], 'merge', 'approve']);
  const wasOwn = [{ el: 'gone', label: 'approve' }, { el: 'merge2', label: 'merge' }];
  const kept = wordLabels(next, wasOwn, { same, wordOf });
  assert.deepEqual(next.map((h) => kept.get(h)), ['merge', WORDS[0], 'approve'], 'a kept own word wins over a newcomer’s claim to it');
});

function voiced(t, { voice = true } = {}) {
  const w = page(t, '<div id="host"><button id="a" class="primary">Go</button><button id="b">B</button><button id="c">C</button></div>');
  const host = w.document.getElementById('host'), hits = [], heard = [], state = { voice };
  const keys = createKeys({ doc: w.document, rectOf: () => box(10), hintRectOf: () => box(10), voice: () => state.voice, onWords: (ws) => heard.push(ws),
    targets: () => ({ host, items: [{ label: '1', el: w.document.getElementById('c'), silent: true, act: (e) => hits.push(['1', e.key]) },
      ...[...host.querySelectorAll('button:not(#c)')].map((el) => ({ hint: true, el, rank: el.matches('.primary') ? 0 : 1, act: (e, label) => hits.push([el.id, label, !!e.voice]) }))] }) });
  t.after(() => keys.dispose());
  const badges = () => [...host.querySelectorAll('.job-key')].map((k) => [k.textContent, k.classList.contains('job-key-word')]);
  return { w, host, hits, heard, state, keys, badges };
}

test('a press deals the badges again once what it set moving has settled (a disclosure that animates open)', async (t) => {
  const w = page(t, '<div id="host"><button id="a">Go</button></div>');
  const host = w.document.getElementById('host');
  let asked = 0;
  const keys = createKeys({ doc: w.document, rectOf: () => box(10), hintRectOf: () => box(10), voice: () => true,
    targets: () => { asked++; return { host, items: [{ hint: true, el: w.document.getElementById('a'), rank: 0, act: () => {} }] }; } });
  t.after(() => keys.dispose());
  keys.sync();
  assert.equal(keys.say(WORDS[0]), true);
  const atPress = asked;
  await new Promise((r) => setTimeout(r, 350));
  assert.ok(asked > atPress, 'dealt again after the press');
});

test('under Voice each badge shows a word instead of its letter, the recognizer hears the set drawn, and saying one presses it as its key would', (t) => {
  const v = voiced(t);
  v.keys.sync();
  assert.deepEqual(v.badges(), [[WORDS[0], true], [WORDS[1], true]]);
  assert.deepEqual(v.heard, [[WORDS[0], WORDS[1]].sort()]);
  assert.equal(v.keys.say(WORDS[1]), true);
  assert.deepEqual(v.hits, [['b', WORDS[1], true]]);
  assert.equal(v.keys.say(WORDS[5]), false, 'a word with no badge on screen does nothing');
  assert.equal(v.keys.say('f'), false);
  assert.equal(v.keys.press(key(v.w, 'f')), false, 'no letter types under Voice');
  assert.equal(v.keys.press(key(v.w, '1')), true, 'a digit still works, unbadged');
  v.keys.sync();
  assert.equal(v.heard.length, 1, 'the same words again tell the recognizer nothing');
  v.state.voice = false; v.keys.sync();
  assert.deepEqual(v.badges(), [['f', false], ['r', false]], 'back on Keyboard, letters');
  assert.deepEqual(v.heard.at(-1), [], 'and nothing to hear');
});

test('a word heard presses only the target its badge was on: one redrawn as another takes nothing', (t) => {
  const v = voiced(t);
  v.keys.sync();
  v.host.querySelector('#b').remove();
  v.host.insertAdjacentHTML('afterbegin', '<button id="z">Z</button>');
  assert.equal(v.keys.say(WORDS[1]), false);
  assert.deepEqual(v.hits, []);
});

test('Voice dictates only into somewhere to write prose', (t) => {
  const w = page(t, `<textarea id="ta"></textarea><input id="plain"><input id="text" type="text"><input id="search" type="search"><div id="ce" contenteditable="true"></div>
    <input id="num" type="number"><input id="date" type="date"><select id="sel"></select><textarea id="off" disabled></textarea><textarea id="ro" readonly></textarea><button id="b">Go</button><div id="no" contenteditable="false"></div>`);
  const $ = (id) => w.document.getElementById(id);
  for (const id of ['ta', 'plain', 'text', 'search', 'ce']) assert.equal(dictatable($(id)), true, id);
  for (const id of ['num', 'date', 'sel', 'off', 'ro', 'b', 'no']) assert.equal(dictatable($(id)), false, id);
  assert.equal(dictatable(null), false);
});

// A board whose scroller (#scroll, positioned as #jobs is) holds a plate that clips (overflow:hidden), a
// sticky trail, a static inner scroller and a button inside a [role=button] tile.
function framed(t) {
  const w = page(t, `<div id="host"><div id="scroll" style="position:relative; overflow:auto">
    <div id="plate" style="position:relative; overflow:hidden"><button id="go">Go</button></div>
    <div id="bar" style="position:sticky; top:0"><button id="crumb">Up</button></div>
    <div id="strip" style="overflow-x:auto"><button id="node">Node</button></div>
    <div id="tile" role="button"><div style="position:relative"><button id="inner">In</button></div></div>
  </div></div>`);
  const $ = (id) => w.document.getElementById(id);
  for (const [prop, px] of [['offsetWidth', 24], ['offsetHeight', 26]]) Object.defineProperty(w.HTMLElement.prototype, prop, { configurable: true, get: () => px });
  for (const [prop, px] of [['scrollWidth', 1000], ['scrollHeight', 3000]]) Object.defineProperty($('scroll'), prop, { configurable: true, get: () => px });
  return { w, $ };
}

test('a badge rides inside the box its target scrolls in, placed in its scrolled coordinates, so a scroll moves it with no script', (t) => {
  const { w, $ } = framed(t);
  let scrolled = 0;
  $('scroll').getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 768, right: 1000 });
  const rects = { go: () => ({ ...box(400 - scrolled, 100), top: Math.max(0, 400 - scrolled) }), crumb: () => box(0, 100), node: () => box(600, 100), inner: () => box(700, 100) };
  const keys = createKeys({ doc: w.document, rectOf: (el) => rects[el.id]?.() ?? null, targets: () => ({ host: $('host'), items: ['go', 'crumb', 'node', 'inner'].map((id, i) => ({ label: String(i + 1), el: $(id), act() {} })) }) });
  t.after(() => keys.dispose());
  keys.sync();
  const layerOf = (label) => w.document.querySelector(`[data-key="${label}"]`).parentNode;
  assert.ok(layerOf('1').parentNode === $('scroll') && layerOf('1').matches('.job-keys.job-keys-in'), 'in the scroller, not the plate that would clip its overhang');
  assert.ok(layerOf('2').parentNode === $('bar'), 'a sticky trail carries its own, which moves when it does');
  assert.ok(layerOf('3').parentNode === $('host') && !layerOf('3').matches('.job-keys-in'), 'a static scroller has no box to ride in: placed against the window');
  assert.ok(layerOf('4') === layerOf('3'), 'nor does anything inside a target, whose text the letters would join');
  assert.equal($('tile').textContent.trim(), 'In');
  layerOf('1').getBoundingClientRect = () => ({ top: -scrolled, left: 0, bottom: -scrolled, right: 0 });
  const at = (label) => { const k = w.document.querySelector(`[data-key="${label}"]`); return [k.style.left, k.style.top]; };
  assert.deepEqual(at('1'), ['93px', '392px'], 'hung over the corner, against the content’s own top');
  scrolled = 300;
  $('scroll').dispatchEvent(new w.Event('scroll'));
  assert.deepEqual(at('1'), ['93px', '392px'], 'a scroll writes nothing: the badge already moved with the content');
  keys.sync();
  assert.deepEqual(at('1'), ['93px', '392px'], 'and a sync after it finds it where it was');
  scrolled = 410; keys.sync();
  assert.deepEqual(at('1'), ['93px', '414px'], 'scrolled half under the scroller’s top, it is placed whole inside what shows');
});

test('mid-scroll the letters stay where they are, and are dealt again once the scroll rests', async (t) => {
  const w = page(t, '<div id="host"><button id="a">A</button><button id="b">B</button></div>');
  const $ = (id) => w.document.getElementById(id);
  const rects = new Map([['a', box(10)], ['b', box(100)]]), rectOf = (el) => rects.get(el.id) || null;
  const keys = createKeys({ doc: w.document, rectOf, hintRectOf: rectOf, targets: () => ({ host: $('host'), items: ['a', 'b'].map((id) => ({ hint: true, el: $(id), act() {} })) }) });
  t.after(() => keys.dispose());
  keys.sync();
  const labels = () => keys.drawn().map((d) => [d.el.id, d.label]);
  assert.deepEqual(labels(), [['a', 'f'], ['b', 'r']]);
  rects.set('a', null);
  w.dispatchEvent(new w.Event('scroll'));
  $('host').appendChild(w.document.createElement('span'));
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(labels(), [['a', 'f'], ['b', 'r']], 'a scroll, and a change meanwhile, re-deal nothing yet');
  w.dispatchEvent(new w.Event('scroll'));
  w.dispatchEvent(new w.Event('scrollend'));
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(labels(), [['a', 'f'], ['b', 'r']], 'a scroll still going a moment later, even past a scrollend (a wheel’s notch), re-deals nothing either');
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(labels(), [['b', 'r']], 'at rest, the one still on screen keeps its letter');
});

test('mid-scroll a badge with no box to ride in follows its target from the scroll', (t) => {
  const k = keyed(t, { items: [{ label: '1', id: 'a' }] });
  k.keys.sync();
  const top = () => k.w.document.querySelector('[data-key="1"]').style.top;
  const before = top();
  k.rects.set('a', box(200));
  k.w.dispatchEvent(new k.w.Event('scroll'));
  assert.notEqual(top(), before);
  assert.deepEqual(k.badges(), ['1']);
});

test('the scroll keys are ↑/↓ a line, PgUp/PgDn and Space/Shift+Space a page, Home/End an end, held or not, and no other chord', (t) => {
  const window = page(t);
  const step = (k, init) => scrollKey(key(window, k, init));
  assert.deepEqual(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'Home', 'End'].map((k) => step(k)), [-LINE, LINE, -PAGE, PAGE, PAGE, -Infinity, Infinity]);
  assert.equal(step(' ', { shiftKey: true }), -PAGE, 'Shift+Space goes back a page');
  assert.equal(step('ArrowDown', { repeat: true }), LINE, 'held down it keeps going');
  for (const init of [{ shiftKey: true }, { metaKey: true }, { ctrlKey: true }, { altKey: true }, { isComposing: true }]) assert.equal(step('End', init), null, `${Object.keys(init)[0]} leaves End to someone else`);
  for (const k of ['ArrowLeft', 'ArrowRight', 'Enter', 'j', 'Tab']) assert.equal(step(k), null, `${k} scrolls nothing`);
});

test('a widget its arrows walk keeps every scroll key, and a control it would press keeps Space', (t) => {
  const window = page(t, '<div role="tablist"><button role="tab" id="tab">A</button></div><div role="radiogroup"><button role="radio" id="radio">A</button></div><div role="menu"><button id="item">A</button></div><svg><g id="pt" tabindex="0"></g></svg><input type="range" id="range"><button id="btn">Go</button><a href="#" id="link">x</a><summary id="sum">s</summary><p id="text">words</p>');
  const $ = (id) => window.document.getElementById(id);
  for (const id of ['tab', 'radio', 'item', 'pt', 'range']) for (const k of ['ArrowDown', 'Home', 'End', 'PageDown', ' ']) assert.equal(ownsScrollKey($(id), k), true, `${id} keeps ${k}`);
  for (const id of ['btn', 'link', 'sum']) {
    assert.equal(ownsScrollKey($(id), ' '), true, `${id} is pressed by Space`);
    assert.equal(ownsScrollKey($(id), 'ArrowDown'), false, `${id} still lets ↓ scroll`);
  }
  assert.equal(ownsScrollKey($('text'), ' '), false);
  assert.equal(ownsScrollKey(window.document.body, 'End'), false);
});

test('a scroll key moves its scroller a line, nine tenths of what shows, or to an end, never past one, smooth only when asked', (t) => {
  const window = page(t, '<div id="s"></div>');
  const el = window.document.getElementById('s');
  Object.defineProperty(el, 'clientHeight', { value: 500 });
  Object.defineProperty(el, 'scrollHeight', { value: 3000 });
  const calls = [];
  el.scrollTo = (o) => { calls.push(o); el.scrollTop = o.top; };
  scrollByKey(el, PAGE);
  assert.deepEqual(calls.at(-1), { top: 450, behavior: 'instant' });
  scrollByKey(el, LINE, { smooth: true });
  assert.deepEqual(calls.at(-1), { top: 490, behavior: 'smooth' });
  scrollByKey(el, -PAGE);
  assert.equal(el.scrollTop, 40);
  scrollByKey(el, -LINE); scrollByKey(el, -LINE);
  assert.equal(el.scrollTop, 0, 'never above the top');
  scrollByKey(el, Infinity);
  assert.equal(el.scrollTop, 2500, 'End is the last screenful');
  scrollByKey(el, PAGE);
  assert.equal(el.scrollTop, 2500, 'never past the bottom');
  scrollByKey(el, -Infinity);
  assert.equal(el.scrollTop, 0);
});

test('End is aimed again once it lands, so plates that grew as the scroll reached them still leave it at the bottom', (t) => {
  const window = page(t, '<div id="s"></div>');
  const el = window.document.getElementById('s');
  let content = 3000;
  Object.defineProperty(el, 'clientHeight', { value: 500 });
  Object.defineProperty(el, 'scrollHeight', { get: () => content });
  el.scrollTo = (o) => { el.scrollTop = o.top; };
  scrollByKey(el, Infinity, { smooth: true });
  assert.equal(el.scrollTop, 2500);
  content = 3200;
  el.dispatchEvent(new window.Event('scrollend'));
  assert.equal(el.scrollTop, 2700, 'the real bottom');
  el.dispatchEvent(new window.Event('scrollend'));
  scrollByKey(el, -LINE);
  content = 4000;
  el.dispatchEvent(new window.Event('scrollend'));
  assert.equal(el.scrollTop, 2660, 'a line, or the end already reached, leaves nothing waiting to snap it back');
});
