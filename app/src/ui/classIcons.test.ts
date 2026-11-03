import { describe, expect, it } from 'vitest';
import * as lucide from 'lucide-react';
import { CLASS_ICONS, suggestIcon } from './classIcons';

const pascal = (kebab: string) => kebab.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');

// Every icon name UX §1.3 and §1.5 use must exist in the pinned lucide-react (1.60.0).
const UX_ICONS = [
  'sun', 'search', 'settings', 'keyboard', 'plus', 'log-in', 'archive', 'user-plus', 'audio-lines', 'files', 'notebook-pen',
  'clipboard-check', 'messages-square', 'sparkles', 'users', 'folder-sync', 'mic', 'mic-off', 'monitor-speaker', 'pause', 'play',
  'square', 'rotate-ccw', 'rotate-cw', 'star', 'circle-question-mark', 'target', 'square-check', 'sticky-note', 'radar',
  'highlighter', 'message-square', 'quote', 'pin', 'reply', 'paperclip', 'send-horizontal', 'at-sign', 'hand-heart', 'file-text',
  'presentation', 'file-image', 'file-audio', 'file', 'scan-text', 'table-of-contents', 'zoom-in', 'zoom-out', 'calendar-clock',
  'calendar-days', 'circle-check', 'contrast', 'circle-x', 'lightbulb', 'split', 'merge', 'graduation-cap', 'refresh-cw',
  'wifi-off', 'circle-pause', 'triangle-alert', 'hard-drive', 'lock', 'users-round', 'laptop', 'monitor', 'qr-code', 'link',
  'copy', 'download', 'upload', 'trash-2', 'undo-2', 'log-out', 'user-minus', 'key-round', 'shield-check', 'bell', 'user',
  'palette', 'audio-waveform', 'cpu', 'battery-low', 'plug', 'languages', 'folder-open', 'external-link', 'info', 'ellipsis',
];

describe('class icons', () => {
  it('every class icon and every UX icon exists in lucide-react', () => {
    const missing = [...CLASS_ICONS, ...UX_ICONS].filter((n) => !(pascal(n) in lucide));
    expect(missing).toEqual([]);
  });

  it('suggests icons from the folded class name (UX §1.3)', () => {
    expect(suggestIcon('Direito Constitucional I')).toBe('scale');
    expect(suggestIcon('Biology 101')).toBe('dna');
    expect(suggestIcon('Estadística I')).toBe('sigma');
    expect(suggestIcon('Música antiga')).toBe('music');
    expect(suggestIcon('Seminário')).toBe('book-open');
  });
});
