// Voice on Agent Wrangler's own board: Wrangler²'s Voice (Copyright Charlie Goldstraw, Apache-2.0;
// see NOTICE), ported from its jobs-view.js onto the board's hint targets. This module is the whole
// integration: app.js only creates it, hands it the control socket's `voice:` replies and tells it
// when a setting changed.
//
// - Settings › Shortcuts › Labels (voice-settings.js, label-modes.js): Off draws nothing (⌃⌘A still
//   jumps to a session), Keyboard draws letters, Voice draws words, on everything a pointer would
//   press: the rail, the session cards and every button on the board, a session's panel, an open
//   dialog or card menu (job-keys.js `createKeys`, dealing public/hints.js's letters).
// - Under Voice (job-voice.js) Vosk hears the words drawn, on this machine only, through one shared
//   mic (voice-mic.js, voice-worklet.js) held by a grammar of every word a badge can carry plus the
//   decoys; "up", "down", "upper", "lower", "top" and "bottom" scroll what is in front.
// - The model is never fetched by itself: turning Voice on asks the server whether it holds the
//   pinned file, and only the warning's Download (voice-consent.js) fetches it, kept only if it hashes
//   to the pin (server/voice-model.js), and hashed again here before Vosk reads it.
// - Turning Voice on also sets up Apple's speech helper and macOS's English model
//   (voice-setup.js, server/speech.js), with progress round the rail's mic and in a panel beside it,
//   and no label is drawn until that is done.
// - A focused text box records into the box at the cursor through the helper (voice-box.js,
//   voice-speech.js), Dictation where it cannot run (dictation.js, server/dictation.js); the escape
//   word (Settings › Shortcuts › Voice escape word) leaves the box and hands what follows to the labels.
// - A link a heard word presses opens through the server (voice-open.js), since the recognizer's
//   callback carries no user activation for the popup blocker.
// - While Wrangler²'s Jobs view is in front, its own Voice keeps the mic: this one stops, draws
//   nothing and starts again when the board is back.
// Never the browser's Web Speech API, which sends audio away.
import { createKeys, clickables, reach, bareKey, typing, dictatable, hintRank, COMMANDS, scrollStep } from './job-keys.js';
import { labelsOf } from './label-modes.js';
import { createVoice } from './job-voice.js';
import { createModelAsk, prepareModel, modelSize, DECLINED } from './voice-consent.js';
import { createVoiceBox, escapeWordOf, fmt, sameBox } from './voice-box.js';
import { createMic } from './voice-mic.js';
import { createSpeech } from './voice-speech.js';
import { createDictation } from './dictation.js';
import { createSetupSteps, createHelperSetup, setupHtml } from './voice-setup.js';
import { createHeardOpener } from './voice-open.js';

// Wrangler²'s control messages, as this board's server names them (server/voice-handlers.js).
export const OUT_TYPES = { 'voice-model': 'voice:model', speech: 'voice:speech', dictation: 'voice:dictation', 'job-open-url': 'voice:open-url' };
// The view that has a Voice of its own.
export const JOBS_VIEW = '#ext-views > .ext-view[data-view^="ext:jobs:"]:not(.hidden)';
// What the board shows besides a dialog: the rail, the board or Search or another view, a session's
// panel and the diff. Never the terminal (job-keys.js `clickables` leaves out `.xterm`).
const SURFACES = ['#nav-rail', '#grid:not(.hidden)', '#search:not(.hidden)', '#ext-views > .ext-view:not(.hidden)', '#diff-panel:not([hidden])', '#panel', '#panel-sections', '#chat-wrap:not([hidden])'];
// A board dialog is a div toggled by `.hidden`, or a <dialog> (util.js anyModalOpen).
const MODALS = '#modal, [id$="-modal"], dialog.job-voice-ask';
// A slider's stops (the dispatch dialog's model curve) sit too close for a badge each; its arrows walk them.
const SKIP = '.model-front-stops';
const MIC_SVG = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>';

