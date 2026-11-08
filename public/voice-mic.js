// The one microphone Voice labels (job-voice.js) and a text box's speech to text (voice-speech.js)
// share, so handing over from one to the other opens nothing new and loses no audio. Open while anyone
// holds it, closed (tracks stopped, so the browser's recording dot goes) `LINGER_MS` after the last
// lets go, so a box handing back to the labels keeps it open. Each holder
// gets every 32ms block (voice-worklet.js) at the context's rate: 16kHz where the browser can mix
// rates, else the device's.
export const LINGER_MS = 1500;
export function createMic({ win = globalThis.window ?? globalThis, worklet = new URL('./voice-worklet.js', import.meta.url), setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const users = new Set();
  let ctx = null, stream = null, node = null, opening = null, onWaiting = () => {}, closing = null;
  async function open() {
    const s = await win.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    if (!users.size) { s.getTracks().forEach((t) => t.stop()); return; }
    stream = s;
    let src;
    try { ctx = new win.AudioContext({ sampleRate: 16000 }); src = ctx.createMediaStreamSource(stream); } catch {
      ctx?.close(); ctx = new win.AudioContext(); src = ctx.createMediaStreamSource(stream);
    }
    await ctx.audioWorklet.addModule(worklet);
    node = new win.AudioWorkletNode(ctx, 'w2-voice-tap', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
    // Vosk takes its block away to its worker, so every holder but the last gets a copy.
    node.port.onmessage = (e) => { const all = [...users]; all.forEach((fn, i) => fn(i < all.length - 1 ? e.data.slice() : e.data, ctx.sampleRate)); };
    src.connect(node);
    if (ctx.state === 'suspended') { onWaiting(true); ctx.resume().then(() => onWaiting(false), () => {}); }
  }
  function close() {
    node?.port && (node.port.onmessage = null); node?.disconnect(); node = null;
    stream?.getTracks().forEach((t) => t.stop()); stream = null;
    ctx?.close().catch(() => {}); ctx = null;
  }
  // A context made with no click yet waits for one: any press on the page lets it run.
  const resume = () => { if (ctx?.state === 'suspended') ctx.resume().then(() => onWaiting(false), () => {}); };
  win.addEventListener?.('pointerdown', resume, true);
  win.addEventListener?.('keydown', resume, true);
  return {
    // Resolves with the rate once the mic is open; a refusal lets go and throws.
    async take(fn) {
      users.add(fn);
      clearTimer(closing); closing = null;
      try {
        if (!win.navigator.mediaDevices?.getUserMedia || !win.AudioWorkletNode) throw new Error('This browser cannot listen here');
        if (!stream) await (opening ??= open().finally(() => { opening = null; }));
        if (!stream) throw new Error('The microphone closed');
      } catch (err) { users.delete(fn); if (!users.size) close(); throw err; }
      return ctx.sampleRate;
    },
    drop(fn) { if (users.delete(fn) && !users.size) { clearTimer(closing); closing = setTimer(() => { closing = null; if (!users.size) close(); }, LINGER_MS); } },
    holds: (fn) => users.has(fn),
    get rate() { return ctx?.sampleRate ?? 16000; },
    get waiting() { return ctx?.state === 'suspended'; },
    set onWaiting(fn) { onWaiting = fn; },
    resume,
  };
}
