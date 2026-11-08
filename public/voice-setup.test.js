import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSetupSteps, createHelperSetup, setupHtml, STEPS } from './voice-setup.js';

test('the setup lists the Vosk model, the helper’s build and macOS’s speech model, and counts a step part-way by its fraction', () => {
  let changes = 0;
  const steps = createSetupSteps({ onChange: () => changes++ });
  assert.deepEqual(steps.steps.map((s) => [s.id, s.state]), [['vosk', 'todo'], ['helper', 'todo'], ['speech', 'todo']]);
  assert.match(setupHtml(steps.steps, false), /Vosk.*speech helper.*swiftc.*macOS’s English speech model.*Labels appear once this is done/s);
  steps.set('vosk', 'active', { note: 'downloading', fraction: 0.5 });
  assert.equal(steps.progress, 0.5 / 3);
  steps.set('vosk', 'active', { note: 'downloading', fraction: 0.5 });
  assert.equal(changes, 1, 'the same again changes nothing');
  steps.set('vosk', 'done'); steps.set('helper', 'failed', { note: '<b>no</b>' }); steps.set('speech', 'skipped');
  assert.equal(steps.progress, 1);
  assert.equal(steps.done, true);
  assert.match(setupHtml(steps.steps, true), /Voice is ready.*&lt;b&gt;no&lt;\/b&gt;/s, 'a server’s words are escaped');
  steps.reset();
  assert.equal(steps.done, false);
  assert.equal(STEPS.length, 3);
});

test('the helper’s setup goes over the socket under its own id and settles on installed, or on the error, never rejecting', async () => {
  const sent = [], steps = createSetupSteps();
  const h = createHelperSetup({ send: (m) => sent.push(m), steps, tag: 'b' });
  const run = h.run();
  assert.deepEqual(sent, [{ type: 'speech', op: 'setup', id: 'b-setup-1' }]);
  assert.equal(h.take({ id: 'b-1', kind: 'ready' }), false, 'a recording’s reply is not its own');
  const say = (kind, more = {}) => assert.equal(h.take({ id: 'b-setup-1', kind, ...more }), true);
  say('building');
  assert.match(steps.steps[1].note, /building/);
  say('built');
  say('installing', { fraction: 0.25 });
  assert.deepEqual([steps.steps[1].state, steps.steps[2].state, steps.steps[2].note], ['done', 'active', 'downloading, 25%']);
  say('installed');
  assert.equal(await run, null);
  assert.equal(steps.steps[2].state, 'done');
  const down = h.run();
  assert.equal(h.take({ id: 'b-setup-1', kind: 'installed' }), false, 'a finished run hears no more');
  h.take({ id: 'b-setup-2', kind: 'error', reason: 'no-swiftc', error: 'swiftc is not installed' });
  assert.deepEqual(await down, { reason: 'no-swiftc', error: 'swiftc is not installed' });
  assert.deepEqual(steps.steps.slice(1).map((s) => s.state), ['failed', 'skipped'], 'no helper: the boxes use Dictation');
});

test('off a Mac the server says not-mac at once: both Apple steps are skipped, not failed, and the labels go ahead', async () => {
  const sent = [], steps = createSetupSteps();
  const h = createHelperSetup({ send: (m) => sent.push(m), steps, tag: 'b' });
  steps.set('vosk', 'done');
  const run = h.run();
  h.take({ id: 'b-setup-1', kind: 'error', step: 'helper', reason: 'not-mac', error: 'Apple’s speech helper only runs on a Mac' });
  assert.deepEqual(await run, { reason: 'not-mac', error: 'Apple’s speech helper only runs on a Mac' });
  assert.deepEqual(steps.steps.map((s) => s.state), ['done', 'skipped', 'skipped']);
  assert.equal(steps.done, true, 'nothing holds the labels back');
  assert.match(setupHtml(steps.steps, true), /Voice is ready.*only on a Mac.*Vosk’s model in the browser/s);
  assert.doesNotMatch(setupHtml(steps.steps, true), /Dictation/, 'Dictation is not offered off a Mac');
});
