// Ported from Wrangler²'s public/job-keys.js (Copyright Charlie Goldstraw, Apache-2.0; see NOTICE),
// which is where its board's bare keys, labels and Voice words live. On Agent Wrangler's own board
// (public/board-voice.js) the same badges go on the board's buttons, tabs, session cards and dialogs:
// letters under the Keyboard labels setting, words under Voice, and saying one (job-voice.js) presses
// it as its key would. What follows is Wrangler²'s own account; its plates, chat key and proof viewer
// exist only on its Jobs view, and this board leaves them unused.
//
// The board's bare keys: 1–9 and then a to m (PLATE_LETTERS) open the jobs in the order the board shows them, `i` the Wrangler
// chat box on whatever is open, and on the board, an open job or step and every dialog of the view's
// own every other thing to click carries a letter label (`hint` items), the cheapest letters on what
// is pressed most (`hintRank`). The letters and `i`
// exist only under the Keyboard labels setting, and then a key acts only through a badge already
// drawn on screen beside what it hits: the badges are the keymap, and a key with no badge showing
// does nothing. Under Voice the same badges carry words instead of letters (`WORDS`), and saying one
// (job-voice.js) presses it as its key would.
//
// Modelled on Agent Wrangler's hint jump (public/hints.js, whose labels it deals): the badges sit in
// layers of their own, never inside a target, so its markup, text and press signature
// (press-sig.js pressSig) never change, and an SVG node can carry one as well.

import { pressSig } from './press-sig.js';
import { HINT_CHARS as BOARD_HINT_CHARS, hintLabels as boardHintLabels } from './hints.js';

// Agent Wrangler's HINT_CHARS, cheapest for the left hand first, without the keys spent here:
// `i` is the chat box and the digits are jobs, so neither may start a hint label; on the board the
// letters a plate has taken (PLATE_LETTERS) leave it too, at each sync, never HINT_RESERVED.
export const CHAT_KEY = 'i';
export const HINT_CHARS = BOARD_HINT_CHARS.replace(CHAT_KEY, '');
export const DIGITS = 9;
// The board's plates past the ninth, in alphabetical order without the chat key, but only a–m: n–z
// (HINT_RESERVED) are never a plate's, so however many jobs a tab shows (Finished has dozens) the
// board's own labels keep thirteen letters to start with. Plates taking the whole alphabet left
// hintLabels fewer than two letters, and every badge but the plates' vanished. Past the last, a plate
// has no key and its title (.job-plate-open) takes a hint label instead (jobs-view.js).
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.replace(CHAT_KEY, '');
export const HINT_RESERVED = 'nopqrstuvwxyz';
export const PLATE_LETTERS = LETTERS.slice(0, LETTERS.indexOf(HINT_RESERVED[0]));
export const plateKey = (n) => (n < DIGITS ? String(n + 1) : PLATE_LETTERS[n - DIGITS]);

// Which targets take the cheapest labels, by how often they are pressed: a dialog's primary and the
// session cards (the board's way into a session), then the ways to start one, then the rail's views
// and any tabs; anything not listed comes next, and the rail's other tools (usage, settings), set once
// and rarely pressed, last. Ties keep the order drawn.
export const HINT_USE = [
  '.primary, .session-card, .worker-row, .subagent-row',
  '.task-new-sess, #new-session, #new-task',
  '[data-view], [role="tab"]',
  null,
  '#nav-rail *',
];
export const hintRank = (el) => {
  const at = HINT_USE.findIndex((sel) => sel && el.matches(sel));
  return at < 0 ? HINT_USE.indexOf(null) : at;
};

// Voice's fallback labels, for a target with no word of its own (`BUTTON_WORDS`) or whose word
// another on screen has: clearest first and given out by hintRank as letters are, one syllable each,
// the first fifteen one per English vowel, and no two sharing a rhyme, a homophone, a letter's name
// or a digit's, so the few on screen at once stay far apart for a recognizer held to them. Past the
// last, a target takes no word.
export const WORDS = [
  'lamp', 'pond', 'ship', 'green', 'cake', 'bread', 'boat', 'moon', 'drum', 'shirt', 'kite', 'cloud', 'toy', 'hook', 'horse',
  'crab', 'park', 'milk', 'wheel', 'train', 'desk', 'gold', 'juice', 'glove', 'worm', 'knife', 'mouse', 'coin', 'wolf', 'fork',
  'king', 'belt', 'jug', 'bag', 'leaf', 'rope', 'soup', 'girl', 'lime', 'web', 'oil', 'foot', 'salt', 'nail', 'dice', 'zoo',
];

