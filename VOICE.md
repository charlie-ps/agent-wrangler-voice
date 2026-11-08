# Voice (fork-only)

Wrangler²'s Voice, ported onto Agent Wrangler's own board. Everything is heard on your own computer:
Vosk's small English model in the browser for the labels, and for text boxes Apple's SpeechTranscriber
in a Swift helper on a Mac, or the same Vosk model in the browser elsewhere (Linux, WSL2). Never the
browser's Web Speech API, which sends audio away.

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
- **Links** a word presses open through the server, http(s) only, since a recognizer's callback cannot
  open a tab past the popup blocker: `open <url>` on a Mac, `xdg-open <url>` on Linux, and under WSL
  `wslview <url>` (from wslu), else `explorer.exe <url>`, so the link lands in Windows' default browser.
- **Wrangler²'s Jobs view**: while it is in front, its own Voice keeps the mic; this one stops, draws
  nothing, and starts again when the board is back.
- Words act only while the board's window has focus; away, Voice pauses with the mic held, so ⌘-Tab
  back needs no click.

## Linux and WSL2

The board can run on Linux, or in WSL2 with the browser on Windows (WSL2 forwards `localhost`, so the
Windows browser opens `http://localhost:<port>` and its microphone is the one used). Nothing changes on
a Mac. Off one:

- **Setup** asks the server, which answers that it is not a Mac: Apple's speech helper and macOS's
  speech model are shown as skipped (not failed), the Download warning says so, and labels are drawn
  as soon as Vosk's model has loaded.
- **Text boxes** record with the same pinned Vosk model, in the browser, through a recognizer with no
  word list, so it hears prose rather than only the words on screen. It writes lowercase and
  unpunctuated, and a pause ends one stretch and starts the next. The escape word, Enter, Esc and
  typing work as on a Mac. There is no Dictation fallback: a rich (contenteditable) box takes nothing
  and says so.
- **Links** go to `xdg-open` (from xdg-utils, so your desktop's default browser), or under WSL to
  `wslview`, else `explorer.exe`. Each runs detached with the one argument and no shell; one that is
  missing or fails is said in a toast. WSL is told by `WSL_DISTRO_NAME`/`WSL_INTEROP`, or a kernel
  release naming Microsoft.
- **Microphone**: the browser needs a secure origin for it, which `http://localhost` is. A board
  reached by another host name or a LAN address has no microphone.

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
the Jobs-view hand-over), `public/voice-settings.js`, `public/voice-local.js` (text boxes off a Mac),
`public/voice.css`, `server/voice-handlers.js` (with the Linux and WSL link openers), and the modules ported from Wrangler² (listed in [NOTICE](NOTICE)). Risks and checks:
[SECURITY-NOTES.md](SECURITY-NOTES.md).

## Running it beside the live board

```bash
AW_PORT=7788 AW_DATA_DIR=~/.agent-wrangler-voice AW_DEV=1 node server/index.js
```

Keep the data dir under your home folder, not `/tmp`: the speech helper is built into
`<data dir>/voice-speech/`, and some Macs refuse to run an unsigned binary from `/tmp`. The same command
runs it on Linux or in WSL2; open `http://localhost:7788` in the browser (Windows' own, under WSL2).
The tests run on Ubuntu in CI (`.github/workflows/test.yml`), where the Mac-only ones skip.

## Upstream sync

`.github/workflows/upstream-sync.yml` runs `scripts/upstream-sync.sh` daily (and by hand): it fetches
upstream's `main`, merges it into the fork's `main` with a merge commit and pushes only to `origin`;
the `upstream` remote's push URL is set to `DISABLED` first. A merge that would conflict changes nothing
on `main`: upstream's `main` goes to a `sync/upstream-<sha>` branch on the fork and a pull request there
asks for the conflicts to be resolved. `DRY_RUN=1 bash scripts/upstream-sync.sh` prints the plan. A
merge that touches upstream's own workflow files needs a `SYNC_TOKEN` secret (a fine-grained token on
the fork with Contents, Pull requests and Workflows read/write), since `GITHUB_TOKEN` may not push one.
