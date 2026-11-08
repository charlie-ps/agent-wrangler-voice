import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDictationHandler, dictationScript, failure, MENU } from './dictation.js';

function setup({ fail = null, platform = 'darwin' } = {}) {
  const runs = [], said = [], logged = [];
  const execFile = (cmd, args, opts, cb) => { runs.push([cmd, ...args]); cb(fail && new Error('exit 1'), fail ? '' : 'clicks 1 lit 0', fail || ''); };
  const host = { broadcast: (m) => said.push(m), log: (...a) => logged.push(a) };
  const h = makeDictationHandler({ execFile, platform, now: () => 0 });
  return { runs, said, logged, run: (msg) => h.handler(msg, host) };
}

// The real script run by the real osascript against a menu that is only AppleScript: `polls` is its
// clock. A Start click on a lit Start lands `lands[n]` polls later (0: never); greyed until poll
// `lit`; `none` has no Start item at all; Stop and Cancel go back to Start at once unless `stuck`;
// `vanish` loses the first Start click to the item changing under it.
const fakeMenu = ({ shown = 'start', lit = 0, lands = [1], stuck = false, vanish = false } = {}) => `property polls : 0
property vanished : ${!vanish}
property shown : "${shown}"
property landAt : 0
property clicks : 0
property lands : {${lands.join(', ')}}

on frontBrowserEdit()
  return "Edit"
end frontBrowserEdit

on state(m)
  set polls to polls + 1
  if landAt > 0 and polls ≥ landAt then
    set shown to "stop"
    set landAt to 0
  end if
  if shown is "start" and polls ≤ ${lit} then return "greyed"
  return shown
end state

on clickItem(m, label)
  if label is not ("Start Dictation") then
    if not ${stuck} then set shown to "start"
    return
  end if
  if not vanished then
    set vanished to true
    error "Can’t get menu item \\"Start Dictation\\"." number -1728
  end if
  if shown is not "start" then error "Can’t get menu item 1 whose name starts with \\"Start Dictation\\". Invalid index." number -1719
  if polls ≤ ${lit} then return
  set clicks to clicks + 1
  if clicks ≤ (count of lands) and item clicks of lands > 0 then set landAt to polls + (item clicks of lands)
end clickItem`;

const onMac = { skip: process.platform !== 'darwin' && 'osascript is a Mac’s' };
async function startOn(menu) {
  const said = [], logged = [];
  const h = makeDictationHandler({ menu: fakeMenu(menu), tick: 0.01 });
  await h.handler({ start: true, id: 'b-1' }, { broadcast: (m) => said.push(m), log: (...a) => logged.push(a) });
  return { ...said[0], logged: logged[0][1] };
}

test('on a menu that answers at once one click starts it', onMac, async () => {
  const r = await startOn({});
  assert.equal(r.ok, true);
  assert.equal(r.logged, 'clicks 1 lit 0');
});

test('a slow first click: Start is clicked again until Stop shows, and no more', onMac, async () => {
  const r = await startOn({ lands: [0, 3] });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.logged, 'clicks 2 lit 0');
});

test('Start greyed out while the browser catches up with the focus is waited for, not clicked too early', onMac, async () => {
  const r = await startOn({ lit: 6 });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.logged, 'clicks 1 lit 6');
  const never = await startOn({ lit: 999 });
  assert.deepEqual([never.ok, never.reason], [false, 'greyed']);
});

test('no Start item: says so and clicks nothing, rather than failing on an invalid index', onMac, async () => {
  const r = await startOn({ shown: 'none' });
  assert.deepEqual([r.ok, r.reason], [false, 'no-item']);
  assert.match(r.error, /no Start Dictation/);
});

test('Stop already showing is Dictation following the focus into this box: nothing is clicked', onMac, async () => {
  assert.equal((await startOn({ shown: 'stop' })).logged, 'clicks 0 lit 0');
});

test('a Cancel left over is clicked back to Start, then Start; one that stays is reported', onMac, async () => {
  assert.equal((await startOn({ shown: 'cancel' })).logged, 'clicks 1 lit 0');
  const stuck = await startOn({ shown: 'cancel', stuck: true });
  assert.deepEqual([stuck.ok, stuck.reason], [false, 'stuck']);
});

