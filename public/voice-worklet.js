// Voice labels' microphone tap (job-voice.js): the audio thread hands the page 512-sample blocks,
// 32ms at 16kHz, so the recognizer sees each word within a block of its sound reaching the page.
const BLOCK = 512;
class VoiceTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(BLOCK); this.n = 0; }
  process([input]) {
    const ch = input?.[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === BLOCK) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Float32Array(BLOCK); this.n = 0; }
    }
    return true;
  }
}
registerProcessor('w2-voice-tap', VoiceTap);
