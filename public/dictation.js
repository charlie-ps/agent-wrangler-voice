// Starts and stops the Mac's Dictation for a text box through the server, which clicks the
// browser's Edit › Start Dictation (server/dictation.js). `start` answers {ok, reason, error, ms} once
// the server has tried; a start a later focus overtook answers reason `superseded`, and one the
// server never answers (an older board, a dropped socket) `no-answer`. Every board gets the reply,
// so each start carries an id only this helper knows.
export const ANSWER_MS = 15000;

export function createDictation(send, { tag = Math.random().toString(36).slice(2, 8), setTimer = setTimeout } = {}) {
  let seq = 0, box = null;
  const waiting = new Map();
  const answer = (id, result) => { const done = waiting.get(id); if (done) { waiting.delete(id); done(result); } };
  function start(el) {
    box = el;
    const id = `${tag}-${++seq}`;
    send({ type: 'dictation', start: true, id });
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      setTimer(() => answer(id, { ok: false, reason: 'no-answer', error: 'the wrangler did not answer', ms: null }), ANSWER_MS);
    });
  }
  // Only the box Dictation was started for stops it: a late blur of the last box is not a stop.
  function stop(el = box) {
    if (!box || el !== box) return;
    box = null;
    send({ type: 'dictation', start: false });
  }
  return {
    start,
    stop,
    get box() { return box; },
    // A focus moving straight from one attached box to another sends only the start, which restarts
    // Dictation there: the blur waits a tick to see where focus lands.
    attach(el, onResult = () => {}) {
      const focus = () => start(el).then(onResult);
      const blur = () => setTimer(() => { if (box === el && el.ownerDocument.activeElement !== el) stop(el); });
      el.addEventListener('focus', focus);
      el.addEventListener('blur', blur);
      return () => { el.removeEventListener('focus', focus); el.removeEventListener('blur', blur); stop(el); };
    },
    take(msg) {
      if (!waiting.has(msg.id)) return false;
      answer(msg.id, { ok: !!msg.ok, reason: msg.reason ?? null, error: msg.error ?? null, ms: msg.ms ?? null });
      return true;
    },
  };
}
