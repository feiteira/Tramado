import { useEffect, useRef, useSyncExternalStore } from 'react';
import { type Command, commands } from './commands';

/**
 * Registers commands while the calling component is mounted. `deps` decide when the list is
 * rebuilt (labels in a new language, a selection that changes what applies); `run` always
 * calls the latest closure.
 */
export function useCommands(build: () => Command[], deps: unknown[]): void {
  const latest = useRef(build);
  latest.current = build;
  useEffect(() => {
    const list = latest.current().map((c) => ({ ...c, run: () => (latest.current().find((x) => x.id === c.id)?.run ?? c.run)() }));
    return commands.register(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Re-renders when commands come or go. */
export function useCommandsVersion(): number {
  return useSyncExternalStore((fn) => commands.subscribe(fn), commands.getVersion, commands.getVersion);
}
