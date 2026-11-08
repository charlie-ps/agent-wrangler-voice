// Voice's third-party pieces, pinned (ported from Wrangler²; job-voice.js, server/voice-model.js): DOM-free, so the server
// that fetches the model and the browser that loads it check the same hash.
//
// The model: Vosk's small English model as vosk-browser's tar.gz, whose files are byte-identical to
// alphacephei.com's own vosk-model-small-en-us-0.15.zip (checked when pinned). The server fetches it
// once, keeping it only if it hashes to `sha256`, in DATA_DIR/voice-model/ so an update of the checkout
// keeps it, and serves it from public/voice-model/ (gitignored); the browser hashes it again before
// Vosk reads a byte: a changed file anywhere on the way is refused.
export const VOICE_MODEL = {
  file: 'vosk-model-small-en-us-0.15.tar.gz',
  from: 'https://ccoreilly.github.io/vosk-browser/models/vosk-model-small-en-us-0.15.tar.gz',
  sha256: 'f0b24bb92a48ca575b6a96500d6b543f0f079c573dfe85bbe16001fc0404e1d8',
  bytes: 41184862,
};
export const VOICE_MODEL_DIR = 'voice-model';

// public/vendor/vosk-browser.js is npm's vosk-browser@0.0.8 dist/vosk.js under a one-line header,
// unchanged: `sha256` is that file's, and `integrity` the registry's signed tarball it came from
// (`npm pack vosk-browser@0.0.8` reproduces both). job-voice.test.js fails if a byte of it changes.
export const VOSK_BROWSER = {
  version: '0.0.8',
  sha256: '29504515526e974f4cb053cf08811c4de5fb2a74007c0a5a957db50eaa8d5d0c',
  integrity: 'sha512-df9MuChirUGKxP/+4k8tBV6hJOic8IRdJXv64+ET0Ue5CddOzLZINiHOWCka765gBzHJWNtQKgaYakS0FXZIJA==',
};
