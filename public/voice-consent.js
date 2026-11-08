import { esc } from './util.js';
import { VOICE_MODEL } from './voice-model.js';

// Voice's model is never fetched by itself: picking Voice (Settings or ⌃⌘V) asks the server whether
// the pinned file is already there and hashes to its pin, and only the human's Download in this
// warning asks it to fetch one. Cancel, Esc or Voice switched off meanwhile fetches nothing and leaves
// Voice not listening (`declined`) until it is picked again.
export const modelHost = (model = VOICE_MODEL) => new URL(model.from).host;
export const modelSize = (model = VOICE_MODEL) => `${Math.round(model.bytes / 1e6)} MB`;
export const DECLINED = 'Not listening: Voice’s speech model was not downloaded';

// `check()` resolves whether the server has it, `ask()` whether the human said Download, and
// `download()` once the server fetched and checked it.
export async function prepareModel({ check, ask, download }) {
  if (await check()) return;
  if (!(await ask())) throw Object.assign(new Error(DECLINED), { declined: true });
  await download();
}

// The warning, on <body> like the merge ask so a redraw never wipes it and it stacks over Settings.
// `open()` resolves true for Download and false for anything else; `close()` is a Cancel.
export function createModelAsk({ theme = () => {}, doc = globalThis.document, model = VOICE_MODEL } = {}) {
  let dialog = null, answer = null, asked = null;
  const settle = (yes) => { const a = answer; answer = asked = null; a?.(yes); if (dialog?.open) dialog.close(); };
  function open() {
    if (asked) return asked;
    if (!dialog) {
      dialog = doc.createElement('dialog');
      dialog.className = 'job-dialog job-voice-ask';
      dialog.setAttribute('aria-labelledby', 'job-voice-ask-title');
      dialog.addEventListener('close', () => settle(false));
      doc.body.appendChild(dialog);
    }
    theme(dialog);
    dialog.innerHTML = `<h2 id="job-voice-ask-title">Download Voice’s speech model?</h2>
      <p class="job-voice-ask-why">Voice hears the words on screen with Vosk’s small English model, which this computer does not have yet. It is <b>${esc(modelSize(model))}</b>, fetched once from <b>${esc(modelHost(model))}</b> by the wrangler’s own server and kept only if its SHA-256 matches the one pinned in its source; the board checks it again before using it. After that, what you say is heard on this computer only.</p>
      <p class="job-voice-ask-from">${esc(model.from)}</p>
      <p class="job-voice-ask-also">Turning Voice on also sets up, before any label is drawn: Apple’s speech helper, built once on this computer from the wrangler’s source with swiftc, and macOS’s own English speech model, which macOS may fetch, so text boxes listen as soon as you click into them.</p>
      <div class="job-actions"><button type="button" class="primary" data-voice-ask="download">Download ${esc(modelSize(model))}</button><button type="button" data-voice-ask="cancel">Cancel</button></div>`;
    dialog.querySelectorAll('[data-voice-ask]').forEach((b) => b.onclick = () => settle(b.dataset.voiceAsk === 'download'));
    asked = new Promise((resolve) => { answer = resolve; });
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('[data-voice-ask="cancel"]').focus();
    return asked;
  }
  return { open, close: () => settle(false), get asking() { return !!asked; } };
}
