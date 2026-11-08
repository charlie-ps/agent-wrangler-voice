# Voice (fork-only)

Wrangler²'s Voice, ported onto Agent Wrangler's own board. Everything is heard on this Mac: Vosk's
small English model in the browser for the labels, Apple's SpeechTranscriber in a Swift helper for text
boxes. Never the browser's Web Speech API, which sends audio away.

## Using it

- **Settings › Shortcuts › Labels**: *Off* (the default) draws nothing; ⌃⌘A still jumps to a session.
  *Keyboard* draws a letter on everything a pointer would press (the rail, every session card and board
  button, a session's panel, an open dialog or card menu): type it to press it. *Voice* draws words
  instead: say one to press it.
- **The mic in the rail** turns Voice on and off. The first time, it asks before anything is
  downloaded: Vosk's model is 41 MB from `ccoreilly.github.io`, fetched once by the board's own server
  and kept only if its SHA-256 matches the pin. Then it sets up Apple's speech helper (built once with
  `swiftc`) and macOS's English speech model, with progress round the mic and in a panel beside it. No
  label is drawn until that is done. Its tooltip always says what Voice is doing and what it last heard.
- **Words**: a button says its own word where it has one ("settings", "search", "launch", "cancel");
  anything else (a session card, an icon) takes a short word ("lamp", "pond", "ship"). A card keeps its
  word while it redraws. "up" and "down" scroll by most of a screen, "upper" and "lower" by a few lines,
  "top" and "bottom" to either end, whatever is in front (a dialog, else the board or Search).
- **Text boxes**: focus one (a prompt, the chat composer, a search box) and what you say is typed at
  the cursor. Enter sends as usual. Esc, or the escape word (Settings › Shortcuts › Voice escape word,
  "lamp" unless you change it), leaves the box: what came before it stays, and what you say after it
  presses labels or scrolls ("… lamp settings"). Typing in the box stops the recording until you leave
  and come back. Where the helper cannot run (before macOS 26, no `swiftc`), the box falls back to the
  Mac's own Dictation, clicked from the browser's Edit menu (needs Accessibility for the wrangler).
- **Links** a word presses open through the server (`open <url>`, http(s) only), since a recognizer's
  callback cannot open a tab past the popup blocker.
- **Wrangler²'s Jobs view**: while it is in front, its own Voice keeps the mic; this one stops, draws
  nothing, and starts again when the board is back.
- Words act only while the board's window has focus; away, Voice pauses with the mic held, so ⌘-Tab
  back needs no click.

## Where it lives

All Voice code is in new files; upstream files change only at small hook points, so the daily upstream
merge stays cheap:

| Upstream file | Hook |
|---|---|
| `public/app.js` | creates `initBoardVoice` after Settings, hands it each control frame and each setting change |
| `public/settings.js` | spreads in `VOICE_SETTINGS` and lists them on the Shortcuts tab |
| `public/settings.test.js` | expects the two new settings |
| `server/control/handlers/index.js` | routes `VOICE_HANDLERS` |
| `server/board-acceptance.test.js` | waits for the probe extension after its reload (a race Voice's extra modules made routine) |
| `package.json` | `happy-dom` for the ported DOM tests |
| `.gitignore`, `README.md` | the served model's folder; the fork note |

New: `public/board-voice.js` (the integration: targets, mic, setup panel, dictation, scroll commands,
the Jobs-view hand-over), `public/voice-settings.js`, `public/voice.css`, `server/voice-handlers.js`,
and the modules ported from Wrangler² (listed in [NOTICE](NOTICE)). Risks and checks:
[SECURITY-NOTES.md](SECURITY-NOTES.md).

## Running it beside the live board

```bash
AW_PORT=7788 AW_DATA_DIR=~/.agent-wrangler-voice AW_DEV=1 node server/index.js
```

Keep the data dir under your home folder, not `/tmp`: the speech helper is built into
`<data dir>/voice-speech/`, and some Macs refuse to run an unsigned binary from `/tmp`.

## Upstream sync

`.github/workflows/upstream-sync.yml` runs `scripts/upstream-sync.sh` daily (and by hand): it fetches
upstream's `main`, merges it into the fork's `main` with a merge commit and pushes only to `origin`;
the `upstream` remote's push URL is set to `DISABLED` first. A merge that would conflict changes nothing
on `main`: upstream's `main` goes to a `sync/upstream-<sha>` branch on the fork and a pull request there
asks for the conflicts to be resolved. `DRY_RUN=1 bash scripts/upstream-sync.sh` prints the plan. A
merge that touches upstream's own workflow files needs a `SYNC_TOKEN` secret (a fine-grained token on
the fork with Contents, Pull requests and Workflows read/write), since `GITHUB_TOKEN` may not push one.
