import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { webHref, createHeardOpener } from './voice-open.js';

test('webHref keeps only an http(s) URL, re-serialised, and refuses every other scheme, a path or a flag', () => {
  assert.equal(webHref('https://github.com/acme/widgets/pull/7'), 'https://github.com/acme/widgets/pull/7');
  assert.equal(webHref('http://localhost:5173/a b'), 'http://localhost:5173/a%20b');
  assert.equal(webHref('HTTPS://Example.com'), 'https://example.com/');
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'vscode://file/x', 'ssh://host', 'x-apple.systempreferences:x', '/Applications/Calculator.app', '-a Calculator', 'example.com', '', null, undefined, 7, `https://x.com/${'a'.repeat(9000)}`]) {
    assert.equal(webHref(bad), null, String(bad).slice(0, 30));
  }
});

function fixture() {
  const window = new Window({ url: 'http://localhost:7878/' });
  const doc = window.document;
  doc.body.innerHTML = '<a id="out" href="https://example.com/report" target="_blank" rel="noopener">↗</a><a id="here" href="https://example.com/same">same tab</a><a id="odd" href="mailto:a@example.com" target="_blank">mail</a><button id="pr">Open on GitHub</button>';
  const sent = [], opened = [], refused = [];
  const opener = createHeardOpener({ doc, send: (m) => sent.push(m), open: (url) => opened.push(url), refuse: (url) => refused.push(url) });
  doc.getElementById('pr').onclick = () => opener.open('https://github.com/acme/widgets/pull/7');
  // Whether the opener stopped the link, read last on the way up; then stopped here, so the test browser never navigates.
  let stopped = null;
  window.addEventListener('click', (e) => { stopped = e.defaultPrevented; e.preventDefault(); });
  const click = (id) => { doc.getElementById(id).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })); return { defaultPrevented: stopped }; };
  return { doc, opener, sent, opened, refused, click };
}

test('a key or the pointer opens in the browser as before: nothing goes to the server and a link keeps its default', () => {
  const f = fixture();
  f.opener.open('https://example.com/a');
  assert.equal(f.click('pr').defaultPrevented, false);
  assert.equal(f.click('out').defaultPrevented, false, 'the link opens its own tab');
  assert.deepEqual(f.opened, ['https://example.com/a', 'https://github.com/acme/widgets/pull/7']);
  assert.deepEqual(f.sent, []);
});

test('a press heard sends each new tab to the server instead: a button that opens a URL and a target=_blank link, whose own tab is stopped', () => {
  const f = fixture();
  assert.equal(f.opener.heard(() => f.click('pr')).defaultPrevented, false);
  assert.equal(f.opener.heard(() => f.click('out')).defaultPrevented, true, 'the blocked tab never tries');
  assert.deepEqual(f.sent, [{ type: 'job-open-url', url: 'https://github.com/acme/widgets/pull/7' }, { type: 'job-open-url', url: 'https://example.com/report' }]);
  assert.deepEqual(f.opened, []);
  assert.equal(f.opener.heard(() => f.click('here')).defaultPrevented, false, 'a same-tab link is no popup: left alone');
  assert.equal(f.sent.length, 2);
  f.click('out');
  assert.equal(f.sent.length, 2, 'only while the heard press runs');
});

test('a press heard on a link that is not http(s) is refused, never sent; one whose handler took its own click is left alone', () => {
  const f = fixture();
  assert.equal(f.opener.heard(() => f.click('odd')).defaultPrevented, true);
  assert.deepEqual(f.refused, ['mailto:a@example.com']);
  f.opener.heard(() => f.opener.open('file:///etc/passwd'));
  assert.deepEqual(f.refused, ['mailto:a@example.com', 'file:///etc/passwd']);
  f.doc.getElementById('out').addEventListener('click', (e) => e.preventDefault());
  f.opener.heard(() => f.click('out'));
  assert.deepEqual(f.sent, []);
});

test('a heard press that throws still ends, so the next key or click opens in the browser', () => {
  const f = fixture();
  assert.throws(() => f.opener.heard(() => { throw new Error('boom'); }));
  f.opener.open('https://example.com/after');
  assert.deepEqual(f.opened, ['https://example.com/after']);
  assert.equal(f.opener.heard(() => 'pressed'), 'pressed', 'say’s answer comes back');
});
