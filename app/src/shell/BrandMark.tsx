// This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of
// the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
// Adapted from Trama (app/src/features/onboarding/Frame.tsx), MPL-2.0.
//
// The brand mark (UX §1.8): a weave on an --accent ground, the bottom weft thread in #f5c518.
// 28 px in the rail, 36 px on the welcome screen.
import React from 'react';

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden className="brand-mark">
      <rect x="0.5" y="0.5" width="27" height="27" rx="8" className="brand-mark__ground" />
      {/* Two warp threads and three weft threads, each passing over and under in turn: the gaps in a
          thread are where the other one crosses over it. */}
      <path d="M10 5v.6M10 10.4v7.2M10 22.4v.6M18 5v6.6M18 16.4V23" className="brand-mark__warp" />
      <path d="M5 8h10.6M20.4 8H23M5 14h2.6M12.4 14H23" className="brand-mark__weft" />
      <path d="M5 20h10.6M20.4 20H23" className="brand-mark__weft brand-mark__weft--gold" />
    </svg>
  );
}

/** The mark and the wordmark "Tramado" (display face, 700, −0.02em, never translated). */
export function Brand({ size = 28, version }: { size?: number; version?: string }) {
  return (
    <span className="brand">
      <BrandMark size={size} />
      <span className="wordmark" translate="no">
        Tramado
      </span>
      {version ? <span className="brand__version t-small t-muted" data-testid="version">{version}</span> : null}
    </span>
  );
}
