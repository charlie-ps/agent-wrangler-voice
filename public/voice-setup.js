import { esc } from './util.js';

// What turning Voice on sets up before any label is drawn, so the first text box listens at once
// rather than building or installing while the human waits to speak: Vosk's model for the labels
// (voice-consent.js asks before fetching it), Apple's speech helper built with swiftc, and macOS's
// own English speech model for the boxes (server/speech.js `setup`). A helper that cannot run is no
// reason to hold the labels back: its boxes fall back to Dictation (voice-box.js).
export const STEPS = [
  { id: 'vosk', label: 'Vosk’s English model, which hears the words on screen' },
  { id: 'helper', label: 'Apple’s speech helper, built on this Mac with swiftc' },
  { id: 'speech', label: 'macOS’s English speech model, for speaking into text boxes' },
];
const FINISHED = new Set(['done', 'skipped', 'failed']);

// `set(id, state, {note, fraction})`, state todo, active, done, skipped or failed; `progress` is the
// whole setup's share done, a step part-way counting its fraction.
export function createSetupSteps({ onChange = () => {} } = {}) {
  let steps = [];
  const reset = () => { steps = STEPS.map((s) => ({ ...s, state: 'todo', note: '', fraction: null })); };
  reset();
  return {
    reset() { reset(); onChange(); },
    set(id, state, { note = '', fraction = null } = {}) {
      const s = steps.find((x) => x.id === id);
      if (!s || (s.state === state && s.note === note && s.fraction === fraction)) return;
      Object.assign(s, { state, note, fraction });
      onChange();
    },
    get steps() { return steps.map((s) => ({ ...s })); },
    get progress() { return steps.reduce((n, s) => n + (FINISHED.has(s.state) ? 1 : s.state === 'active' ? s.fraction ?? 0 : 0), 0) / steps.length; },
    get done() { return steps.every((s) => FINISHED.has(s.state)); },
  };
}

// The helper's half, over the control socket (`{type:'speech', op:'setup'}`): resolves once it is
// built and macOS's model installed, or with the error that stopped it; never rejects, since the labels
// go ahead either way.
const HELPER_REASONS = new Set(['not-mac', 'old-macos', 'no-swiftc', 'build-failed']);
const pct = (f) => `${Math.round(f * 100)}%`;
export function createHelperSetup({ send, steps, tag = Math.random().toString(36).slice(2, 8) }) {
  let seq = 0, live = null;
  return {
    run() {
      const id = `${tag}-setup-${++seq}`;
      steps.set('helper', 'active', { note: 'checking' });
      return new Promise((resolve) => {
        live = { id, resolve };
        send({ type: 'speech', op: 'setup', id });
      });
    },
    // A reply for this board's setup: true when it was one.
    take(msg) {
      if (!live || msg.id !== live.id) return false;
      const { kind } = msg;
      if (kind === 'building') steps.set('helper', 'active', { note: 'building (first use only)' });
      else if (kind === 'built') { steps.set('helper', 'done'); steps.set('speech', 'active', { note: 'checking' }); }
      else if (kind === 'installing') steps.set('speech', 'active', { note: msg.fraction == null ? 'downloading' : `downloading, ${pct(msg.fraction)}`, fraction: msg.fraction });
      else if (kind === 'installed') { steps.set('speech', 'done'); live.resolve(null); live = null; }
      else if (kind === 'error') {
        const helper = msg.step === 'helper' || HELPER_REASONS.has(msg.reason);
        if (helper) { steps.set('helper', 'failed', { note: msg.error }); steps.set('speech', 'skipped', { note: 'text boxes use macOS Dictation instead' }); } else steps.set('speech', 'failed', { note: msg.error });
        live.resolve({ reason: msg.reason, error: msg.error });
        live = null;
      }
      return true;
    },
  };
}

const MARK = { todo: '○', active: '●', done: '✓', skipped: '–', failed: '!' };
export function setupHtml(steps, finished) {
  const rows = steps.map((s) => `<li data-step="${s.id}" data-state="${s.state}"><span class="voice-setup-mark" aria-hidden="true">${MARK[s.state]}</span><span>${esc(s.label)}${s.note ? `<small>${esc(s.note)}</small>` : ''}</span></li>`).join('');
  return `<b>${finished ? 'Voice is ready' : 'Setting up Voice on this computer'}</b><ol>${rows}</ol>${finished ? '' : '<p>Labels appear once this is done.</p>'}`;
}