// Said at any time under Voice, never a badge, they scroll what is open (jobs-view.js): "up" and "down"
// by most of a screen, "upper" and "lower" by a few lines, "top" and "bottom" to either end. They keep to
// the same rules as WORDS, which is why "town" (down's rhyme) is not among them.
export const COMMANDS = ['up', 'down', 'upper', 'lower', 'top', 'bottom'];
export const FINE_PX = 120;
// How far a command scrolls a box, in pixels, down positive.
export function scrollStep(word, { scrollTop = 0, scrollHeight = 0, clientHeight = 0 }) {
  if (word === 'top') return 0 - scrollTop;
  if (word === 'bottom') return Math.max(0, scrollHeight - clientHeight - scrollTop);
  const dir = word === 'down' || word === 'lower' ? 1 : -1;
  return dir * (word === 'up' || word === 'down' ? Math.round(clientHeight * 0.7) : FINE_PX);
}

// The words the board's own buttons, links and tabs start with, so a badge can say what it is on
// (Approve takes "approve"): every one in the voice model's vocabulary, as the grammar is built from
// it once and never rebuilt, and none a fallback word, a command, a letter's name or a digit's. A
// target's text names it only through one of these: a job's title or a step's brief, written by an
// agent, would otherwise put any word at all on a badge the grammar cannot hear.
export const BUTTON_WORDS = [
  'approve', 'merge', 'retry', 'discard', 'accept', 'skip', 'cancel', 'close', 'open', 'back', 'save', 'send', 'reply', 'remove',
  'delete', 'edit', 'rename', 'copy', 'undo', 'restore', 'archive', 'dismiss', 'keep', 'continue', 'publish', 'attach', 'verify',
  'review', 'decide', 'resolve', 'start', 'stop', 'pause', 'paused', 'resume', 'next', 'previous', 'more', 'settings', 'proof',
  'idea', 'ideas', 'plan', 'steps', 'sessions', 'history', 'logs', 'jobs', 'agents', 'phone', 'theme', 'image', 'picture', 'shot',
  'flight', 'needs', 'running', 'backlog', 'finished', 'answer', 'pick', 'later', 'wrangler', 'conversation', 'details', 'everything', 'all',
  // Agent Wrangler's board: its rail, a session's panel, its dialogs and Settings' tabs, each checked
  // against the pinned model's own word list.
  'tasks', 'search', 'session', 'usage', 'terminal', 'restart', 'launch', 'snooze', 'diff', 'schedule', 'chat', 'files', 'message',
  'interrupt', 'appearance', 'automation', 'extensions', 'shortcuts', 'updates', 'done', 'keyboard', 'voice',
];

// Words a label starts with that name nothing ("Show me proof", "How Jobs works", "In flight").
const FILLER = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'its', 'my', 'your', 'to', 'of', 'in', 'on', 'for', 'and', 'or',
  'with', 'at', 'by', 'from', 'me', 'it', 'how', 'what', 'new', 'show', 'see', 'full', 'size']);
// A button's label is a few words: a longer one is prose (a check's line, a job's title, written by
// an agent) whose words, said, would take a real button's. Only the start of a label speaks for it,
// and nothing after a no ("Don't merge" is no Merge button).
const MOST = 4, LEAD = 3, NOT = new Set(['dont', 'not', 'no', 'never', 'without']);

// `el`'s own word, from what the human reads on it (its text, else its aria-label, title or a
// field's placeholder): the first of its leading words that is one of `vocab`, or ''.
export function targetWord(el, vocab = BUTTON_WORDS) {
  if (!el?.getAttribute) return '';
  const field = el.matches?.(FIELD);
  const said = [field ? '' : el.textContent, el.getAttribute('aria-label'), el.getAttribute('title'), field ? el.getAttribute('placeholder') : '']
    .find((t) => /[a-z]/i.test(t || '')) || '';
  const lead = said.toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '').split(/[^a-z]+/).filter((w) => w && !FILLER.has(w));
  if (lead.length > MOST) return '';
  const at = lead.slice(0, LEAD).findIndex((w) => vocab.includes(w) || NOT.has(w));
  return at < 0 || NOT.has(lead[at]) ? '' : lead[at];
}

