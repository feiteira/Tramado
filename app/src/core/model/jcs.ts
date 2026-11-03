// RFC 8785 JSON Canonicalization Scheme: what device signatures sign (folder spec §6.6).
// Keys sorted by UTF-16 code units, no whitespace, numbers and strings serialised exactly as
// ECMAScript's JSON.stringify does (which RFC 8785 adopts by reference).

export function jcs(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('JCS: non-finite number');
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : jcs(v))).join(',')}]`;
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function')
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      return `{${keys.map((k) => `${JSON.stringify(k)}:${jcs(obj[k])}`).join(',')}}`;
    }
    default:
      throw new Error(`JCS: cannot serialise ${typeof value}`);
  }
}

/** The record without its `sig` field, canonicalised: the payload of a device signature. */
export function jcsWithoutSig(record: Record<string, unknown>): string {
  const { sig: _sig, ...rest } = record;
  return jcs(rest);
}
