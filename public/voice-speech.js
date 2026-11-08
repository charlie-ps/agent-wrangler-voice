// Speech to text through the wrangler's server (server/speech.js), which runs Apple's
// SpeechTranscriber on this Mac: the browser records (voice-mic.js) and sends 16-bit PCM over the
// control socket in ~100ms frames; the server answers with partial and final text. Every board gets
// the replies, so each recording carries an id only this board knows.
export const FRAME_MS = 100;
// A stop the server never answers settles on the last words heard.
export const FINAL_WAIT_MS = 5000;

export function toPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
  return out;
}
export function base64Of(int16) {
  const bytes = new Uint8Array(int16.buffer, int16.byteOffset, int16.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// `record({onEvent})` starts one recording: `onEvent(e)` hears the server's `kind`s
// (building, installing, ready, partial, final, error). Its `stop()` resolves with the final event
// ({text, afterStop, …}), `cancel()` drops it.
export function createSpeech({ send, mic, tag = Math.random().toString(36).slice(2, 8), setTimer = setTimeout, clearTimer = clearTimeout }) {
  let seq = 0;
  const live = new Map();
  function record({ onEvent = () => {} } = {}) {
    const id = `${tag}-${++seq}`;
    let parts = [], size = 0, rate = 16000, said = '', done = null, finished = null, timer = null, stopped = false;
    const flush = () => {
      if (!size) return;
      const all = new Int16Array(size);
      let at = 0;
      for (const p of parts) { all.set(p, at); at += p.length; }
      parts = []; size = 0;
      send({ type: 'speech', op: 'audio', id, pcm: base64Of(all) });
    };
    const feed = (samples, r) => {
      if (stopped) return;
      rate = r;
      const p = toPcm16(samples);
      parts.push(p); size += p.length;
      if (size >= rate * FRAME_MS / 1000) flush();
    };
    const end = (e) => {
      if (finished) return;
      finished = e;
      clearTimer(timer);
      live.delete(id);
      mic.drop(feed);
      done?.(e);
    };
    const session = {
      id,
      get text() { return said; },
      take(e) {
        if (e.kind === 'partial') said = e.text;
        if (e.kind === 'final') said = e.text;
        onEvent(e);
        if (e.kind === 'final' || e.kind === 'error') end(e);
      },
      // Resolves once the mic is open: a refusal throws, and nothing was sent.
      async open() {
        rate = await mic.take(feed);
        // Stopped or cancelled while the mic was opening: nothing was sent, and it holds nothing.
        if (stopped) { mic.drop(feed); return; }
        send({ type: 'speech', op: 'start', id, rate });
      },
      stop() {
        if (finished) return Promise.resolve(finished);
        if (!stopped) {
          stopped = true;
          mic.drop(feed);
          flush();
          send({ type: 'speech', op: 'stop', id });
          timer = setTimer(() => end({ kind: 'final', text: said, afterStop: null, timedOut: true }), FINAL_WAIT_MS);
        }
        return new Promise((resolve) => { const prev = done; done = (e) => { prev?.(e); resolve(e); }; });
      },
      cancel() { if (finished) return; stopped = true; send({ type: 'speech', op: 'cancel', id }); end({ kind: 'cancelled', text: said }); },
    };
    live.set(id, session);
    return session;
  }
  return {
    record,
    take(msg) { const s = live.get(msg.id); if (!s) return false; s.take(msg); return true; },
  };
}
