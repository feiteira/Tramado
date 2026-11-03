import type { LucideIcon } from 'lucide-react';
import { fold } from '../core/text/normalize';

// The command palette's registry (Ctrl/⌘+K). Features add what they can do while they are on
// screen (`useCommands` in shell/useCommands.ts); the shell adds navigation. Labels are
// already translated: a command registered from a component re-registers when the language
// changes.

export interface Command {
  /** Stable id; registering the same id again replaces the earlier command. */
  id: string;
  label: string;
  run: () => void | Promise<unknown>;
  /** Other words that find it (in the reader's language), e.g. "tags" for Codes. */
  keywords?: string[];
  /** A heading the palette groups by ("Go to", "Project"…). */
  group?: string;
  /** Shown at the right, e.g. "Ctrl+L". */
  shortcut?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  /**
   * Breaks ties between equally good matches (default 0, higher first): a screen's own
   * command can come before the shell's navigation that matches the same words.
   */
  priority?: number;
}

export interface ScoredCommand {
  command: Command;
  score: number;
}

/**
 * How well `query` finds `cmd`: every word of the query must appear in the label or keywords
 * (accents and case ignored). The label beats keywords, a start beats a word start beats a
 * substring. 0 means no match.
 */
export function scoreCommand(cmd: Command, query: string): number {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return 1;
  const label = fold(cmd.label);
  const keys = (cmd.keywords ?? []).map(fold);
  let total = 0;
  for (const w of words) {
    let best = 0;
    if (label.startsWith(w)) best = 100;
    else if (label.includes(` ${w}`)) best = 70;
    else if (label.includes(w)) best = 40;
    for (const k of keys) {
      if (k.startsWith(w)) best = Math.max(best, 30);
      else if (k.includes(w)) best = Math.max(best, 15);
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}

export class CommandRegistry {
  private items: Command[] = [];
  private listeners = new Set<() => void>();
  private version = 0;

  /** Adds commands; returns the function that removes these (not a later replacement). */
  register(cmd: Command | Command[]): () => void {
    const list = Array.isArray(cmd) ? cmd : [cmd];
    const ids = new Set(list.map((c) => c.id));
    this.items = [...this.items.filter((c) => !ids.has(c.id)), ...list];
    this.emit();
    return () => {
      const before = this.items.length;
      this.items = this.items.filter((c) => !list.includes(c));
      if (this.items.length !== before) this.emit();
    };
  }

  list(): readonly Command[] {
    return this.items;
  }

  /** Matching enabled commands, best first; then higher priority, then registration order. */
  search(query: string, limit = 50): Command[] {
    return this.items
      .map((command, i) => ({ command, i, score: command.disabled ? 0 : scoreCommand(command, query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || (b.command.priority ?? 0) - (a.command.priority ?? 0) || a.i - b.i)
      .slice(0, limit)
      .map((x) => x.command);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Changes on every register/unregister (for useSyncExternalStore). */
  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** The app's one registry. */
export const commands = new CommandRegistry();

export const registerCommand = (cmd: Command | Command[]): (() => void) => commands.register(cmd);