// Words for `hints` (already in rank order), each keeping the word it had `before` (the last drawn
// `{el, label}`s) while `same` target holds it, so a redraw moves no word a human is about to say;
// the rest take their own word (`wordOf`) unless one on screen has it already, else the clearest
// fallback still free.
export function wordLabels(hints, before = [], { words = WORDS, own = BUTTON_WORDS, same = (a, b) => sameTarget(a, b), wordOf = (el) => targetWord(el, own) } = {}) {
  const taken = new Set(), out = new Map(), had = before.filter((b) => words.includes(b.label) || own.includes(b.label));
  const give = (h, w) => { out.set(h, w); taken.add(w); };
  // The very element first, then a twin drawn again: `before` is in the order drawn and `hints` in
  // rank, so a twin first would hand look-alikes (every tile's ⋯) each other's words at every sync.
  for (const h of hints) {
    const was = had.find((b) => b.el === h.el && !taken.has(b.label));
    if (was) give(h, was.label);
  }
  for (const h of hints) {
    const was = out.has(h) ? null : had.find((b) => !taken.has(b.label) && same(b.el, h.el));
    if (was) give(h, was.label);
  }
  for (const h of hints) {
    const w = out.has(h) ? '' : wordOf(h.el);
    if (w && own.includes(w) && !taken.has(w)) give(h, w);
  }
  const free = words.filter((w) => !taken.has(w));
  for (const h of hints) if (!out.has(h) && free.length) give(h, free.shift());
  return out;
}

// Agent Wrangler's own (public/hints.js): breadth-first and prefix-free, as many one-letter labels as
// fit, and only the overflow takes the cheapest letter as a prefix, so the first match is the only one.
export const hintLabels = (count, chars = HINT_CHARS) => boardHintLabels(count, chars);

// A key is the board's only bare: any modifier, a held repeat or an IME composition is someone else's.
export const bareKey = (e) => !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.repeat && !e.isComposing;
// A switch or button a label left focused takes no letters, so the next label still works.
export const typing = (el) => !!el?.closest?.('textarea, select, input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="file"], [type="image"], [type="range"], [type="color"]), [contenteditable]:not([contenteditable="false"])') || !!el?.isContentEditable;

// What Voice dictates into while it has focus (job-voice.js): somewhere to write prose, not a number,
// a date or a pick.
export const dictatable = (el) => !!el?.matches?.('textarea, input:is(:not([type]), [type="text"], [type="search"]), [contenteditable]:not([contenteditable="false"])') && !el.disabled && !el.readOnly;

// The keys that scroll whatever shows, since every bare letter is a plate's or a label's: ↑/↓ a line,
// PgUp/PgDn and Space/Shift+Space a page, Home/End the top or bottom. Unlike a letter they always work,
// held down too, and Shift goes only with Space. Null for any other key.
export const LINE = 40, PAGE = 0.9;
const SCROLLS = { ArrowUp: -LINE, ArrowDown: LINE, PageUp: -PAGE, PageDown: PAGE, Home: -Infinity, End: Infinity };
export function scrollKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return null;
  if (e.key === ' ') return e.shiftKey ? -PAGE : PAGE;
  return e.shiftKey ? null : SCROLLS[e.key] ?? null;
}
// What keeps these keys for itself: a widget its arrows or Home/End walk (tabs, radios, a menu, a list,
// a chart's points), or, for Space, any control it would press.
const WALKS = '[role="tablist"], [role="radiogroup"], [role="radio"], [role="menu"], [role="listbox"], [role="slider"], svg, input[type="range"]';
const PRESSES = 'a[href], button, summary, label, input, select, textarea, [role="button"], [role="tab"], [role="link"], [role="option"], [role="checkbox"], [role="switch"], [role="menuitem"]';
export const ownsScrollKey = (el, key) => !!el?.closest?.(key === ' ' ? `${WALKS}, ${PRESSES}` : WALKS);
// Scrolls `el` by a scrollKey: a page is PAGE of what shows of it, so a line of the last stays in view.
export function scrollByKey(el, step, { smooth = false } = {}) {
  const by = Math.abs(step) === PAGE ? Math.sign(step) * Math.round(el.clientHeight * PAGE) : step;
  const top = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + by));
  if (top === el.scrollTop) return;
  // Plates come on screen at their real height only as the scroll reaches them (content-visibility),
  // so an end aimed for before can fall short once it lands: it is aimed again then.
  if (!Number.isFinite(step)) el.addEventListener('scrollend', () => scrollByKey(el, step), { once: true });
  if (el.scrollTo) el.scrollTo({ top, behavior: smooth ? 'smooth' : 'instant' });
  else el.scrollTop = top;
}

