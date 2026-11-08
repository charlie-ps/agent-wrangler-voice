// Speech to text for a text box where Apple's speech helper cannot be had because the board does not
// run on a Mac (Linux, or WSL with a Windows browser): the labels' own pinned Vosk model
// (job-voice.js `loadModel`), in the browser, with a recognizer that has no word list, so it hears
// prose rather than only the words on screen. Audio never leaves the browser. Same shape as
// voice-speech.js `createSpeech`, so voice-box.js records into a box either way: `record({onEvent})`
// hears ready, partial, final and error, its `open()` takes the shared mic (voice-mic.js), `stop()`
// resolves with the final event and `cancel()` drops it. Vosk ends an utterance at each pause, so the
// text is every utterance finished so far and the one going on, each partial a rewrite of the whole.
import { FINAL_WAIT_MS } from './voice-speech.js';

export const joinSaid = (parts) => parts.map((p) => String(p ?? '').trim()).filter(Boolean).join(' ');

// `model()` resolves the loaded Vosk model (the labels' one, already loaded by the time Voice is set up).
export function createLocalSpeech({ mic, model, setTimer = setTimeout, clearTimer = clearTimeout, now = () => performance.now() }) {
  function record({ onEvent = () => {} } = {}) {
    let rec = null, rate = 16000, done = [], partial = '', finished = null, stopped = false, timer = null, startAt = now(), firstAt = null, stopAt = null, settle = null;
    const said = () => joinSaid([...done, partial]);
    const feed = (samples, r) => { if (!stopped) rec?.acceptWaveformFloat(samples, (rate = r)); };
    const end = (e) => {
      if (finished) return finished;
      finished = e;
      clearTimer(timer);
      mic.drop(feed);
      rec?.remove(); rec = null;
      onEvent(e);
      settle?.(e);
      return e;
    };
    const final = (timedOut = false) => end({ kind: 'final', text: said(), afterStop: stopAt == null ? null : Math.round(now() - stopAt), first: firstAt == null ? null : Math.round(firstAt - startAt), ...(timedOut ? { timedOut } : {}) });
    const heard = () => {
      const text = said();
      if (firstAt == null && text) firstAt = now();
      if (!finished) onEvent({ kind: 'partial', text });
    };
    return {
      get text() { return said(); },
      // Resolves once the mic is open: a refusal throws, and nothing is held.
      async open() {
        let m;
        try { m = await model(); } catch (err) { if (!stopped) end({ kind: 'error', reason: 'no-model', error: err?.message || String(err) }); return; }
        if (stopped) return;
        rate = await mic.take(feed);
        if (stopped) { mic.drop(feed); return; }
        const mine = rec = new m.KaldiRecognizer(rate);
        rec.on('partialresult', (msg) => {
          if (rec !== mine || stopped) return;
          const p = String(msg?.result?.partial ?? '');
          if (p === partial) return;
          partial = p; heard();
        });
        rec.on('result', (msg) => {
          if (rec !== mine) return;
          const t = String(msg?.result?.text ?? '').trim();
          partial = '';
          if (t) done.push(t);
          if (stopped) final(); else if (t) heard();
        });
        onEvent({ kind: 'ready', where: 'browser' });
      },
      // What Vosk still holds comes out as one last result; one that never comes settles on what was heard.
      stop() {
        if (finished) return Promise.resolve(finished);
        const waiting = new Promise((resolve) => { const prev = settle; settle = (e) => { prev?.(e); resolve(e); }; });
        if (!stopped) {
          stopped = true;
          stopAt = now();
          mic.drop(feed);
          if (rec) { rec.retrieveFinalResult(); timer = setTimer(() => final(true), FINAL_WAIT_MS); } else final();
        }
        return waiting;
      },
      cancel() { if (finished) return; stopped = true; end({ kind: 'cancelled', text: said() }); },
    };
  }
  // Replies come from the recognizer itself, never the server.
  return { record, take: () => false };
}
