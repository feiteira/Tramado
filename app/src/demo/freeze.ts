// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// `freeze()` copied verbatim from Trama (app/src/demo/boot.ts), MPL-2.0 (architecture §11.6, §19.1).
import { DateTime, Settings } from 'luxon';

/** Freezes time and seeds crypto.getRandomValues. Demo only: the real app never does this. */
export function freeze(clock: string): void {
  let seed = 0x7a3a;
  globalThis.crypto.getRandomValues = (<T extends ArrayBufferView | null>(arr: T): T => {
    if (arr) {
      const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
      for (let i = 0; i < bytes.length; i++) {
        // Math.imul keeps the product exact (a plain * loses bits above 2^53 and falls into a
        // cycle of a few hundred values).
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        bytes[i] = seed >>> 24;
      }
    }
    return arr;
  }) as Crypto['getRandomValues'];
  // Math.random too: the recovery-phrase check picks its words with it.
  let mseed = 0x1234;
  Math.random = () => {
    mseed = (Math.imul(mseed, 1664525) + 1013904223) >>> 0;
    return mseed / 2 ** 32;
  };
  const fixed = DateTime.fromISO(clock, { zone: 'Europe/Lisbon' }).toMillis();
  if (!Number.isFinite(fixed)) return;
  Settings.now = () => fixed;
  Settings.defaultZone = 'Europe/Lisbon';
  const RealDate = Date;
  // Freeze Date too, so every "now" in the app agrees.
  globalThis.Date = class extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(fixed);
      else super(...(args as [number]));
    }
    static override now() {
      return fixed;
    }
  } as DateConstructor;
}
