# Security notes: Voice (fork-only)

Voice is ported from Wrangler² with its pins, checks and limits unchanged. These are its accepted risks
and the checks that answer each finding, as they apply to this board. Re-review on any change to the
vendored bundle, the model pin (`public/voice-model.js`) or a `voice:` control handler.

## Accepted risks

- vosk-browser (main bundle, its worker and a prebuilt WASM blob) runs in the board's origin once Voice
  is on, with everything that origin can do (the control socket that starts agent sessions). It is
  pinned to a signed, unchanged release (npm `vosk-browser@0.0.8`), but that release (2022,
  unmaintained) is trusted as published: the WASM is not rebuilt from source here. Isolating it in an
  opaque-origin sandboxed iframe would need a patched build, since vosk-browser keeps its model in
  IndexedDB, which an opaque origin cannot open. It is imported only once Voice is switched on (off by
  default).
- Once the microphone is allowed for the board's origin, any other code in that origin (an extension's
  client) could open it without a new prompt. Voice stops its tracks when it is switched off or hands
  the mic to Wrangler²'s Jobs view, and the browser shows its recording indicator while any track is
  live.
- Where Apple's speech helper cannot run, a focused text box falls back to the Mac's Dictation, started
  by the server running a constant `osascript` (System Events clicking the frontmost browser's Edit ›
  Start Dictation). That needs the Accessibility permission for the process running the wrangler,
  which lets any code in it drive the UI: that grant is the human's choice and nothing else needs it.
  Nothing from the control socket reaches the script.

## Checks

- **The model**: never fetched by the browser from a third party. The server fetches it
  (`server/voice-model.js`) from the pinned URL only on the human's Download in Voice's warning
  (`public/voice-consent.js`); any other ask only checks the disk. It is streamed to a temporary file,
  never past the pinned size, and kept only if its SHA-256 matches the pin. The kept copy lives in
  `DATA_DIR/voice-model/` and `public/voice-model/` (gitignored) only serves it, restored from the cache
  only when what lands hashes to the pin. The browser hashes the served file again before Vosk reads it
  and refuses to start on a mismatch; vosk-browser then keeps the extracted model in this origin's
  IndexedDB and reads it from there on later loads, unchecked.
- **The vendored bundle**: `public/vendor/vosk-browser.js` is npm's `vosk-browser@0.0.8` `dist/vosk.js`
  under a one-line header; its SHA-256 and the registry's signed tarball integrity are recorded in
  `public/voice-model.js`, and `public/job-voice.test.js` fails if a byte of it changes
  (`.gitattributes` keeps git from touching its line endings).
- **No Web Speech API**: it sends audio away. `public/job-voice.test.js` greps every Voice module for it.
- **The speech helper** (`server/speech.js`, `server/speech-helper.swift`): built from source with
  Apple's `swiftc` into `DATA_DIR/voice-speech/` (0700), named by the source's hash, and run with fixed
  arguments: a sample rate bounded to an integer 8000–48000 and a constant word list. Nothing else from
  the browser reaches it but PCM bytes on stdin. At most two recordings at once, 5 minutes each,
  256 KB frames, and frames are dropped once a recording's unread backlog passes 2 MB, so a client
  flooding audio cannot grow the wrangler's memory. SpeechTranscriber runs on this Mac: audio never
  leaves it (macOS may fetch its own English speech model through `AssetInventory`; no audio goes with
  that request).
- **Replies go to the asking board only**: every `voice:` handler answers on the socket that asked
  (`server/voice-handlers.js`), so a transcript never reaches another board. Transcribed text is
  written into a box as a field's value and status lines are `textContent`: nothing a transcript says
  becomes markup.
- **Links a heard word opens** (`voice:open-url`): the recognizer's callback has no user activation, so
  the server opens it instead. It takes only a string that parses as an `http:` or `https:` URL (at
  most 8192 characters) and passes its re-serialised `href` as the one argument, no shell, to a fixed
  command: `execFile('open', …)` on a Mac; off one `spawn` (detached, stdio ignored) of `xdg-open` on
  Linux, or under WSL `wslview`, else `explorer.exe`. Anything else (`file:`, `javascript:`, an app
  path, a custom scheme, a leading `-`) is refused without running anything; the href always starts
  `http`, so none of them reads it as a flag. A control-socket client can therefore only make the
  default browser (Windows' under WSL) load a web page, less than it can already do. The command is
  found on the server's `PATH`, like the agents it launches.
- **Text boxes off a Mac** (`public/voice-local.js`): the same pinned, hashed Vosk model in the
  browser, with a recognizer that has no word list. Audio stays in the browser; nothing new is
  fetched or sent to the server.
- **Control types**: Voice's handlers are `voice:model`, `voice:speech`, `voice:dictation` and
  `voice:open-url`, never a type Wrangler²'s extension registers, so both can be installed on one
  board (`server/voice-handlers.test.js`).

## Living threat model

The board is a localhost web app; every extension's client code shares its origin and can drive its
control socket, which starts agent sessions with shell access. Third-party code loaded into that origin
is therefore as trusted as the board itself. Voice adds: a vendored recognizer (pinned), a model file
fetched once by the server from a pinned URL and hash, only on the human's explicit Download,
microphone access, a speech helper the server builds with Apple's swiftc and feeds the microphone's PCM
for a focused text box (text comes back; audio stays on the Mac), the Dictation fallback's constant
menu click, and `open` (`xdg-open`, `wslview` or `explorer.exe` off a Mac) for http(s) links a heard
word presses. Off a Mac there is no helper and no Dictation: text boxes use Vosk in the browser.
