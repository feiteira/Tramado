// Size limits of folder spec §4.6 (and the field lengths readers validate).

export const LIMITS_V1 = {
  jsonlLineBytes: 65_536,
  chatTextChars: 8_000,
  annotationBodyChars: 8_000,
  smallJsonBytes: 64 * 1024,          // members/*, presence/*, meta/*, bans/*
  transcriptBytes: 32 * 1024 * 1024,  // transcript.json
  examBytes: 4 * 1024 * 1024,         // exam.json
  classPathUnits: 200,                // UTF-16 code units (§5.4)
  nameBytes: 120,                     // sanitize step 8: UTF-8 bytes of a created name
  extensionBytes: 16,
  className: 120, shortName: 12, lecturer: 80, term: 40, description: 2_000, vocabulary: 500,
  personName: 64, deviceName: 64, addresses: 8,
} as const;

/** The byte limit of a per-device JSON file, by format (§4.6), or null when unlimited. */
export function maxBytesOf(format: string): number | null {
  switch (format) {
    case 'tramado.member':
    case 'tramado.presence':
    case 'tramado.meta':
    case 'tramado.bans':
      return LIMITS_V1.smallJsonBytes;
    case 'tramado.transcript':
      return LIMITS_V1.transcriptBytes;
    case 'tramado.exam':
      return LIMITS_V1.examBytes;
    default:
      return null;
  }
}
