// Voice labels: the microphone, heard on this machine only, presses the badge whose word is said
// (job-keys.js `say`), and the commands scroll (`COMMANDS`): "up" and "down" by most of a screen,
// "upper" and "lower" by a few lines, "top" and "bottom" to either end. Recognition is Vosk's WASM build
// (vendor/vosk-browser.js, loaded only once Voice is on) in its own worker, held by a grammar to
// every word a badge can carry (the buttons' own, BUTTON_WORDS, and the fallback WORDS) plus [unk],
// and only a word drawn now presses. The words not drawn are there as decoys: held to the drawn
// ones alone, the recognizer heard an off-screen list word as a drawn one at full confidence (gold
// as cloud, king as cake), where with them it hears it as itself. Other speech lands on [unk]. One grammar for every screen is also one recognizer, never rebuilt. Never
// the browser's Web Speech API, which sends the audio away. The browser fetches nothing from anyone
// but the board: the model comes from the board's own public/ route, put there by its server
// (server/voice-model.js) only once the human said Download (voice-consent.js), and is hashed against
// its pin before Vosk reads it (`verified`).
// vosk-browser keeps it in this origin's IndexedDB under its URL. While a text box has focus Vosk lets
// go of the shared mic (voice-mic.js, `dictate`), so the box's recording (voice-box.js) has it, and
// takes it back after with a fresh recognizer. Words press only while the board's page is visible and
// its window has focus (`here`): the labels are not on screen otherwise. Away, the mic stays held
// (letting go would close the AudioContext, and a ⌘-Tab back would need a click to reopen it) but the
// recognizer goes, so nothing half heard before presses once the window is back.
import { WORDS, BUTTON_WORDS, COMMANDS } from './job-keys.js';
import { VOICE_MODEL, VOICE_MODEL_DIR } from './voice-model.js';
import { createMic } from './voice-mic.js';

export const MODEL_URL = new URL(`./${VOICE_MODEL_DIR}/${VOICE_MODEL.file}`, import.meta.url).href;
// A final result's word below this confidence is a guess: a word not drawn (or a cough) that the
// grammar had to call something.
export const MIN_CONF = 0.7;
// How long the mic must be quiet after a word before it is settled: a lone word has ended, where a
// sentence would still be going (and grow [unk]s around anything it matched).
export const QUIET_MS = 100;
// How loud a block must be to count as speech, and how long a quiet spell drops an utterance's clock
// (mic-to-press is timed from its first loud block).
const ONSET_RMS = 0.015, ONSET_DROP_MS = 1500;

// A partial carries no confidence, so it never presses: once the latest is exactly one shown word
// and the mic has been quiet QUIET_MS (`quiet(ms)` reports each block), `settle()` asks the
// recognizer to end the utterance now rather than wait out its own endpoint, and the final result
// presses if it is exactly one shown word at MIN_CONF. Anything with [unk] or a second word in it,
// from a sentence or a word not drawn, is not a press.
export function createHearing({ onWord, settle = () => {} }) {
  let words = new Set(), said = '', asked = false, hush = 0;
  const lone = (text) => { const t = String(text || '').trim().split(/\s+/); return t.length === 1 && words.has(t[0]) ? t[0] : ''; };
  const check = () => { if (!asked && said && hush >= QUIET_MS) { asked = true; settle(); } };
  return {
    setWords(list) { words = new Set(list); said = ''; asked = false; },
    reset() { said = ''; asked = false; hush = 0; },
    partial(text) { said = lone(text); check(); },
    quiet(ms) { hush = ms; check(); },
    final(result) {
      const hit = result?.result?.length === 1 ? result.result[0] : null;
      said = ''; asked = false;
      if (hit && hit.conf >= MIN_CONF && lone(result.text) === hit.word) onWord(hit.word);
    },
  };
}

// vosk-browser's own createModel waits for a load that a failed download never sends (its worker
// reports an error instead), which left Voice loading for good: either settles it here, and a
// failure frees the worker and lets the next start try again.
// The model's bytes as the board serves them, refused unless they hash to the pin: Vosk is handed its
// URL only after, and fetches the same file from the same local route.
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export async function verified(url, { sha256 = VOICE_MODEL.sha256, fetchImpl = globalThis.fetch, subtle = globalThis.crypto?.subtle } = {}) {
  const res = await fetchImpl(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`The voice model is not there (HTTP ${res.status})`);
  if (hex(await subtle.digest('SHA-256', await res.arrayBuffer())) !== sha256) throw new Error('The voice model failed its checksum, so Voice will not start');
  return url;
}

let loading = null;
export const modelFrom = (Model, url) => new Promise((resolve, reject) => {
  const model = new Model(url);
  let settled = false;
  const fail = (why) => { if (settled) return; settled = true; model.terminate(); reject(new Error(`The voice model did not load${why ? `: ${why}` : ''}`)); };
  model.on('load', (m) => { if (!m.result) return fail(); settled = true; resolve(model); });
  model.on('error', (m) => fail(m.error));
});
// `prepare()` has the model on the server, asking the human before any fetch (voice-consent.js), and
// rejects `declined` if they said no; the recognizer is imported only now, once Voice is on.
export const loadModel = (url, prepare, { verify = verified, vosk = () => import('./vendor/vosk-browser.js').then(() => globalThis.Vosk) } = {}) => (loading ??= prepare().then(() => verify(url)).then(vosk).then((Vosk) => modelFrom(Vosk.Model, url)).catch((err) => { loading = null; throw err; }));

