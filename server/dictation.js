import { execFile as defaultExecFile } from 'node:child_process';

// A text box starts the Mac's own Dictation by clicking the browser's "Edit › Start Dictation" menu
// item, so nobody has to press Fn twice. Only the frontmost app is clicked, and only when it is a
// browser, matched by bundle id since an installed web app (the board as a Brave or Chrome app) runs
// as `app_mode_loader` under `<browser id>.app.<id>`: a focus the human did not make (another app in
// front) starts nothing. The item's name is Dictation's state: "Stop Dictation" while it runs, then
// "Cancel Dictation" for a second or more after a Stop, until clicked back to Start. Dictation follows
// focus within the app: leaving a box greys the item out, and focusing another shows Stop again on
// its own, so Stop showing is a start already done. Stopping and restarting it there, as an older
// build did, took 3s and, clicked again before the first click landed, wedged it at Stop. Start is
// greyed out until the browser has told macOS a text box has focus, a beat after the page's focus,
// and the item can vanish between reading it and clicking it. Clicks land late (up to 3s in the
// installed app) or not at all, so every one is followed by polling the name. Stop clicks only Stop,
// so the last words still land; with the focus already gone the item is greyed and there is nothing
// to click. It needs the Accessibility permission for whatever runs the wrangler and an English menu.
// The script is fixed: nothing from the browser reaches it.
export const BROWSERS = ['com.google.Chrome', 'org.chromium.Chromium', 'company.thebrowser.Browser', 'com.brave.Browser', 'com.microsoft.edgemac', 'com.vivaldi.Vivaldi', 'com.operasoftware.Opera', 'com.apple.Safari', 'org.mozilla.firefox'];
const list = BROWSERS.map((b) => `"${b}"`).join(', ');

// The script's `error … number N`, as `reason` on the reply; the board says the text.
export const REASONS = {
  1: 'not-front',
  2: 'stuck',
  3: 'no-start',
  4: 'no-item',
  5: 'greyed',
  '-25211': 'no-access',
};
const ACCESS = 'the wrangler is not allowed to click menus: allow it under System Settings › Privacy & Security › Accessibility';

// What touches the menu, through System Events; dictation.test.js swaps in a fake menu for it.
export const MENU = `on state(m)
  tell application "System Events"
    if (menu items of m whose name starts with "Stop Dictation") is not {} then return "stop"
    if (menu items of m whose name starts with "Cancel Dictation") is not {} then return "cancel"
    -- Read in one go: an item found by one query can be gone by the next.
    try
      set lit to enabled of first menu item of m whose name starts with "Start Dictation"
    on error
      return "none"
    end try
    if lit then return "start"
    return "greyed"
  end tell
end state

on clickItem(m, label)
  tell application "System Events" to click (first menu item of m whose name starts with label)
end clickItem

on frontBrowserEdit()
  tell application "System Events"
    set p to first process whose frontmost is true
    set bid to bundle identifier of p
    set ok to false
    repeat with b in {${list}}
      if bid is (b as text) or bid starts with ((b as text) & ".") then set ok to true
    end repeat
    if not ok then error (name of p) & " is in front, not the browser" number 1
    return menu "Edit" of menu bar 1 of p
  end tell
end frontBrowserEdit`;

const FLOW = `-- An item gone between the read and the click is left to the next poll.
on press(m, label)
  try
    clickItem(m, label)
  on error e number n
    if n is not -1728 and e does not contain "Invalid index" then error e number n
  end try
end press

on waitFor(m, want, ticks)
  repeat ticks times
    if state(m) is want then return true
    delay TICK
  end repeat
  return false
end waitFor`;

// Prints how it went (`clicks`, and polls spent waiting for Start to be there and lit) for the log.
const START = `set m to frontBrowserEdit()
set lit to 0
set cancels to 0
repeat 20 times
  set s to state(m)
  if s is "stop" then return "clicks 0 lit " & lit
  if s is "start" then exit repeat
  if s is "cancel" and cancels < 2 then
    set cancels to cancels + 1
    press(m, "Cancel Dictation")
    if waitFor(m, "start", 10) then exit repeat
  end if
  set lit to lit + 1
  delay TICK
end repeat
set s to state(m)
if s is "stop" then return "clicks 0 lit " & lit
if s is "cancel" then error "Dictation stayed at Cancel Dictation" number 2
if s is "none" then error "the Edit menu has no Start Dictation: turn Dictation on under System Settings › Keyboard, in English" number 4
if s is "greyed" then error "Start Dictation stayed greyed out: the browser never said a text box has focus" number 5
repeat with n from 1 to 3
  if state(m) is "start" then press(m, "Start Dictation")
  if waitFor(m, "stop", 20) then return "clicks " & n & " lit " & lit
end repeat
error "Start Dictation was clicked 3 times and Stop Dictation never showed" number 3`;

const STOP = `set m to frontBrowserEdit()
if state(m) is "stop" then press(m, "Stop Dictation")`;

// A tick is how often the menu is polled.
export function dictationScript(start, { menu = MENU, tick = 0.1 } = {}) {
  return `${menu}\n\n${FLOW}\n\n${start ? START : STOP}`.replaceAll('TICK', String(tick));
}

// osascript's stderr, "123:456: execution error: <text> (<number>)", as what the board shows.
export function failure(err, stderr) {
  if (err?.killed) return { reason: 'timeout', error: 'the menu did not answer in time' };
  const m = /execution error: ([\s\S]*) \((-?\d+)\)\s*$/.exec(String(stderr).trim());
  // -1719 is also System Events' "Invalid index", so only its own words say it is the permission.
  const reason = (m && (REASONS[m[2]] || (/assistive access/.test(m[1]) && 'no-access'))) || 'failed';
  return { reason, error: reason === 'no-access' ? ACCESS : m ? m[1] : (String(stderr).trim() || err.message) };
}

// One osascript at a time, and only the newest message waiting: leaving one box for another sends
// stop and start together, and a burst of focus changes would otherwise queue seconds of clicks that
// the last box has to sit through. A start skipped that way answers `superseded`.
export function makeDictationHandler({ execFile = defaultExecFile, platform = process.platform, now = Date.now, menu, tick } = {}) {
  let queue = Promise.resolve(), latest = 0;
  const run = (start) => new Promise((resolve) => execFile('osascript', ['-e', dictationScript(start, { menu, tick })], { timeout: 25000 }, (err, out, stderr) => resolve(err ? failure(err, stderr) : { trace: String(out).trim() })));
  return {
    type: 'dictation',
    async handler(msg, host) {
      const start = msg.start === true, id = typeof msg.id === 'string' ? msg.id.slice(0, 64) : null, n = ++latest, asked = now();
      if (platform !== 'darwin') { if (start) host.broadcast({ event: 'dictation', id, ok: false, reason: 'not-mac', error: 'Dictation can only be started on a Mac' }); return; }
      const done = queue.then(() => (n === latest ? run(start) : { reason: 'superseded', error: 'another box took focus first' }));
      queue = done;
      const { trace, reason, error } = await done;
      const ms = now() - asked;
      if (reason !== 'superseded' && (error || start)) host.log(`dictation ${start ? 'start' : 'stop'} ${error ? `failed (${reason}) ` : 'ok '}${ms}ms`, error || trace);
      if (start) host.broadcast({ event: 'dictation', id, ok: !error, reason: reason ?? null, error: error ?? null, ms });
    },
  };
}
