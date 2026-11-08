// Speaking into a text box under Voice labels (ported from Wrangler²): the box with focus records
// (board-voice.js `syncDictation`), and words go in at the cursor as Apple's SpeechTranscriber hears them
// (voice-speech.js, server/speech.js), partial words replaced as they firm up. Enter (or ⌘↵) waits for
// the final words and then does what it would have; leaving the box, Esc, or the escape word
// (Settings › Shortcuts, "lamp" unless changed) stops, and what is said after that word presses as the
// labels would have heard it. Where the helper cannot run (not macOS 26, no swiftc, a failed build,
// SpeechTranscriber unavailable) the box falls back to the Mac's own Dictation, started by a menu
// click (dictation.js), and the status line says why. Off a Mac (the server says `not-mac`) there is
// neither, so the box records with Vosk's model in the browser instead (voice-local.js, `local`). A box
// a redraw replaced is found again by its label, so words keep landing. Typing, or moving the cursor
// there by key or pointer, stops listening for good while the box keeps focus: each partial rewrites
// from where recording began, so it would overwrite the edit.

export const DEFAULT_ESCAPE_WORD = 'lamp';
// The setting, the whole phrase; snapshots from before it, or a blank one, read the default.
const wordOr = (word) => (typeof word === 'string' && word.trim()) || DEFAULT_ESCAPE_WORD;
export const escapeWordOf = (s) => wordOr(s?.escapeWord);
// Said anywhere in what was heard, it leaves the box, as Esc does, in any case and punctuated as the
// transcriber likes ("Lamp.", "limit, lamp.", "Escape, escape!"). It must stand as words of its own:
// "flamp" and "lampshade" are prose. Not only at the end: the server keeps the latest partial of a
// burst, so "Watch this: lamp start" said quickly arrives whole, and the next word is already there.
const escapeRe = (word) => new RegExp(`(?:^|[\\s,]+)${word.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s,.!?]+')}(?=[\\s,.!?;:]*(?:$|\\s))`, 'gi');
// `kept` is what came before the word, `rest` what came after it. `atEnd`: only the last, with nothing after.
export function escapeAt(text, word = DEFAULT_ESCAPE_WORD, { atEnd = false } = {}) {
  const all = [...String(text ?? '').matchAll(escapeRe(wordOr(word)))], m = atEnd ? all.at(-1) : all[0];
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length).replace(/^[\s,.!?;:]+/, '');
  return atEnd && rest ? null : { kept: text.slice(0, m.index), rest };
}
export const exitTyped = (value, word) => escapeAt(value, word)?.kept ?? null;
// The words said after the escape word, as the labels' recognizer names them: lowercase, unpunctuated.
export const wordsOf = (rest) => String(rest ?? '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);

// Why the helper stays down for the rest of the page's life, so later boxes go straight to Dictation.
const LASTING = new Set(['not-mac', 'old-macos', 'no-swiftc', 'build-failed', 'unavailable', 'no-locale', 'no-format', 'spawn']);

// Where spoken words go: between what was before and after the cursor when recording began.
export const anchorOf = (el) => ({ before: el.value.slice(0, el.selectionStart ?? el.value.length), after: el.value.slice(el.selectionEnd ?? el.value.length) });
// A box started for the human: caret at the end FIRST, since focus starts a recording anchored there.
export const focusAtEnd = (el) => { el.setSelectionRange?.(el.value.length, el.value.length); el.focus(); };
// Mid-sentence, the transcriber's own capital and full stop go: "Please Add a retry button. on the
// page" becomes "Please add a retry button on the page".
export function spliceAt({ before, after }, text) {
  let words = text.trim();
  if (!words) return { value: before + after, caret: before.length };
  if (before.trim() && !/[.!?:]\s*$/.test(before) && /^[A-Z](?![A-Z])/.test(words) && !/^I\b/.test(words)) words = words[0].toLowerCase() + words.slice(1);
  if (/^\s*[a-z]/.test(after)) words = words.replace(/[.!?]$/, '');
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const tail = after && !/^[\s.,!?;:]/.test(after) ? ' ' : '';
  const head = before + lead + words;
  return { value: head + tail + after, caret: head.length };
}

export const fmt = (ms) => (ms == null ? '?' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const keyOf = (el) => ({ tag: el.tagName, label: el.getAttribute('aria-label'), name: el.getAttribute('name') });
const sameKey = (a, b) => a.tag === b.tag && a.label === b.label && a.name === b.name;
// A redraw's replacement for a box that is gone is that box.
export const sameBox = (was, now) => was === now || (!!was && !!now && !was.isConnected && sameKey(keyOf(was), keyOf(now)));
// Keys that edit the box or move its cursor. Not Esc or Tab, which leave it; not Enter, which sends
// (Shift+Enter and an IME's commit edit); and of a ⌘/⌃ chord only the cursor's and select-all: paste,
// cut and undo arrive as their own events.
const LEAVES = new Set(['Shift', 'Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'Escape', 'Tab']);
const CHORD_CARET = /^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Backspace|Delete|a|A)$/;
export const editKey = (e) => !LEAVES.has(e.key) && !(e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.isComposing)
  && (!(e.metaKey || e.ctrlKey) || CHORD_CARET.test(e.key));
export const EDITED_NOTE = 'Stopped listening — you’re editing. Leave the box and come back to it to dictate again';

// `escapeWord()` is the phrase that leaves the box, read as each word is heard; `onExit(el, words)`
// leaves it and presses the words said after the escape word; `onAfter(words)` presses words after it
// that firm up only once the box was left (a later partial, the final); `onChange()` hears every
// change of state, for the
// top bar's mic; `log` each recording's latency.
export function createVoiceBox({ doc = document, speech, local = null, escapeWord = () => DEFAULT_ESCAPE_WORD, dictation, onExit = (el) => el?.blur(), onAfter = () => {}, onChange = () => {}, log = (...a) => console.info('[voice]', ...a), now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  const win = doc.defaultView ?? globalThis;
  const hud = doc.createElement('div');
  hud.className = 'voice-hud';
  hud.hidden = true;
  hud.setAttribute('role', 'status');
  hud.setAttribute('aria-live', 'polite');
  doc.body.appendChild(hud);
  // `paused`: the box an edit stopped, still focused; it records again only once left and refocused.
  let active = null, paused = null, helperDown = null, last = null, hudTimer = null;

  function locate(a = active || paused) {
    if (!a || a.el.isConnected) return a?.el;
    const found = [...doc.querySelectorAll(a.key.tag)].find((t) => { const k = keyOf(t); return k.label === a.key.label && k.name === a.key.name; });
    if (found) a.el = found;
    return a.el;
  }
  function place() {
    const el = locate();
    if (hud.hidden || !el?.isConnected) return;
    const r = el.getBoundingClientRect();
    hud.style.left = `${Math.max(8, r.left)}px`;
    hud.style.top = `${Math.max(8, r.top - hud.offsetHeight - 6)}px`;
    hud.style.maxWidth = `${Math.max(240, r.width)}px`;
  }
  // In a modal dialog (New idea) the line goes in it, or the top layer would hide it; a redraw of the
  // dialog takes it out with the rest.
  function rehost() {
    const host = locate()?.closest('dialog[open]') || doc.body;
    if (hud.parentNode !== host) host.appendChild(hud);
    place();
  }
  function say(text, tone = '') {
    clearTimer(hudTimer);
    hud.textContent = text;
    hud.dataset.tone = tone;
    hud.hidden = !text;
    rehost();
  }
  const set = (a, state) => { a.state = state; onChange(); };

  function write(a, text) {
    const el = locate(a);
    if (!el || a.edited) return;
    const { value, caret } = spliceAt(a.anchor, text);
    if (el.value === value) return;
    el.value = value;
    if (doc.activeElement === el) el.setSelectionRange?.(caret, caret);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  }
  function finish(a, note = '') {
    if (active !== a) return;
    active = null;
    a.input && a.el.removeEventListener('input', a.input);
    // A box gone from view leaves no note floating where it was.
    if (note && locate(a)?.getClientRects().length) { say(note, 'done'); hudTimer = setTimer(() => { hud.hidden = true; }, 5000); } else hud.hidden = true;
    onChange();
  }
  // Partial words in, until the escape word: only what came before it stays, the box is left at once
  // (its blur stops the recording) and nothing more is written. The words after it, then and in every
  // later partial or final of this recording, go to the labels, each once: by position, so one that
  // firms up into another word ("star", then "start") is handed again.
  function heard(a, text) {
    if (a.firstAt == null && text.trim()) a.firstAt = now();
    const cut = escapeAt(text, escapeWord());
    if (!a.exited) {
      write(a, cut ? cut.kept : text);
      if (!cut) return;
      a.exited = true;
      a.handed = wordsOf(cut.rest);
      onExit(locate(a), [...a.handed]);
      return;
    }
    if (cut) handOn(a, wordsOf(cut.rest));
  }
  function handOn(a, words) {
    const fresh = words.filter((w, i) => a.handed[i] !== w);
    words.forEach((w, i) => { a.handed[i] = w; });
    if (fresh.length) onAfter(fresh);
  }
  function startDictation(a, why) {
    set(a, 'dictation');
    const el = locate(a);
    say(`Apple’s speech helper can’t run here: ${why.error}. Using macOS Dictation.`, 'warn');
    // Dictation types into the box itself; the escape word is watched for in what it typed (between
    // what was before and after the cursor when it began, once any composition ends). What came after
    // the word is taken out and pressed, and so is anything it types once the box was left. A box edited
    // out of that shape is only watched at its end, as a word said before Dictation would otherwise leave.
    const valueOf = () => ('value' in a.el ? a.el.value : a.el.textContent) ?? '';
    a.typed = a.anchor ?? { before: valueOf(), after: '' };
    a.input = (e) => {
      if (e.isComposing || active !== a) return;
      const value = valueOf(), { before, after } = a.typed;
      const fits = value.length >= before.length + after.length && value.startsWith(before) && value.endsWith(after);
      const typed = fits ? value.slice(before.length, value.length - after.length) : value;
      let kept, words;
      if (a.exited) { if (!fits || !typed) return; kept = ''; words = wordsOf(typed); } else {
        const cut = escapeAt(typed, escapeWord(), { atEnd: !fits });
        if (!cut) return;
        kept = cut.kept; words = wordsOf(cut.rest);
      }
      const left = fits ? before + kept + after : kept, was = a.exited;
      if (fits) a.typed = { before: before + kept, after };
      a.exited = true;
      if ('value' in a.el) a.el.value = left; else a.el.textContent = left;
      a.el.dispatchEvent(new win.Event('input', { bubbles: true }));
      if (!was) onExit(a.el, words); else if (words.length) onAfter(words);
    };
    el.addEventListener('input', a.input);
    dictation.start(el).then((r) => {
      if (active !== a) return;
      if (r.ok) say(`macOS Dictation is listening (Apple’s speech helper can’t run here: ${why.error})`, 'warn');
      else say(`Apple’s speech helper can’t run here (${why.error}), and macOS Dictation did not start: ${r.error}`, 'bad');
    });
  }
  function event(a, e) {
    if (active !== a) return;
    if (e.kind === 'building') say('Building Apple’s speech helper (first use only)…');
    else if (e.kind === 'installing') say('macOS is checking its English speech model…');
    else if (e.kind === 'ready') { set(a, 'listening'); say(`Listening ${a.local ? 'in this browser, with Vosk' : 'on this Mac'} — Enter sends, Esc or “${wordOr(escapeWord())}” leaves the box`, 'live'); }
    else if (e.kind === 'partial') heard(a, e.text);
    else if (e.kind === 'final' && !a.stopping) { heard(a, e.text); finish(a); }
    else if (e.kind === 'error' && !a.stopping) {
      // Not a Mac: no helper and no Dictation, so the box records in the browser from now on.
      if (e.reason === 'not-mac' && local && !a.local) { helperDown = e; say('Starting…'); record(a, local); return; }
      if (a.local) { set(a, 'failed'); finish(a, `Vosk could not listen here: ${e.error}`); return; }
      log(`speech helper unavailable (${e.reason}): ${e.error}`);
      if (LASTING.has(e.reason)) helperDown = e;
      startDictation(a, e);
    }
  }

  // The cursor is the human's now: the recording is dropped, not finalised, so no later words land
  // and their edit stands as typed.
  function edited(a) {
    if (a.edited) return;
    a.edited = true;
    clearTimer(a.leaving);
    a.rec?.cancel();
    if (active === a) active = null;
    paused = a;
    say(EDITED_NOTE, 'done');
    onChange();
  }

  async function start(el) {
    if (active) await stop();
    if (active) return;
    paused = null;
    const a = active = { el, key: keyOf(el), anchor: 'value' in el ? anchorOf(el) : null, state: 'starting', firstAt: null, startAt: now(), stopping: false, exited: false };
    onChange();
    const inBrowser = !!local && helperDown?.reason === 'not-mac';
    // Only a field with a value takes spliced words; anything else is Dictation's to type into, on a Mac.
    if (!a.anchor && inBrowser) { set(a, 'failed'); return finish(a, 'Voice types only into a plain text box here: macOS Dictation, which fills the others, is Mac-only'); }
    if (!inBrowser && (helperDown || !a.anchor)) return startDictation(a, helperDown || { error: 'this box takes only typed text' });
    say('Starting…');
    return record(a, inBrowser ? local : speech);
  }
  // A recording through the server's helper (`speech`) or in the browser (`local`), one at a time.
  async function record(a, via) {
    a.local = via === local;
    a.rec = via.record({ onEvent: (e) => event(a, e) });
    try { await a.rec.open(); } catch (err) {
      if (active === a && !a.edited) { set(a, 'failed'); finish(a, err?.name === 'NotAllowedError' ? 'The microphone was refused' : String(err?.message || err)); }
    }
  }
  function stop() {
    const a = active;
    if (!a && paused) { paused = null; clearTimer(hudTimer); hud.hidden = true; }
    if (!a || a.stopping) return a?.stopped ?? Promise.resolve();
    a.stopping = true;
    a.stopped = (async () => {
      let note = '';
      if (a.state === 'dictation') dictation.stop(locate(a));
      else if (a.rec) {
        const at = now(), e = await a.rec.stop();
        if (e.kind === 'final') {
          heard(a, e.text);
          const afterStop = Math.round(now() - at);
          last = { first: a.firstAt == null ? null : a.firstAt - a.startAt, afterStop };
          log(`final text ${afterStop}ms after stop (helper: ${e.afterStop ?? '?'}ms), first words ${fmt(last.first)} after start`);
          note = `Final text ${fmt(afterStop)} after you stopped`;
        }
      }
      finish(a, note);
    })();
    return a.stopped;
  }

  const own = new WeakSet();
  // Enter, plain or with ⌘/⌃, waits for the last words and then does what it would have. A synthetic
  // Enter types nothing, so a newline nothing took is put in by hand, and the box listens again,
  // unless the Enter sent its words (it emptied the box): that box is left, as the escape word leaves.
  doc.addEventListener('keydown', (e) => {
    const a = active;
    if (!a || a.state === 'dictation' || own.has(e) || e.target !== locate(a) || e.key !== 'Enter' || e.shiftKey || e.altKey || e.isComposing) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const { metaKey, ctrlKey } = e;
    stop().then(() => {
      const el = locate(a);
      if (!el?.isConnected) return;
      const again = new win.KeyboardEvent('keydown', { key: 'Enter', metaKey, ctrlKey, bubbles: true, cancelable: true });
      own.add(again);
      const had = !!el.value?.trim();
      el.dispatchEvent(again);
      if (!again.defaultPrevented && !metaKey && !ctrlKey && el.matches('textarea') && el.isConnected) {
        el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
        el.dispatchEvent(new win.Event('input', { bubbles: true }));
      }
      const left = locate(a), sent = had && again.defaultPrevented && !left?.value?.trim();
      if (sent) { if (left && doc.activeElement === left) onExit(left, []); return; }
      if (!active && !a.edited && doc.activeElement === el) start(el);
    });
  }, true);
  const editing = (e, key = false) => {
    const a = active;
    if (!a || a.state === 'dictation' || own.has(e)) return;
    const el = locate(a);
    if (el && el.contains(e.target) && (!key || editKey(e))) edited(a);
  };
  doc.addEventListener('keydown', (e) => editing(e, true), true);
  // A press in the box places the cursor or starts a selection; the one that focused it came first.
  for (const type of ['pointerdown', 'paste', 'cut', 'drop', 'beforeinput']) doc.addEventListener(type, (e) => editing(e), true);
  win.addEventListener('scroll', place, true);
  win.addEventListener('resize', place);

  return {
    start,
    stop,
    // The box recording now, by whichever way: speech (starting, listening) or dictation.
    get active() { return active && { el: locate(), state: active.state, local: !!active.local }; },
    // The focused box an edit stopped listening to.
    get paused() { return active || !paused ? null : { el: locate(paused) }; },
    // `el` is a redraw's replacement for the box recording (or paused): it carries on there.
    follow(el) {
      const a = active || paused;
      if (!a || !sameBox(a.el, el)) return;
      a.el = el;
      if (!hud.hidden) rehost();
    },
    get helperDown() { return helperDown; },
    // Voice's setup found the helper cannot run (voice-setup.js): boxes go straight to Dictation, or
    // off a Mac to Vosk in the browser.
    helperFailed(e) { if (LASTING.has(e?.reason)) helperDown = e; },
    // The last recording's time to first words and to final text after its stop.
    get last() { return last; },
  };
}
