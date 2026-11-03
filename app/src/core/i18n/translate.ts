export type Vars = Record<string, string | number>;

type NestedKey<T, Prefix extends string = ''> = T extends string
  ? Prefix
  : {
      [K in keyof T & string]: NestedKey<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>;
    }[keyof T & string];

export type MessageKeyOf<T> = NestedKey<T>;

/** Keys whose value is a { one, other } pair — the only plural shape the catalogs use. */
type PluralKey<T, Prefix extends string = ''> = T extends { one: string; other: string }
  ? Prefix
  : T extends string
    ? never
    : {
        [K in keyof T & string]: PluralKey<T[K], Prefix extends '' ? K : `${Prefix}.${K}`>;
      }[keyof T & string];

export type PluralKeyOf<T> = PluralKey<T>;

export function lookup(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as object)) return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => (vars[name] != null ? String(vars[name]) : `{${name}}`));
}

/** Resolves `key` in `messages`, then in the English fallback, then returns the key itself. */
export function translate<T>(messages: T, fallback: T, key: MessageKeyOf<T>, vars?: Vars): string {
  const raw = lookup(messages, key) ?? lookup(fallback, key);
  return interpolate(typeof raw === 'string' ? raw : key, vars);
}

export function translatePlural<T>(messages: T, fallback: T, key: PluralKeyOf<T>, n: number, bcp47: string, vars?: Vars): string {
  const form = new Intl.PluralRules(bcp47).select(n) === 'one' ? 'one' : 'other';
  const raw = lookup(messages, `${key}.${form}`) ?? lookup(fallback, `${key}.${form}`);
  return interpolate(typeof raw === 'string' ? raw : key, { n, ...vars });
}