test('an item that changes between the read and the click is polled again, not a failure', onMac, async () => {
  const r = await startOn({ vanish: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.logged, 'clicks 2 lit 0');
});

test('clicks that never land give up after three', onMac, async () => {
  const r = await startOn({ lands: [0, 0, 0] });
  assert.deepEqual([r.ok, r.reason], [false, 'no-start']);
});

test('start clicks the frontmost browser’s Edit menu and answers with its id, timing and reason', async () => {
  const s = setup();
  await s.run({ start: true, id: 'b-1' });
  assert.deepEqual(s.runs, [['osascript', '-e', dictationScript(true)]]);
  assert.deepEqual(s.said, [{ event: 'dictation', id: 'b-1', ok: true, reason: null, error: null, ms: 0 }]);
  assert.deepEqual(s.logged, [['dictation start ok 0ms', 'clicks 1 lit 0']]);
  assert.match(MENU, /whose frontmost is true[\s\S]*bundle identifier of p[\s\S]*"com\.brave\.Browser"[\s\S]*starts with \(\(b as text\) & "\."\)/);
  await s.run({ start: false });
  assert.match(s.runs[1][2], /set m to frontBrowserEdit\(\)\nif state\(m\) is "stop" then press\(m, "Stop Dictation"\)$/);
  assert.equal(s.said.length, 1, 'a stop answers nothing');
});

test('a burst of focus changes runs only the newest message waiting; the starts it skipped say so', async () => {
  const runs = [], finish = [], said = [];
  const execFile = (cmd, args, opts, cb) => { runs.push({ start: args[1] === dictationScript(true), timeout: opts.timeout }); finish.push(() => cb(null, '', '')); };
  const h = makeDictationHandler({ execFile, platform: 'darwin' });
  const host = { broadcast: (m) => said.push(m), log() {} };
  const first = h.handler({ start: true, id: 'a' }, host);
  await new Promise((r) => setImmediate(r));
  const all = [first, h.handler({ start: false }, host), h.handler({ start: true, id: 'b' }, host), h.handler({ start: false }, host), h.handler({ start: true, id: 'c' }, host)];
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(runs.map((r) => r.start), [true], 'one at a time');
  finish.shift()();
  for (let i = 0; i < 10 && runs.length < 2; i++) await new Promise((r) => setImmediate(r));
  assert.deepEqual(runs.map((r) => r.start), [true, true], 'the stops and b skipped');
  finish.shift()();
  await Promise.all(all);
  assert.deepEqual(said.map((m) => [m.id, m.ok, m.reason]), [['a', true, null], ['b', false, 'superseded'], ['c', true, null]]);
  assert.ok(runs.every((r) => r.timeout >= 10000));
});

test('a failed start says why, in words the board can show', () => {
  const err = new Error('exit 1');
  assert.deepEqual(failure(err, '12:34: execution error: Slack is in front, not the browser (1)'), { reason: 'not-front', error: 'Slack is in front, not the browser' });
  assert.equal(failure(err, '1:2: execution error: System Events got an error: osascript is not allowed assistive access. (-1719)').reason, 'no-access');
  assert.equal(failure(err, '1:2: execution error: System Events got an error: osascript is not allowed to send keystrokes. (-25211)').reason, 'no-access');
  assert.equal(failure(err, '1:2: execution error: System Events got an error: Can’t get menu item 1. Invalid index. (-1719)').reason, 'failed');
  assert.equal(failure(Object.assign(err, { killed: true }), '').reason, 'timeout');
});

test('no Accessibility permission: the start answers why and both are logged', async () => {
  const s = setup({ fail: '1:2: execution error: System Events got an error: osascript is not allowed assistive access. (-1719)' });
  await s.run({ start: true, id: 'x' });
  assert.equal(s.said[0].reason, 'no-access');
  assert.match(s.said[0].error, /Accessibility/);
  await s.run({ start: false });
  assert.deepEqual(s.logged.map(([what]) => what.replace(/ \d+ms$/, '')), ['dictation start failed (no-access)', 'dictation stop failed (no-access)']);
});

test('off a Mac nothing runs, and whatever the message holds the script is fixed', async () => {
  const s = setup({ platform: 'linux' });
  await s.run({ start: true, id: 'x' });
  assert.deepEqual(s.runs, []);
  assert.deepEqual([s.said[0].ok, s.said[0].reason], [false, 'not-mac']);
  const t = setup();
  await t.run({ start: true, app: '" & do shell script "id', id: { evil: 1 } });
  assert.deepEqual(t.runs[0], ['osascript', '-e', dictationScript(true)]);
  assert.equal(t.said[0].id, null);
});
