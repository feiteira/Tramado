// Class icon names (UX §1.3), every one verified in lucide 1.60.0 (ui/classIcons.test.ts). Kept in core so
// view models (services/types/viewModels.ts) can name the type without importing the UI layer;
// ui/classIcons.ts re-exports them with suggestIcon().

export const CLASS_ICONS = ['scale','gavel','landmark','calculator','sigma','pi','chart-line','flask-conical','atom','dna',
  'microscope','stethoscope','heart-pulse','brain','code','cpu','palette','music','drafting-compass','pencil-ruler',
  'globe','earth','languages','book-open','library','book-marked','briefcase-business','building-2','leaf','utensils',
  'hammer','lightbulb','graduation-cap'] as const;
export type ClassIconName = typeof CLASS_ICONS[number];

export const isClassIconName = (s: unknown): s is ClassIconName => typeof s === 'string' && (CLASS_ICONS as readonly string[]).includes(s);
/** Unknown icon names render as `book-open` (folder spec §2 IconName). */
export const iconOrDefault = (s: unknown): ClassIconName => (isClassIconName(s) ? s : 'book-open');

// ── Class identity suggestions (UX §1.3) ──
export const CLASS_COLOURS = ['#e5484d', '#f76b15', '#f5a524', '#8db600', '#30a46c', '#12a594', '#0090c8', '#3e63dd', '#6e56cf', '#ab4aba', '#d6409f', '#8d8d86'] as const;

const SUGGEST: Array<[RegExp, ClassIconName]> = [
  [/\b(direito|derecho|law|juridic|constitucional|civil|penal)/, 'scale'],
  [/\b(processo|procesal|tribunal|court)/, 'gavel'],
  [/\b(historia|history|politic|ciencia politica)/, 'landmark'],
  [/\b(estatistic|estadistic|statistic|probabilid)/, 'sigma'],
  [/\b(matematic|calculo|calculus|algebra|math)/, 'calculator'],
  [/\b(economi|financ|gestao|gestion|management|contabil)/, 'chart-line'],
  [/\b(quimic|chemistr)/, 'flask-conical'],
  [/\b(fisic|physic)/, 'atom'],
  [/\b(biolog|genetic|biochem|bioquim)/, 'dna'],
  [/\b(anatom|histolog|microbio|patolog)/, 'microscope'],
  [/\b(medicin|enfermag|enfermer|nursing|saude|salud|health)/, 'stethoscope'],
  [/\b(psicolog|psycholog|neuro)/, 'brain'],
  [/\b(program|informatic|computa|software|algoritm)/, 'code'],
  [/\b(arquitet|arquitect|architect|desenho|dibujo|drawing)/, 'drafting-compass'],
  [/\b(arte|art|design)/, 'palette'],
  [/\b(music)/, 'music'],
  [/\b(geograf|geograph)/, 'earth'],
  [/\b(ingles|english|frances|french|aleman|german|lingua|lengua|language|linguist)/, 'languages'],
  [/\b(literat|filosof|philosoph)/, 'book-marked'],
  [/\b(engenhar|ingenier|engineer)/, 'hammer'],
  [/\b(ambiente|ambient|ecolog|environment)/, 'leaf'],
];
const foldName = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** UX §1.3 suggestIcon (also exported by ui/classIcons.ts). */
export function suggestIconFor(name: string): ClassIconName {
  const f = foldName(name);
  return SUGGEST.find(([re]) => re.test(f))?.[1] ?? 'book-open';
}

/** UX §1.3 suggestColour: the first palette colour no active class uses; else index (count % 12). */
export function suggestColourFor(used: readonly string[]): string {
  return CLASS_COLOURS.find((c) => !used.includes(c)) ?? CLASS_COLOURS[used.length % 12]!;
}

/** Short name: initials of the significant words plus a trailing roman numeral ("Direito Constitucional I" → "DC I"). */
export function suggestShortName(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const roman = words.length > 1 && /^[IVX]+$/.test(words[words.length - 1]!) ? words.pop()! : '';
  const initials = words.filter((w) => w.length > 3 || /^[A-ZÁÉÍÓÚ]/.test(w)).map((w) => w[0]!.toUpperCase()).join('').slice(0, 6);
  return (initials + (roman ? ` ${roman}` : '')).slice(0, 12) || name.slice(0, 12);
}

