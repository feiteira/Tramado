// Bindings of architecture §6.3 (commands/dialogs.rs): dialogs run in Rust and return pick tokens (D-4).
import type { Picked, Platform } from '../types';
import { call } from './index';

export function createDialogBindings(): Platform['dialogs'] {
  // Empty filter lists are dropped by Rust too (Trama gotcha); send what the caller gave.
  return {
    pickFiles: (req) => call<Picked[]>('dialog_pick_files', { req }),
    pickFolder: (req) => call<Picked | null>('dialog_pick_folder', { req }),
    save: (req) => call<Picked | null>('dialog_save', { req }),
    saveText: (req, text) => call<boolean>('dialog_save_text', { req, text }),
  };
}