// `el`'s rect once every scrolling ancestor and the viewport have clipped it, or null when too
// little is left to point at: a plate scrolled out of view, or one under display:none.
export function clippedRect(el) {
  const win = el.ownerDocument?.defaultView;
  if (!win || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  let [top, left, bottom, right] = [r.top, r.left, r.bottom, r.right];
  for (let p = el.parentElement; p && p !== el.ownerDocument.body; p = p.parentElement) {
    const st = win.getComputedStyle(p);
    if (st.overflow === 'visible' && st.overflowX === 'visible' && st.overflowY === 'visible') continue;
    const pr = p.getBoundingClientRect();
    top = Math.max(top, pr.top); left = Math.max(left, pr.left);
    bottom = Math.min(bottom, pr.bottom); right = Math.min(right, pr.right);
  }
  top = Math.max(top, 0); left = Math.max(left, 0);
  bottom = Math.min(bottom, win.innerHeight); right = Math.min(right, win.innerWidth);
  return bottom - top < 8 || right - left < 8 ? null : { top, left, bottom, right };
}

// What a letter label may reach on an open page: anything a pointer clicks, a checkbox or a file
// picker through its label (the input itself is drawn hidden: the Add idea box's picture button), a
// field to type into (a labelled one too, like the top bar's agents count), never a disabled one,
// the lent session panel or what a shut <details> hides (a browser still lays it out, where nothing
// shows). `also` adds the parts that act apart from the control they sit in (a place chip's ↗). A
// chart's points (controls in an SVG, New idea's Pareto front) take none: they sit too close for a
// badge, and Tab and the arrows already walk them.
const CHOICE = 'input:is([type="checkbox"], [type="radio"])';
const FIELD = 'textarea, select, input:not([type="checkbox"], [type="radio"], [type="hidden"], [type="button"], [type="submit"], [type="file"])';
const CLICKABLE = `a[href], button, summary, [role="button"], [role="tab"], [role="link"], [role="option"], [role="radio"], [role="checkbox"], label:has(${CHOICE}, input[type="file"]), ${CHOICE}, ${FIELD}`;
export const clickables = (root, also = '') => [...root.querySelectorAll(also ? `${CLICKABLE}, ${also}` : CLICKABLE)].filter((el) =>
  !el.matches(':disabled, [aria-disabled="true"], label:has(:disabled)') && !(el.matches(CHOICE) && el.closest('label'))
  && !el.closest('.job-mc-host, .xterm, .job-keys, [inert], [hidden], details:not([open]) > :not(summary), svg'));
// A field is focused, to type into; anything else is clicked as the pointer would.
export const reach = (el) => (el.matches(FIELD) ? el.focus() : el.click());

// clippedRect, and only while it is painted and takes the pointer (not visibility:hidden, under
// content-visibility:hidden or pointer-events:none, each of which leaves its box where it was) and
// nothing else is drawn over the label's corner of it (the page's sticky trail over a step scrolled
// under it, a popup): a badge is never drawn beside what it will not hit. The corner may land on an
// ancestor (an inline link's wrapped line), which is why the paint itself is asked first. The point
// tried sits a little way in, inside a round button's curve (a dialog's ×), which hit testing
// follows: its very corner is whatever lies behind it.
export function shownRect(el) {
  const r = clippedRect(el);
  if (!r || el.checkVisibility?.({ visibilityProperty: true }) === false || el.ownerDocument.defaultView.getComputedStyle(el).pointerEvents === 'none') return null;
  const inset = Math.min(12, Math.max(4, Math.min(r.right - r.left, r.bottom - r.top) * 0.3));
  const at = el.ownerDocument.elementFromPoint?.(Math.min(r.left + inset, r.right - 1), Math.min(r.top + inset, r.bottom - 1));
  return !at || el.contains(at) || at.contains(el) ? r : null;
}

// A label is given by place, so a redraw can hand it to another target: it hits only the same one
// (or its twin drawn again: same tag, data, action and words).
const sameTarget = (a, b) => a === b || (pressSig(a) === pressSig(b) && a.textContent.trim() === b.textContent.trim());

// How far a badge hangs over its target's corner, in its own size, and the least gap it keeps from the window's edge.
const HANG = 0.3, EDGE = 4, GAP = 2;
// How long a scroll must rest before the badges are dealt again. Not scrollend, which a notched wheel
// fires after every notch, so the letters would be dealt again between them mid-spin.
const STILL = 150;
// A press or a disclosure opening can start an animation that moves what follows (a <details> whose
// ::details-content grows), which no event reports on the page: the badges are dealt again this long after.
const AFTER = 300;
// What moves a target after the browser has drawn it, with no mutation, resize or scroll to say so.
const SETTLES = ['contentvisibilityautostatechange', 'transitionend', 'animationend', 'load'];

// `targets()` says what may carry a badge now: `{host, items: [{label, el, act(e), silent?, badge?, hint?, at?}]}`, `host`
// being the element the layer lives in (a modal dialog draws in the top layer, so its badges must be
// in it), or null when no key belongs to the board (the view hidden, another dialog open). Each item
// is drawn only while `rectOf(el)` finds it on screen, and a key acts only on a drawn badge; a
// `silent` item acts on whatever `targets()` gives it at the press, badge drawn or not, and draws one
// only with `badge` (still only where `rectOf` finds it), and its label, drawn or not, is a letter
// no hint label holds, so the hints stay prefix-free beside it. A `hint` item
// brings no label: the ones on screen take hintLabels by `rank` (lower first, ties in order), so
// labels stay short and the cheapest go where they are pressed most. A first
// letter that only starts labels narrows the badges to those, and the next letter picks one; a
// wrong letter or Esc (`press` keeps it) drops what was half typed. `at` is where on `el` its badge
// hangs, when its corner is not what the eye takes for it (a graph step's tile, not its wide box).
// `sync()` re-resolves; a redraw or resize of `watch` or of any `host` it has drawn in (a dialog
// stepping on), a window resize and any dialog opening or closing call it, as does the next frame
// after anything settles (`SETTLES`, a font loading) and a scroll coming to rest (none of them
// mid-scroll, while the badges ride the content: `frameOf`), and it touches
// the DOM only when a badge comes, goes or moves, so its own writes settle at once.
// `act(e, label)` is handed the label typed, for a hint that names it. While `voice()`, hints carry
// `wordLabels`, no letter is typed and `say(word)` is the press; `onWords(words)` hears each change
// of the words drawn, the only ones a word heard may press.
// `identity(el)`, where given, names a target whose text changes as it redraws (a session card's
// status and age): two elements with the same identity are the same target, whatever their text.
export function createKeys({ doc = document, targets, watch = [], rectOf = clippedRect, hintRectOf = shownRect, voice = () => false, onWords = () => {}, identity = () => null }) {
  const win = doc.defaultView;
  const same = (a, b) => { const x = identity(a); return x ? x === identity(b) : sameTarget(a, b); };
  // Each frame's badge layer (`null`: the window's, over the host), the badges drawn, a half-typed label.
  let layers = new Map(), drawn = [], typed = '', heard = '';
  // The box a target's badge rides in: a scroll event only comes once the compositor has already
  // moved what scrolled, so a badge placed from it trails its button a frame or more and snaps back.
  // A badge inside the scrolled content instead moves with it, painted in the same frame. That is the
  // nearest sticky or fixed box (which moves on its own), else the scroller's own box when it is
  // positioned, else the outermost positioned box under it that clips nothing (a plate's
  // overflow:hidden would cut a badge hanging over its corner), never past `host`; null when there is
  // none, or the walk meets a target (the layer's letters would join its text) or starts on a
  // sticky or fixed target, and its badge is placed against the window as before.
  function frameOf(el, host) {
    if (/^(sticky|fixed)$/.test(win.getComputedStyle(el).position)) return null;
    let under = null;
    for (let p = el.parentElement; p && p !== doc.body; p = p.parentElement) {
      if (p.matches(CLICKABLE)) return null;
      const st = win.getComputedStyle(p), placed = !!st.position && st.position !== 'static';
      if (st.position === 'sticky' || st.position === 'fixed') return p;
      if (/auto|scroll/.test(`${st.overflowX} ${st.overflowY}`)) return placed ? p : under;
      if (/hidden|clip/.test(`${st.overflowX} ${st.overflowY}`)) under = null;
      else if (placed) under = p;
      if (p === host) return under;
    }
    return null;
  }
  const layerFor = (frame) => {
    const l = doc.createElement('div');
    l.className = frame ? 'job-keys job-keys-in' : 'job-keys';
    l.setAttribute('aria-hidden', 'true');
    return l;
  };
  const dropLayers = () => { for (const l of layers.values()) l.remove(); layers = new Map(); };
  const marker = (label, word) => {
    const k = doc.createElement('kbd');
    k.className = word ? 'job-key job-key-word' : 'job-key';
    k.dataset.key = label;
    k.textContent = label;
    return k;
  };
  // The half-typed letters stay on the badges that still match, dimmed; the rest step aside.
  function paint(k, label) {
    const hide = !label.startsWith(typed);
    if (k.hidden !== hide) k.hidden = hide;
    const done = hide ? '' : typed;
    if ((k.dataset.typed || '') === done) return;
    if (done) k.dataset.typed = done; else delete k.dataset.typed;
    k.textContent = label.slice(done.length);
    if (done) { const t = doc.createElement('span'); t.className = 'job-key-typed'; t.textContent = done; k.prepend(t); }
  }
  // A hint keeps the label it had while it stays on screen (or its twin, drawn again in its place),
  // so a scroll bringing other targets in or out, or a plate settling to its real height, never
  // moves a letter under the human's eye: dealing afresh by rank at every sync changed the top bar's
  // letters several times in one PgDn. One scrolled away is remembered while it (or its twin) is still
  // drawn and gets its letter back, so PgDn then PgUp brings the top bar back as it was. Newcomers take
  // what is free, cheapest to the lowest rank, from the whole prefix-free set as many prefixes make
  // (every letter while one each fits), not just its first `hints.length`, which dropped a two-letter
  // label whenever a plate scrolled away; only a target whose letter becomes a prefix loses it.
  let dealt = new Map(), dealtHost = null, dealtFits = 0;
  const twinKey = (el) => identity(el) || `${pressSig(el)}\n${el.textContent.trim()}`;
  function deal(host, items, hints, chars) {
    const mem = new Map(), gone = new Map();
    for (const [el, label] of host === dealtHost ? dealt : []) {
      if (el.isConnected) mem.set(el, label);
      else gone.set(twinKey(el), [...(gone.get(twinKey(el)) || []), label]);
    }
    if (gone.size) for (const it of items) if (it.hint && !mem.has(it.el) && gone.get(twinKey(it.el))?.length) mem.set(it.el, gone.get(twinKey(it.el)).shift());
    // The set grows by a prefix rather than hand newcomers the letters of targets scrolled away (a
    // page of plates under the top bar), up to room for both, and shrinks back to cheaper labels only
    // once no target on screen holds one it would drop.
    const offered = new Set(items.map((it) => it.el));
    const placed = new Set(hints.map((it) => it.el));
    const held = new Set(hints.map((it) => mem.get(it.el)).filter(Boolean));
    const away = new Set([...mem].filter(([el]) => offered.has(el) && !placed.has(el)).map(([, label]) => label));
    const short = (pool) => hints.length > pool.length
      || (pool.length < dealtFits && [...held].some((l) => !pool.includes(l)))
      || (pool.length < hints.length + away.size && pool.filter((l) => !held.has(l) && !away.has(l)).length < hints.filter((it) => !pool.includes(mem.get(it.el))).length);
    let fits = chars.length, pool = hintLabels(fits, chars);
    while (chars.length > 1 && short(pool)) pool = hintLabels(fits += chars.length - 1, chars);
    const free = new Set(pool), labels = new Map();
    for (const it of hints) if (free.has(mem.get(it.el))) { labels.set(it, mem.get(it.el)); free.delete(mem.get(it.el)); }
    const left = pool.filter((l) => free.has(l)).sort((x, y) => away.has(x) - away.has(y));
    for (const it of hints) if (!labels.has(it) && left.length) labels.set(it, left.shift());
    const given = new Set(labels.values());
    dealt = new Map([...[...mem].filter(([el, label]) => !placed.has(el) && !given.has(label)), ...[...labels].map(([it, label]) => [it.el, label])]);
    dealtHost = host; dealtFits = fits;
    return labels;
  }
  function sync() {
    const { host = null, items = [] } = targets() || {};
    const placed = host ? items.filter((it) => !it.silent || it.badge).map((it) => ({ ...it, rect: (it.hint ? hintRectOf : rectOf)(it.at || it.el) })).filter((it) => it.rect) : [];
    const hints = placed.filter((it) => it.hint).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    const words = voice();
    const taken = new Set(items.filter((it) => it.silent).map((it) => it.label));
    // A hint with no label draws nothing; the board's plates never take HINT_RESERVED, so its hints always have letters.
    const labels = words ? wordLabels(hints, drawn, { same }) : deal(host, items, hints, [...HINT_CHARS].filter((c) => !taken.has(c)).join(''));
    const on = placed.map((it) => (it.hint ? { ...it, label: labels.get(it), word: words } : it)).filter((it) => it.label);
    const said = on.filter((it) => it.word).map((it) => it.label).sort().join(' ');
    if (said !== heard) { heard = said; onWords(said ? said.split(' ') : []); }
    if (typed && !on.some((it) => it.label.length > typed.length && it.label.startsWith(typed))) typed = '';
    if (host) watchEl(host);
    if (!on.length) { dropLayers(); drawn = []; return; }
    // A badge keeps its marker by label, moved to another frame's layer if its target now rides in one.
    const kept = new Map([...layers.values()].flatMap((l) => [...l.children]).map((k) => [k.dataset.key, k]));
    const next = new Map();
    drawn = on.map((it) => {
      const frame = frameOf(it.at || it.el, host);
      const layer = next.get(frame) || layers.get(frame) || layerFor(frame);
      next.set(frame, layer);
      if (layer.parentNode !== (frame || host)) (frame || host).appendChild(layer);
      const k = kept.get(it.label) || marker(it.label, it.word);
      kept.delete(it.label);
      if (k.parentNode !== layer) layer.appendChild(k);
      paint(k, it.label);
      return { ...it, frame, marker: k };
    });
    for (const k of kept.values()) k.remove();
    for (const [frame, l] of layers) if (next.get(frame) !== l) l.remove();
    layers = next;
    place(drawn);
  }
  // Measured once every badge is painted, so a sync costs one layout. Each hangs over its target's
  // top-left corner by a third of its own size and is placed against its layer's own box, so a
  // transformed ancestor (which makes it the containing block of a fixed layer) moves nothing, and
  // pushed back inside what shows of the window (a plate flush with its edge, or scrolled half
  // under it, would hang it off). One in a frame stays inside what shows of the frame too, and of
  // its scrolled extent, where a badge past the content's end would only stretch the scroll; a
  // scroll then carries it with the content until the badges are dealt again.
  function place(list) {
    function measure(l, frame) {
      const b = l.getBoundingClientRect();
      if (!frame) return { b, x0: 0, y0: 0, x1: win.innerWidth, y1: win.innerHeight };
      const f = frame.getBoundingClientRect();
      return { b, x0: Math.max(0, f.left, b.left), y0: Math.max(0, f.top, b.top), x1: Math.min(win.innerWidth, f.right, b.left + frame.scrollWidth), y1: Math.min(win.innerHeight, f.bottom, b.top + frame.scrollHeight) };
    }
    const bounds = new Map();
    const bound = (l, frame) => bounds.get(l) || bounds.set(l, measure(l, frame)).get(l);
    const sizes = list.map((d) => [d.marker.offsetWidth, d.marker.offsetHeight]);
    // Two targets closer than a badge (a row of icon buttons pushed in from an edge) would stack their
    // badges on each other: right to left, a badge that lands on one already placed steps to its left,
    // or below it where there is no room, so every word stays readable beside its own target.
    const taken = [];
    const hits = (x, y, w, h) => taken.find((t) => x < t.x + t.w + GAP && t.x < x + w + GAP && y < t.y + t.h + GAP && t.y < y + h + GAP);
    const order = list.map((d, i) => i).sort((p, q) => list[q].rect.left - list[p].rect.left);
    const at = new Map();
    for (const i of order) {
      const d = list[i];
      if (d.marker.hidden) continue;
      const [w, h] = sizes[i], { x0, y0, x1, y1 } = bound(d.marker.parentNode, d.frame);
      let x = Math.max(x0 + EDGE, Math.min(d.rect.left - w * HANG, x1 - w - EDGE));
      let y = Math.max(y0 + EDGE, Math.min(d.rect.top - h * HANG, y1 - h - EDGE));
      for (let n = 0, t; n < 4 && (t = hits(x, y, w, h)); n++) {
        if (t.x - w - GAP >= x0 + EDGE) x = t.x - w - GAP; else y = t.y + t.h + GAP;
      }
      taken.push({ x, y, w, h });
      at.set(i, [x, y]);
    }
    list.forEach((d, i) => {
      if (d.marker.hidden) return;
      const { b } = bound(d.marker.parentNode, d.frame), [x, y] = at.get(i);
      const left = `${Math.round(x - b.left)}px`, top = `${Math.round(y - b.top)}px`;
      if (d.marker.style.left !== left) d.marker.style.left = left;
      if (d.marker.style.top !== top) d.marker.style.top = top;
    });
  }
  // Mid-scroll only the badges with no frame to ride in follow their targets; the labels are dealt
  // again once the scroll rests, so a letter never jumps to another target while the human watches,
  // and nothing else (a plate coming on screen, a mutation) re-deals them before then.
  let still = 0;
  function follow() {
    const loose = drawn.filter((d) => !d.frame && !d.marker.hidden);
    for (const d of loose) d.rect = (d.hint ? hintRectOf : rectOf)(d.at || d.el) || d.rect;
    if (loose.length) place(loose);
  }
  const rested = () => { still = 0; sync(); };
  const scrolled = () => { follow(); win.clearTimeout(still); still = win.setTimeout(rested, STILL); };
  const later = () => { if (!still) sync(); };
  let afterT = 0;
  const again = () => { win?.clearTimeout(afterT); afterT = win?.setTimeout(() => { afterT = 0; later(); }, AFTER); };
  const toggled = () => { later(); again(); };
  // A key hits what its badge was already on, and still is once re-resolved (a dialog opened
  // or the target redrawn since): a badge not drawn both times leaves the key to anyone else.
  function press(e) {
    if (e.key === 'Escape') {
      if (!typed) return false;
      e.preventDefault(); typed = ''; sync();
      return true;
    }
    const silent = targets()?.items?.find((it) => it.silent && it.label === e.key);
    if (silent) { e.preventDefault(); typed = ''; sync(); silent.act(e); return true; }
    if (e.key.length !== 1 || voice()) return false;
    const want = typed + e.key;
    const was = drawn.find((d) => d.label === want);
    if (!was) {
      const narrows = drawn.some((d) => d.label.startsWith(want));
      if (!narrows && !typed) return false;
      // Mid-label, a letter no badge goes on is a slip, not a key for anyone else.
      e.preventDefault(); typed = narrows ? want : ''; sync();
      return true;
    }
    typed = '';
    sync();
    const hit = drawn.find((d) => d.label === want);
    if (!hit || hit.marker !== was.marker || (was.hint && !same(hit.el, was.el))) return false;
    e.preventDefault();
    hit.act(e, hit.label);
    again();
    return true;
  }
  // A word heard presses what its badge was on, on the same terms as a key: drawn before it was heard
  // and still on the same target once re-resolved. `e` stands in for the key's event.
  function say(word, e = { key: word, voice: true, preventDefault() {} }) {
    const was = drawn.find((d) => d.word && d.label === word);
    if (!was) return false;
    sync();
    const hit = drawn.find((d) => d.word && d.label === word);
    if (!hit || hit.marker !== was.marker || !same(hit.el, was.el)) return false;
    hit.act(e, hit.label);
    again();
    return true;
  }
  // A layer's own writes, and a layer put into or taken out of its frame, are not a change to the view.
  const ours = (n) => !!(n.closest ? n : n.parentElement)?.closest('.job-keys');
  const layerOnly = (r) => { const nodes = [...r.addedNodes, ...r.removedNodes]; return nodes.length > 0 && nodes.every((n) => n.classList?.contains('job-keys')); };
  const observer = typeof win?.MutationObserver === 'function' ? new win.MutationObserver((records) => {
    if (records.some((r) => !ours(r.target) && !layerOnly(r))) later();
  }) : null;
  // Core shows and hides a view by a class on an ancestor, which no mutation here reports: the
  // view's box going to nothing and back does.
  const resized = typeof win?.ResizeObserver === 'function' ? new win.ResizeObserver(later) : null;
  const watched = new WeakSet();
  function watchEl(el) {
    if (watched.has(el)) return;
    watched.add(el);
    observer?.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'open'] });
    resized?.observe(el);
  }
  for (const el of watch) watchEl(el);
  const reflow = later;
  win?.addEventListener('scroll', scrolled, true);
  win?.addEventListener('resize', reflow);
  // Any dialog opening or closing (the intro, a yolo ask) hands the keys over or back.
  doc.addEventListener('toggle', toggled, true);
  doc.addEventListener('close', reflow, true);
  // Targets also move with no mutation, resize or scroll: a plate just drawn is measured inside its
  // content-visibility placeholder and takes its real height only once the browser finds it on screen,
  // a fade or slide ends, a thumbnail or a font comes in. Each re-syncs on the next frame, once for a
  // burst (a tab of plates fires one per plate), so nothing polls.
  let settling = 0;
  const settle = () => { if (!settling) settling = win.requestAnimationFrame(() => { settling = 0; later(); }); };
  for (const type of SETTLES) doc.addEventListener(type, settle, true);
  doc.fonts?.addEventListener?.('loadingdone', settle);
  return {
    sync, press, say,
    drawn: () => drawn.map((d) => ({ label: d.label, el: d.el })),
    typed: () => typed,
    dispose() {
      typed = ''; heard = ''; observer?.disconnect(); resized?.disconnect(); win?.removeEventListener('scroll', scrolled, true); win?.removeEventListener('resize', reflow); doc.removeEventListener('toggle', toggled, true); doc.removeEventListener('close', reflow, true);
      for (const type of SETTLES) doc.removeEventListener(type, settle, true);
      doc.fonts?.removeEventListener?.('loadingdone', settle);
      if (settling) win.cancelAnimationFrame(settling);
      win?.clearTimeout(still); win?.clearTimeout(afterT);
      settling = still = 0; dropLayers(); drawn = []; dealt = new Map(); dealtHost = null; dealtFits = 0;
    },
  };
}
