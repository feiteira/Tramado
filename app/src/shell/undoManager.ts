// A small undo/redo stack (Trama's UndoManager, without its database plumbing). Screens record what a
// service action returns: { label, detail, undo, redo }. UX §2.6: Undo/Redo apply on Notes, the exam
// Review screen and deletes with Undo.

export interface Undoable {
  /** What the step did, already in the reader's language ("Deleted “Aula 6.pdf”"). */
  label: string;
  detail: string;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export interface UndoState {
  canUndo: boolean;
  canRedo: boolean;
  undo: { label: string; detail: string } | null;
  redo: { label: string; detail: string } | null;
}

/** A step refused because what it would write back changed since (a classmate's newer edit). */
export class UndoRefusedError extends Error {
  constructor(message = 'changed since') {
    super(message);
    this.name = 'UndoRefusedError';
  }
}

export class UndoManager {
  private done: Undoable[] = [];
  private undone: Undoable[] = [];
  private readonly listeners = new Set<() => void>();
  private busy = false;

  constructor(private readonly max = 100) {}

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  private changed() {
    for (const l of [...this.listeners]) l();
  }

  get labels(): UndoState {
    const top = (s: Undoable[]) => (s.length ? { label: s[s.length - 1]!.label, detail: s[s.length - 1]!.detail } : null);
    return { canUndo: this.done.length > 0, canRedo: this.undone.length > 0, undo: top(this.done), redo: top(this.undone) };
  }

  record(entry: Undoable): void {
    this.done = [...this.done.slice(-(this.max - 1)), entry];
    this.undone = [];
    this.changed();
  }

  clear(): void {
    this.done = [];
    this.undone = [];
    this.changed();
  }

  /** Undoes the last step; null when there is none. A refused step leaves the stack. */
  async undo(): Promise<Undoable | null> {
    if (this.busy) return null;
    const entry = this.done[this.done.length - 1];
    if (!entry) return null;
    this.busy = true;
    try {
      this.done = this.done.slice(0, -1);
      await entry.undo();
      this.undone = [...this.undone, entry];
      return entry;
    } finally {
      this.busy = false;
      this.changed();
    }
  }

  async redo(): Promise<Undoable | null> {
    if (this.busy) return null;
    const entry = this.undone[this.undone.length - 1];
    if (!entry) return null;
    this.busy = true;
    try {
      this.undone = this.undone.slice(0, -1);
      await entry.redo();
      this.done = [...this.done, entry];
      return entry;
    } finally {
      this.busy = false;
      this.changed();
    }
  }
}
