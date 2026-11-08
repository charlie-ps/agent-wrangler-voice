// Ported from Wrangler²'s public/busy-button.js (Copyright Charlie Goldstraw, Apache-2.0; see NOTICE):
// only its press signature, which job-keys.js uses to know a target redrawn in place for the same one.

// Ancestors that name what a button acts on (a conversation's Dismiss, a checkout's Retry).
const TARGETS = ['data-convo', 'data-main-path'];
// A button as a redraw draws it again: its ids, data and target, never its text or busy marks.
export const pressSig = (b) => [b.tagName, b.id, b.name, b.getAttribute('value') ?? '', b.closest('form')?.id || '',
  ...TARGETS.map((a) => `${a}=${b.closest(`[${a}]`)?.getAttribute(a) ?? ''}`),
  ...[...b.attributes].filter((a) => a.name.startsWith('data-') && !a.name.startsWith('data-busy')).map((a) => `${a.name}=${a.value}`).sort()].join('|');
