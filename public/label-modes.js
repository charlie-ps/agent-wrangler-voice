// Settings › Shortcuts › Labels (ported from Wrangler²; board-voice.js, job-keys.js, job-voice.js):
// DOM-free. Off draws no badges (⌃⌘A still jumps to a session), Keyboard draws letters and Voice
// draws words, which the microphone hears.
export const LABEL_MODES = ['off', 'keyboard', 'voice'];
export const LABEL_NAMES = { off: 'Off', keyboard: 'Keyboard', voice: 'Voice' };

// Settings from before Voice carry the Keyboard labels switch: on reads as Keyboard. An explicit
// `labels` wins, so a patch over old settings is never undone by the switch it replaced.
export function migrateLabels(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s) || !('keyLabels' in s)) return s;
  const { keyLabels, ...out } = s;
  if (out.labels === undefined) out.labels = keyLabels === true ? 'keyboard' : 'off';
  return out;
}
export const labelsOf = (s) => {
  const mode = migrateLabels(s || {}).labels;
  return LABEL_MODES.includes(mode) ? mode : 'off';
};
// ⌃⌘V: Voice goes to Keyboard and anything else to Voice.
export const swapLabels = (mode) => (mode === 'voice' ? 'keyboard' : 'voice');
