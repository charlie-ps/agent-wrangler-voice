// Voice's two settings (board-voice.js), on Settings › Shortcuts: kept here so settings.js only spreads
// them in. Per browser, as the board's other Shortcuts settings are: the mic is this browser's.
import { LABEL_MODES, LABEL_NAMES } from './label-modes.js';
import { DEFAULT_ESCAPE_WORD } from './voice-box.js';

export const VOICE_SETTINGS = [
  {
    id: 'labels',
    type: 'segmented',
    label: 'Labels',
    help: 'Badges on the board’s buttons, tabs, session cards and dialogs. Keyboard draws letters: type one to press it. Voice draws words: say one to press it, say “up”, “down”, “upper”, “lower”, “top” or “bottom” to scroll, and speak into a focused text box to type. Voice hears you on this computer only, with Vosk’s small English model (41 MB, downloaded once after you agree) and Apple’s speech helper for text boxes. The mic in the rail shows while Voice is on; click it to turn Voice off. ⌃⌘A still jumps to a session in any mode.',
    options: LABEL_MODES.map((value) => ({ value, label: LABEL_NAMES[value] })),
    default: 'off',
  },
  {
    id: 'escapeWord',
    type: 'text',
    label: 'Voice escape word',
    help: `Said while you speak into a text box, it leaves the box: what came before it stays, and what you say after it presses labels or scrolls. Pick a word your prose never says. “${DEFAULT_ESCAPE_WORD}” when blank.`,
    placeholder: DEFAULT_ESCAPE_WORD,
    default: '',
  },
];
export const VOICE_SETTING_IDS = VOICE_SETTINGS.map((s) => s.id);