// `onWord(word, {ms})` hears a press, `ms` from the block that started the utterance to now
// (mic-to-press: the word's own length included). `onState(state, why?)`: loading, listening,
// dictating (the mic let go for a text box), waiting (the browser holds audio until a click), paused
// (the page hidden or its window not focused: the mic held, nothing heard), off,
// declined (no model, and Cancel to downloading it: the mic never opened) or failed. `mic` is the one
// the text boxes record from too. `setup()` is the rest of Voice's setup (voice-setup.js), awaited
// after the model loads and before the mic opens, so `loading` lasts until all of it is done; a
// failure in it is its own to report, and listening goes ahead.
export function createVoice({ onWord, onState = () => {}, prepare = async () => {}, setup = async () => {}, win = globalThis.window, mic = createMic({ win }), modelUrl = MODEL_URL, vocabulary = [...WORDS, ...BUTTON_WORDS, ...COMMANDS], commands = COMMANDS, load = loadModel }) {
  let on = false, model = null, rec = null, rate = 16000, onsetAt = null, loudAt = 0, gen = 0;
  let dictating = false, away = false, open = false;
  const now = () => win.performance.now();
  const doc = win.document;
  const here = () => !doc || (doc.visibilityState === 'visible' && doc.hasFocus());
  const hearing = createHearing({
    onWord: (w) => { focus(); if (away) return; const ms = onsetAt == null ? null : Math.round(now() - onsetAt); onsetAt = null; onWord(w, { ms }); },
    settle: () => rec?.retrieveFinalResult(),
  });
  function block(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i += 4) sum += samples[i] * samples[i];
    const t = now();
    if (Math.sqrt(sum / (samples.length / 4)) > ONSET_RMS) { onsetAt ??= t; loudAt = t; } else if (onsetAt != null && t - loudAt > ONSET_DROP_MS) onsetAt = null;
    rec?.acceptWaveformFloat(samples, rate);
    // Since the last loud block, not the utterance's clock: a recognizer behind a busy CPU may name
    // the word only after that clock has dropped.
    hearing.quiet(loudAt ? t - loudAt : 0);
  }
  // The mic and its recognizer, taken and let go together (a text box's turn in between), so nothing
  // half heard before a box took focus presses after it.
  const feed = (samples, r) => { rate = r; block(samples); };
  async function openMic(current) {
    // 16kHz is the model's own rate where the browser can mix rates; elsewhere (Firefox) the device's,
    // and Vosk resamples.
    rate = await mic.take(feed);
    if (!current()) { mic.drop(feed); return; }
    open = true;
    mic.onWaiting = (waiting) => current() && onState(away ? 'paused' : waiting ? 'waiting' : 'listening');
    away = !here();
    listen();
  }
  // A fresh recognizer, or none while away: either way what was half heard is gone.
  function listen() {
    rec?.remove(); rec = null;
    hearing.reset();
    onsetAt = null; loudAt = 0;
    if (away) { onState('paused'); return; }
    const mine = rec = new model.KaldiRecognizer(rate, JSON.stringify([...vocabulary, '[unk]']));
    rec.setWords(true);
    rec.on('partialresult', (m) => { if (rec === mine) hearing.partial(m.result?.partial); });
    rec.on('result', (m) => { if (rec !== mine) return; hearing.final(m.result); onsetAt = null; });
    onState(mic.waiting ? 'waiting' : 'listening');
  }
  // A blur can be focus moving into a frame of the page, which still has it, so each event asks.
  function focus() {
    if (away === !here()) return;
    away = !away;
    if (open) listen();
  }
  function closeMic() {
    open = false;
    rec?.remove(); rec = null;
    mic.drop(feed);
    onsetAt = null; loudAt = 0;
  }
  const watch = (add) => {
    for (const ev of ['focus', 'blur']) win[add ? 'addEventListener' : 'removeEventListener']?.(ev, focus);
    doc?.[add ? 'addEventListener' : 'removeEventListener']?.('visibilitychange', focus);
  };
  // Each take of the mic is its own generation: one that a stop or a text box overtook lets go of
  // whatever it got.
  async function take() {
    const mine = ++gen;
    const current = () => on && !dictating && gen === mine;
    try {
      if (!win.navigator.mediaDevices?.getUserMedia || !win.AudioWorkletNode) throw new Error('This browser cannot listen here');
      model ??= await load(modelUrl, prepare);
      if (!current()) return;
      await Promise.resolve().then(setup).catch(() => {});
      if (!current()) return;
      await openMic(current);
    } catch (err) {
      if (gen !== mine || !on) return;
      stop();
      if (err?.declined) onState('declined');
      else onState('failed', err?.name === 'NotAllowedError' ? 'The microphone was refused' : String(err?.message || err));
    }
  }
  function start() {
    if (on) return Promise.resolve();
    on = true;
    watch(true);
    if (dictating) { onState('dictating'); return Promise.resolve(); }
    onState('loading');
    return take();
  }
  function stop() {
    if (!on) return;
    on = false; gen++;
    watch(false);
    closeMic();
    onState('off');
  }
  return {
    start, stop,
    get on() { return on; },
    get dictating() { return dictating; },
    // The words now drawn, and the commands: the only ones a press may name.
    setWords(list) { hearing.setWords([...list, ...commands]); },
    // True while a text box has focus: the mic is let go for its recording, and taken back after.
    dictate(want) {
      if (!!want === dictating) return Promise.resolve();
      dictating = !!want;
      if (!on) return Promise.resolve();
      gen++;
      if (dictating) { closeMic(); onState('dictating'); return Promise.resolve(); }
      onState(model ? 'listening' : 'loading');
      return take();
    },
  };
}
