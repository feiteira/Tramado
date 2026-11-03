// Class icons (UX §1.3): every name exists in lucide 1.60.0 (classIcons.test.ts).
import { CLASS_ICONS, type ClassIconName } from '../core/model/icons';
import { suggestIconFor } from '../core/model/icons';

export { CLASS_ICONS, type ClassIconName };

/** The icon of the first keyword row matching the folded class name; `book-open` when none does. */
export const suggestIcon = (name: string): ClassIconName => suggestIconFor(name);
