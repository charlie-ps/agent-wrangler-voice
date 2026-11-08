import { execFile as defaultExecFile } from 'node:child_process';
import { ensureVoiceModel, hasVoiceModel } from './voice-model.js';
import { makeSpeechHandler } from './speech.js';
import { makeDictationHandler } from './dictation.js';
import { webHref } from '../public/voice-open.js';
import { log } from './log.js';

// Voice on the board (public/board-voice.js), ported from Wrangler²'s Voice: the pinned model
// (voice-model.js), Apple's speech helper for text boxes (speech.js), the Dictation fallback
// (dictation.js) and links a heard word opens. Each module keeps Wrangler²'s `handler(msg, host)`
// shape; here every one becomes a core control handler typed `voice:<name>` (never a type an
// extension may hold, Wrangler²'s own included), and its `host.broadcast({event, …})` goes back to
// the board that asked, as `{type:'voice:<event>', …}`: a transcript reaches no other board.

// Voice's model, served by the board from public/voice-model/. Anything but `download` only checks
// what is on disk: the fetch waits for the human's Download in the board's warning
// (public/voice-consent.js).
export const makeVoiceModelHandler = ({ ensure = ensureVoiceModel, has = hasVoiceModel } = {}) => ({
  type: 'voice-model',
  async handler(msg, host) {
    if (msg?.op !== 'download') {
      let present = false;
      try { present = await has(); } catch (e) { host.log('voice model check failed', e); }
      return host.broadcast({ event: 'voice-model', op: 'check', present });
    }
    try { await ensure({ onProgress: (fraction) => host.broadcast({ event: 'voice-model', op: 'progress', fraction }) }); host.broadcast({ event: 'voice-model', op: 'download', ok: true }); } catch (err) { host.broadcast({ event: 'voice-model', op: 'download', ok: false, error: err?.message || String(err) }); }
  },
});

// A link pressed by a heard word (public/voice-open.js): the recognizer's callback carries no user
// activation, so the browser's popup blocker would drop the tab. macOS `open` with the one argument,
// re-serialised, http(s) only, no shell.
export function makeOpenUrlHandler({ execFile = defaultExecFile, platform = process.platform } = {}) {
  return {
    type: 'open-url',
    async handler(msg, host) {
      const fail = (error) => host.broadcast({ event: 'open-url-failed', error });
      const href = webHref(msg.url);
      if (!href) return fail('Voice opens only http and https links');
      if (platform !== 'darwin') return fail('Opening a link by Voice is only supported on macOS');
      const err = await new Promise((resolve) => execFile('open', [href], (e, _out, stderr) => resolve(e && String(stderr || e.message).trim())));
      if (err) fail(`Could not open ${href}: ${err}`);
    },
  };
}

export const VOICE_PREFIX = 'voice:';
// Wrangler²'s `voice-model` event and type are this board's `voice:model`; the rest keep their name.
const named = (name) => (name === 'voice-model' ? 'model' : name);
export function asControlHandler(h) {
  return {
    type: `${VOICE_PREFIX}${named(h.type)}`,
    handler(msg, ctx) {
      const host = {
        broadcast: ({ event, ...rest }) => ctx.reply({ ...rest, type: `${VOICE_PREFIX}${named(event)}` }),
        log: (...a) => log('[voice]', ...a),
      };
      return h.handler(msg, host);
    },
  };
}

export const VOICE_HANDLERS = [makeVoiceModelHandler(), makeSpeechHandler(), makeDictationHandler(), makeOpenUrlHandler()].map(asControlHandler);
