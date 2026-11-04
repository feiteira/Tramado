// QrCode (UX §2.11): qrcode@1.5.4 toString(value, {type:'svg', errorCorrectionLevel:'M', margin:4}) as an <img>.
// `modulePx` sizes the code from its own version instead of a fixed `size`: (modules + 2 × 4 quiet) × modulePx, so a long
// invite (version 16–22) stays at ≥ 4 px per module, the size a phone camera reads reliably (UX §3.12.2).
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import './group.css';

export interface QrCodeProps {
  value: string;
  size?: number;
  /** Pixels per module; when set, the size follows the code's version (the quiet zone included). */
  modulePx?: number;
  label: string;
  className?: string;
  'data-testid'?: string;
}

const MARGIN = 4;

/** The side in pixels of `value`'s QR code at `modulePx` pixels per module, or null when it cannot be encoded. */
export function qrSide(value: string, modulePx: number): number | null {
  try {
    return (QRCode.create(value, { errorCorrectionLevel: 'M' }).modules.size + 2 * MARGIN) * modulePx;
  } catch {
    return null;
  }
}

export function QrCode({ value, size: fixed = 340, modulePx, label, className, ...rest }: QrCodeProps) {
  const [src, setSrc] = useState<string | null>(null);
  const size = (modulePx ? qrSide(value, modulePx) : null) ?? fixed;
  useEffect(() => {
    let live = true;
    QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: MARGIN })
      .then((svg) => live && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [value]);
  return src ? (
    <img className={['qr-code', className].filter(Boolean).join(' ')} src={src} width={size} height={size} style={{ width: size, height: size }} alt={label} data-testid={rest['data-testid'] ?? 'qr-code'} />
  ) : (
    <span className="qr-code qr-code--pending" style={{ width: size, height: size }} role="img" aria-label={label} data-testid={rest['data-testid'] ?? 'qr-code'} />
  );
}