export const isOpen = (el) => (el.tagName === 'DIALOG' ? el.open : !el.classList.contains('hidden') && !el.hidden);
// A session card, worker row or sub-agent row redraws with new text (its status, its age) on every
// tick: its id says it is the same target, so its word stays put.
export function identity(el) {
  if (el?.matches?.('.session-card, .worker-row:not(.team-row)') && el.dataset.sid) return `s:${el.dataset.sid}`;
  if (el?.matches?.('.team-row') && el.dataset.leadSid) return `team:${el.dataset.leadSid}`;
  if (el?.matches?.('.subagent-row') && el.dataset.subagentId) return `sa:${el.dataset.ownerSid}/${el.dataset.subagentId}`;
  return null;
}
// What scrolls in `root`: itself, else the tallest scroller showing inside it.
export function scrollerIn(root, win = root.ownerDocument.defaultView) {
  const scrolls = (el) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(win.getComputedStyle(el).overflowY);
  if (scrolls(root)) return root;
  let best = null;
  for (const el of root.querySelectorAll('*')) if (el.getClientRects().length && scrolls(el) && !el.closest('.xterm') && (!best || el.clientHeight > best.clientHeight)) best = el;
  return best;
}

// `send` the control socket, `getSetting`/`setSetting` settings.js's, `toast(text, error?)` the board's.
export function initBoardVoice({ send, getSetting, setSetting, toast = () => {}, doc = document }) {
  const win = doc.defaultView;
  const css = doc.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'voice.css';
  doc.head.appendChild(css);
  // Voice may start with the page, before the control socket is open: what could not go yet waits for
  // the socket's first frame (`take`), a few at most, never audio.
  const outbox = [];
  const vsend = (m) => {
    const msg = { ...m, type: OUT_TYPES[m.type] || m.type };
    let sent = false;
    try { sent = send(msg) !== false; } catch { sent = false; }
    if (!sent && m.op !== 'audio' && outbox.length < 20) outbox.push(msg);
  };
  const flush = () => { while (outbox.length) { const m = outbox.shift(); let ok = false; try { ok = send(m) !== false; } catch { ok = false; } if (!ok) { outbox.unshift(m); return; } } };
  const labels = () => labelsOf({ labels: getSetting('labels') });
  const settings = () => ({ escapeWord: getSetting('escapeWord') });
  const yielding = () => !!doc.querySelector(JOBS_VIEW);
  // The mode in force: the setting, but none while the Jobs view's own Voice has the mic.
  const mode = () => (yielding() ? 'off' : labels());
  const calm = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // The rail's mic: dim while Voice is off (a click turns it on), red while it is on (a click turns it off).
  const mic = doc.createElement('button');
  mic.id = 'voice-mic';
  mic.type = 'button';
  mic.className = 'voice-mic';
  mic.innerHTML = MIC_SVG;
  (doc.querySelector('#nav-rail .rail-bottom') || doc.body).prepend(mic);
  const panel = doc.createElement('div');
  panel.id = 'voice-setup';
  panel.className = 'voice-setup';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.hidden = true;
  doc.body.appendChild(panel);

  // Every new tab goes through here, so one a word heard by Voice opens survives the popup blocker.
  const opener = createHeardOpener({ doc, send: vsend, open: (url) => win.open(url, '_blank', 'noopener'), refuse: () => toast('Voice opens only http and https links', true) });
  // The board opens tabs with window.open as well as links: while a heard word presses, each goes out
  // through the server too.
  const withOpener = (press) => opener.heard(() => {
    const own = win.open;
    win.open = (url) => { opener.open(String(url)); return null; };
    try { return press(); } finally { win.open = own; }
  });
  const modelAsk = createModelAsk({ doc });
  const modelWait = { check: null, download: null };
  // What Voice sets up when turned on (voice-setup.js), painted on the mic and in a panel beside it.
  const setupSteps = createSetupSteps({ onChange: () => paint() });
  const helperSetup = createHelperSetup({ send: vsend, steps: setupSteps });
  let keys = null, voice = null, voiceBox = null, voiceState = ['off'], heard = null, voiceMode = 'off', dictating = null, held = false, helperReady = null;
  // No label is drawn while Voice sets up: a word could press nothing yet, and the first box would wait.
  const settingUp = () => mode() === 'voice' && (voiceState[0] === 'loading' || (voiceState[0] === 'dictating' && !setupSteps.done));

  function paint() {
    const on = mode() === 'voice';
    // Only a change of setting starts or stops the mic: one that failed stays off until Voice is picked again.
    if (voice && mode() !== voiceMode) {
      voiceMode = mode();
      if (on) { if (!helperReady) setupSteps.reset(); voice.start(); } else { modelAsk.close(); voice.stop(); heard = null; }
      syncDictation();
      queueMicrotask(() => keys?.sync());
    }
    if (held !== settingUp()) { held = !held; queueMicrotask(() => keys?.sync()); }
    const [state, why] = voiceState;
    mic.dataset.voice = on ? state : yielding() && labels() === 'voice' ? 'yielded' : 'off';
    const steps = setupSteps.steps, at = steps.findIndex((x) => x.state === 'active') + 1, step = steps[at - 1];
    if (on && state === 'loading') mic.style.setProperty('--voice-setup', setupSteps.progress.toFixed(3)); else mic.style.removeProperty('--voice-setup');
    const doing = !on ? (yielding() && labels() === 'voice' ? 'The Jobs view is in front, so its own Voice has the microphone' : 'Voice is off')
      : state === 'loading' && modelAsk.asking ? 'Not listening yet: waiting for you to allow the voice model’s download'
      : state === 'loading' && modelWait.download ? `Setting up Voice (1 of 3): downloading the voice model (${modelSize()}, once, then kept on this computer)`
      : state === 'loading' && step ? `Setting up Voice (${at} of 3): ${step.label}${step.note ? `, ${step.note}` : ''}`
      : state === 'loading' ? 'Setting up Voice'
      : state === 'declined' ? `${DECLINED}. Pick Voice again to be asked again`
      : state === 'waiting' ? 'Click anywhere to start listening'
      : state === 'paused' ? 'Paused: Wrangler isn’t focused, so nothing said presses or scrolls. Words work again as soon as you come back to it'
      : state === 'failed' ? `Voice failed: ${why}`
      : state === 'dictating' && voiceBox?.paused ? 'A text box has focus and you are editing it, so nothing said goes in until you leave it and come back. Press Esc to leave it'
      : state === 'dictating' ? `${typingInto()}. Say “${escapeWordOf(settings())}” or press Esc to leave it`
      : heard ? `Listening. Heard “${heard.word}”${heard.ms == null ? '' : `, pressed ${heard.ms}ms after you began saying it`}`
      : 'Listening for the words on screen, and “up”, “down”, “upper”, “lower”, “top” or “bottom” to scroll';
    mic.title = `${doing}. Click to turn Voice labels ${on || labels() === 'voice' ? 'off' : 'on'}`;
    mic.setAttribute('aria-label', mic.title);
    if (heard?.ms != null) mic.dataset.heardMs = heard.ms; else delete mic.dataset.heardMs;
    paintSetup(on, state);
  }
  // The panel beside the mic lists what setting up does, once it takes longer than a glance, and says
  // Voice is ready for a moment after; a failure or Voice turned off takes it away at once.
  let setupShown = false, setupLate = null, setupDone = null, setupPainted = '';
  function paintSetup(on, state) {
    const busy = on && state === 'loading';
    if (busy) {
      clearTimeout(setupDone); setupDone = null;
      if (!setupShown) setupLate ??= setTimeout(() => { setupLate = null; setupShown = true; paint(); }, 300);
    } else {
      clearTimeout(setupLate); setupLate = null;
      if (setupShown && on && setupSteps.done && state !== 'failed' && state !== 'declined') setupDone ??= setTimeout(() => { setupDone = null; setupShown = false; paint(); }, 2500);
      else if (!setupDone) setupShown = false;
    }
    panel.hidden = !setupShown;
    if (!setupShown) return;
    const html = setupHtml(setupSteps.steps, !busy);
    if (html !== setupPainted) panel.innerHTML = setupPainted = html;
    placeSetup();
  }
  // Beside the rail's mic, kept inside the window.
  function placeSetup() {
    if (panel.hidden) return;
    const r = mic.getBoundingClientRect();
    panel.style.left = `${Math.round(r.right + 10)}px`;
    panel.style.top = `${Math.round(Math.max(8, Math.min(r.top, win.innerHeight - panel.offsetHeight - 8)))}px`;
  }
  function typingInto() {
    const box = voiceBox?.active, last = voiceBox?.last;
    if (box?.state === 'dictation') return `A text box has focus: macOS Dictation types into it, since Apple’s speech helper can’t run here${voiceBox.helperDown ? ` (${voiceBox.helperDown.error})` : ''}`;
    return `A text box has focus: what you say goes into it, heard on this Mac by Apple’s speech helper${last ? `. Last time: first words ${fmt(last.first)} after starting, final text ${fmt(last.afterStop)} after stopping` : ''}`;
  }
  mic.addEventListener('click', () => setSetting('labels', mode() === 'voice' || labels() === 'voice' ? 'off' : 'voice'));

  // The dialog on top: the one holding focus, else the last open.
  function topModal() {
    const open = [...doc.querySelectorAll(MODALS)].filter(isOpen);
    return open.find((m) => m.contains(doc.activeElement)) || open.at(-1) || null;
  }
  const hints = (els) => els.filter((el) => !el.closest(SKIP)).map((el) => ({ hint: true, el, rank: hintRank(el), act: () => reach(el) }));
  keys = createKeys({
    doc,
    watch: [...doc.querySelectorAll('#nav-rail, #grid, #search, #ext-views, #panel, #panel-sections, #chat-wrap, #diff-panel'), ...doc.querySelectorAll(MODALS)],
    voice: () => mode() === 'voice',
    onWords: (words) => voice?.setWords(words),
    identity,
    targets: () => {
      if (mode() === 'off' || settingUp()) return null;
      const top = topModal();
      if (top) return { host: top, items: hints(clickables(top)) };
      // A card's menu takes every word until it shuts.
      const menu = doc.querySelector('body > .context-menu');
      if (menu) return { host: doc.body, items: hints(clickables(menu)) };
      const parts = SURFACES.flatMap((sel) => [...doc.querySelectorAll(sel)]).flatMap((root) => clickables(root));
      return { host: doc.body, items: hints([...new Set(parts)]) };
    },
  });
  // A dialog or a card menu comes and goes as a class or a child of <body>.
  const bodyWatch = new win.MutationObserver((records) => { if (records.some((r) => [...r.addedNodes, ...r.removedNodes].some((n) => n.nodeType === 1 && !n.classList.contains('job-keys') && !n.classList.contains('voice-hud')))) { keys.sync(); paint(); } });
  bodyWatch.observe(doc.body, { childList: true });
  const viewWatch = new win.MutationObserver(() => { paint(); keys.sync(); });
  for (const el of doc.querySelectorAll(`#ext-views, #grid, #search, ${MODALS}`)) viewWatch.observe(el, { attributes: true, attributeFilter: ['class', 'open', 'hidden'], subtree: el.id === 'ext-views' });

  // Keyboard labels: a bare letter presses the badge it names, never from a field (the terminal's
  // own textarea included), behind ⌃⌘A's hint jump or with a modifier held.
  doc.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || !bareKey(e) || typing(e.target) || mode() !== 'keyboard') return;
    keys.press(e);
  });
  // Under labels a field's Esc, when nothing in it took the key, only leaves the field, so the labels
  // work again without a reach for the pointer: the next Esc goes up, or closes the dialog.
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !bareKey(e) || mode() === 'off' || !typing(e.target) || e.target.closest('.xterm, #ext-views')) return;
    e.preventDefault(); e.target.blur();
  });

  // One mic for both: the labels' recognizer and a focused box's recording (voice-box.js), which goes
  // to Apple's SpeechTranscriber through the server (server/speech.js), or, where that cannot run, to
  // macOS Dictation by a menu click (server/dictation.js).
  const shared = createMic({ win });
  const speech = createSpeech({ send: vsend, mic: shared });
  const dictation = createDictation(vsend);
  const modelAsked = (op) => new Promise((resolve, reject) => { modelWait[op] = { resolve, reject }; vsend({ type: 'voice-model', op }); });
  const askModel = () => { setupSteps.set('vosk', 'active', { note: 'waiting for your Download' }); const asked = modelAsk.open(); paint(); return asked; };
  const downloadModel = () => { setupSteps.set('vosk', 'active', { note: `downloading ${modelSize()}`, fraction: 0 }); const done = modelAsked('download'); paint(); return done; };
  const checkModel = () => { setupSteps.set('vosk', 'active', { note: 'checking' }); return modelAsked('check'); };
  // The words said after the escape word reached only the box's recording, never Vosk: each presses
  // here as if Vosk had heard it, while the board is in front, as the labels would.
  const afterEscape = (words) => { if (doc.visibilityState === 'visible' && doc.hasFocus()) for (const w of words) hear(w); };
  voiceBox = createVoiceBox({ doc, speech, dictation, escapeWord: () => escapeWordOf(settings()), onExit: (el, words) => { el?.blur(); afterEscape(words); }, onAfter: afterEscape, onChange: () => paint() });
  voice = createVoice({
    win,
    mic: shared,
    prepare: () => prepareModel({ check: checkModel, ask: askModel, download: downloadModel }).then(() => setupSteps.set('vosk', 'active', { note: 'loading', fraction: 0.9 }), (err) => { setupSteps.set('vosk', 'failed', { note: err.message }); throw err; }),
    // The rest once the labels' model has loaded: the helper and macOS's model, once a page unless it
    // failed for a while only. A helper that cannot run sends the boxes to Dictation, labels or not.
    setup: () => {
      setupSteps.set('vosk', 'done');
      return (helperReady ??= helperSetup.run().then((down) => { if (down) { voiceBox.helperFailed(down); if (!voiceBox.helperDown) helperReady = null; } }));
    },
    onWord: hear,
    onState: (...state) => { voiceState = state; paint(); },
  });
  const say = (word) => withOpener(() => keys.say(word));
  function hear(word, { ms } = {}) {
    if (mode() !== 'voice') return;
    if (COMMANDS.includes(word) ? scrollBy(word) : say(word)) { heard = { word, ms }; paint(); }
  }
  // What is in front scrolls: a dialog, else the board, Search or the view showing.
  function scrollBy(word) {
    const top = topModal();
    const root = top || doc.querySelector('#grid:not(.hidden), #search:not(.hidden), #ext-views > .ext-view:not(.hidden)');
    const box = root && scrollerIn(root, win);
    if (!box) return false;
    box.scrollBy({ top: scrollStep(word, box), behavior: calm() ? 'auto' : 'smooth' });
    return true;
  }
  // Under Voice a text box that has focus records what is said into it (voice-box.js), and nothing
  // presses, until Esc or the escape word leaves it and the words work again (those said after the
  // escape word too). A box left straight for another stops the first, then starts there. Never the
  // terminal's own textarea, nor a box in the Jobs view, whose Voice is its own.
  function syncDictation() {
    const el = doc.activeElement;
    const want = mode() === 'voice' && dictatable(el) && !el.closest('.xterm, #ext-views') ? el : null;
    if (want === dictating) return;
    // A redraw that put the cursor back in the box's replacement: the same box, so the recording goes on there.
    if (want && dictating && sameBox(dictating, want)) { dictating = want; voiceBox.follow(want); return; }
    dictating = want;
    voice?.dictate(!!want);
    if (want) voiceBox.start(want); else voiceBox.stop();
  }
  doc.addEventListener('focusin', syncDictation);
  // Focus is still on the field leaving it while focusout runs.
  doc.addEventListener('focusout', () => setTimeout(syncDictation));
  doc.addEventListener('scroll', placeSetup, true);
  win.addEventListener('resize', placeSetup);

  paint();
  keys.sync();
  return {
    // Every frame from the server: a `voice:` reply (server/voice-handlers.js) is taken, true when it
    // was one, and any frame says the socket is open, so what waited goes now.
    take(msg) {
      if (outbox.length) flush();
      const t = msg?.type;
      if (t === 'voice:model') {
        if (msg.op === 'progress') { if (modelWait.download && Number.isFinite(msg.fraction)) setupSteps.set('vosk', 'active', { note: `downloading ${modelSize()}, ${Math.round(msg.fraction * 100)}%`, fraction: msg.fraction }); return true; }
        const asked = modelWait[msg.op];
        if (!asked) return true;
        modelWait[msg.op] = null;
        if (msg.op === 'check') asked.resolve(!!msg.present); else if (msg.ok) asked.resolve(); else asked.reject(new Error(msg.error));
        return true;
      }
      if (t === 'voice:speech') { helperSetup.take(msg) || speech.take(msg); return true; }
      if (t === 'voice:dictation') { dictation.take(msg); return true; }
      if (t === 'voice:open-url-failed') { toast(msg.error, true); return true; }
      return false;
    },
    // settings.js's onChange: Labels or the escape word moved.
    settingChanged(id) { if (id === 'labels' || id === 'escapeWord') { paint(); keys.sync(); } },
    // For a test harness: the words drawn, and a word as if Vosk heard it.
    drawn: () => keys.drawn(),
    hear: (word) => hear(word),
    get state() { return voiceState[0]; },
  };
}
