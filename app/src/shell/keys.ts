import { useCallback, useEffect, useState } from 'react';
import { usePlatform } from './AppState';

/** How a Ctrl shortcut is written on this computer: "Ctrl+K", or "⌘K" on a Mac. */
export function useKeyLabel(): (key: string, opts?: { shift?: boolean; alt?: boolean }) => string {
  const platform = usePlatform();
  const [mac, setMac] = useState(false);
  useEffect(() => {
    let live = true;
    platform
      .info()
      .then((i: { os: string }) => live && setMac(i.os === 'macos'))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [platform]);
  return useCallback(
    (key: string, opts: { shift?: boolean; alt?: boolean } = {}) =>
      mac ? `${opts.alt ? '⌥' : ''}${opts.shift ? '⇧' : ''}⌘${key}` : `Ctrl+${opts.alt ? 'Alt+' : ''}${opts.shift ? 'Shift+' : ''}${key}`,
    [mac],
  );
}
