// QrCode (UX §2.11): qrcode@1.5.4 toString(value, {type:'svg', errorCorrectionLevel:'M', margin:4}) as an <img>.
import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

export interface QrCodeProps {
  value: string;
  size?: number;
  label: string;
  className?: string;
  'data-testid'?: string;
}

export function QrCode({ value, size = 340, label, className, ...rest }: QrCodeProps) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toString(value, { type: 'svg', errorCorrectionLevel: 'M', margin: 4 })
      .then((svg) => live && setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [value]);
  return src ? (
    <img className={['qr-code', className].filter(Boolean).join(' ')} src={src} width={size} height={size} alt={label} data-testid={rest['data-testid'] ?? 'qr-code'} />
  ) : (
    <span className="qr-code qr-code--pending" style={{ width: size, height: size }} role="img" aria-label={label} data-testid={rest['data-testid'] ?? 'qr-code'} />
  );
}
