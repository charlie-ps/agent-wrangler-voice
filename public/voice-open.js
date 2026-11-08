// A word Voice heard presses from the recognizer's callback (job-voice.js), which carries no user
// activation, so the browser's popup blocker silently drops whatever it opens in a new tab:
// `window.open` and a target=_blank link's click alike. While a heard word presses (`heard`), each goes
// to the server's `open` instead (server/handlers.js `makeOpenUrlHandler`), http(s) only. A key or the
// pointer is a gesture of its own and keeps the browser's tab.

// The URL as one http(s) href, re-serialised, or null: never a file, an app or another scheme's handler.
export function webHref(url) {
  if (typeof url !== 'string' || url.length > 8192) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

export const OPENS_TAB = 'a[href][target="_blank"]';

// `open(url)` is the browser's own new tab, `send` the control socket, `refuse(url)` says why a link
// heard went nowhere. A link's click is taken on its way up to `doc`, after every handler on the way
// had its say, so one that handles its own click (and prevents the default) is left alone.
export function createHeardOpener({ doc, send, open, refuse = () => {} }) {
  let heard = 0;
  function out(url) {
    if (!heard) return open(url);
    const href = webHref(url);
    if (href) send({ type: 'job-open-url', url: href });
    else refuse(url);
  }
  doc.addEventListener('click', (e) => {
    if (!heard || e.defaultPrevented) return;
    const a = e.target?.closest?.(OPENS_TAB);
    if (!a) return;
    e.preventDefault();
    out(a.href);
  });
  return {
    open: out,
    heard(press) {
      heard++;
      try { return press(); } finally { heard--; }
    },
  };
}
