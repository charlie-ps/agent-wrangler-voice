import fs from 'node:fs';
import { execFile as defaultExecFile, spawn as defaultSpawn } from 'node:child_process';
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
export const makeVoiceModelHandler = ({ ensure = ensureVoiceModel, has = hasVoiceModel, platform = process.platform } = {}) => ({
  type: 'voice-model',
  async handler(msg, host) {
    if (msg?.op !== 'download') {
      let present = false;
      try { present = await has(); } catch (e) { host.log('voice model check failed', e); }
      // The board's platform rides along, so its warning says what turning Voice on sets up here.
      return host.broadcast({ event: 'voice-model', op: 'check', present, platform });
    }
    try { await ensure({ onProgress: (fraction) => host.broadcast({ event: 'voice-model', op: 'progress', fraction }) }); host.broadcast({ event: 'voice-model', op: 'download', ok: true }); } catch (err) { host.broadcast({ event: 'voice-model', op: 'download', ok: false, error: err?.message || String(err) }); }
  },
});

// A link pressed by a heard word (public/voice-open.js): the recognizer's callback carries no user
// activation, so the browser's popup blocker would drop the tab. The link goes to the desktop's own
// opener with the one argument, re-serialised, http(s) only, no shell: macOS `open`; on Linux
// `xdg-open`; under WSL, where the browser is Windows', `wslview` (wslu) or else `explorer.exe`.
export const isWsl = ({ env = process.env, release = () => fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8') } = {}) => {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try { return /microsoft|wsl/i.test(release()); } catch { return false; }
};
// The openers to try in order, each tried only when the one before is not installed.
export function openersFor(platform, wsl) {
  if (platform === 'darwin') return ['open'];
  if (platform === 'linux') return wsl ? ['wslview', 'explorer.exe'] : ['xdg-open'];
  return [];
}
// explorer.exe exits 1 when it has handed a URL on, so only a failure to run it counts.
const EXIT_LIES = new Set(['explorer.exe']);
// How long a Linux opener may run before it counts as launched: xdg-open with no desktop running
// can exec the browser itself and stay until it closes.
export const LAUNCH_MS = 4000;
// Off a Mac, the opener runs on its own (detached, no pipes), so a browser it starts outlives neither
// the wrangler's stdio nor a timeout: `{missing}` when it is not installed, `{error}` when it said no.
export function launch(cmd, href, { spawn = defaultSpawn, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  return new Promise((resolve) => {
    let child, timer = null, done = false;
    const end = (r) => { if (done) return; done = true; clearTimer(timer); child?.unref?.(); resolve(r); };
    try { child = spawn(cmd, [href], { detached: true, stdio: 'ignore' }); } catch (e) { return end(e.code === 'ENOENT' ? { missing: true } : { error: e.message }); }
    child.on('error', (e) => end(e.code === 'ENOENT' ? { missing: true } : { error: e.message }));
    child.on('exit', (code, signal) => end(code === 0 || EXIT_LIES.has(cmd) ? {} : { error: signal ? `${cmd} was stopped (${signal})` : `${cmd} exited ${code}` }));
    timer = setTimer(() => end({}), LAUNCH_MS);
  });
}
export function makeOpenUrlHandler({ execFile = defaultExecFile, spawn = defaultSpawn, platform = process.platform, wsl = () => isWsl() } = {}) {
  let openers = null;
  return {
    type: 'open-url',
    async handler(msg, host) {
      const fail = (error) => host.broadcast({ event: 'open-url-failed', error });
      const href = webHref(msg.url);
      if (!href) return fail('Voice opens only http and https links');
      if (platform === 'darwin') {
        const err = await new Promise((resolve) => execFile('open', [href], (e, _out, stderr) => resolve(e && String(stderr || e.message).trim())));
        if (err) fail(`Could not open ${href}: ${err}`);
        return;
      }
      openers ??= openersFor(platform, platform === 'linux' && wsl());
      if (!openers.length) return fail('Opening a link by Voice is supported on macOS, Linux and WSL only');
      for (const cmd of openers) {
        const r = await launch(cmd, href, { spawn });
        if (r.missing) continue;
        if (r.error) fail(`Could not open ${href}: ${r.error}`);
        return;
      }
      fail(`Could not open ${href}: ${openers.join(' or ')} is not installed${openers[0] === 'wslview' ? ' (wslview comes with wslu)' : ' (xdg-open comes with xdg-utils)'}`);
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
