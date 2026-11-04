// What the sync pill needs beyond SyncUiState and the class views (UX §2.4): the distinct classmates online across
// every shared class (me excluded; one person online in two classes counts once) and the unresolved conflict
// copies. Followed live from each shared class's ClassService detail and ClassStore.
import { useEffect, useState } from 'react';
import type { AppServices } from '../services/types/common';
import type { ClassView } from '../services/types/viewModels';

export interface SyncFacts {
  /** Distinct members (not me) with at least one connected device, over the shared, non-archived classes. */
  online: number;
  /** Their names, for the pill's tooltip. */
  onlineNames: string[];
  /** Conflict copies waiting for a decision, per class. */
  conflicts: Record<string, number>;
}

const EMPTY: SyncFacts = { online: 0, onlineNames: [], conflicts: {} };

/** Pure: the facts from each class's people and conflict list. */
export function factsOf(perClass: ReadonlyArray<{ classId: string; people: ReadonlyArray<{ memberId: string; name: string; isMe: boolean; devices: ReadonlyArray<{ online: boolean }> }>; conflicts: number }>): SyncFacts {
  const online = new Map<string, string>();
  const conflicts: Record<string, number> = {};
  for (const c of perClass) {
    for (const p of c.people) if (!p.isMe && p.devices.some((d) => d.online)) online.set(p.memberId, p.name);
    if (c.conflicts > 0) conflicts[c.classId] = c.conflicts;
  }
  return { online: online.size, onlineNames: [...online.values()].sort((a, b) => a.localeCompare(b)), conflicts };
}

export function useSyncFacts(services: AppServices, classes: readonly ClassView[]): SyncFacts {
  const [facts, setFacts] = useState<SyncFacts>(EMPTY);
  const ids = classes.filter((c) => c.shared && !c.archived && c.sync.kind !== 'missingFolder').map((c) => c.id);
  const key = ids.join(',');
  useEffect(() => {
    const per = ids.flatMap((id) => {
      try {
        const s = services.forClass(id);
        return [{ id, info: s.info, store: s.store }];
      } catch {
        return [];
      }
    });
    const read = () =>
      setFacts((prev) => {
        const next = factsOf(per.map((p) => ({ classId: p.id, people: p.info.detail.get().people, conflicts: p.store.state.get().index.conflicts.length })));
        return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
      });
    read();
    const offs = per.flatMap((p) => [p.info.detail.subscribe(read), p.store.state.subscribe(read)]);
    return () => offs.forEach((o) => o());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, key]);
  return facts;
}
