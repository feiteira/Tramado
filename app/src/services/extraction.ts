// STUB (M0) → T-DOCS owns this file from wave 1: text extraction into cache/text/<sha256>.json through ctx.extractHost.
// Empty stores and NOT_IMPLEMENTED actions until then (architecture §11.2, plan §2.2).
import { notImplemented } from '../core/errors';
import { constant } from './store';
import type { AppContext } from './context';
import type { AppServices } from './types/common';
import type { ExtractionService } from './types/documents';

export function createExtractionService(ctx: AppContext, app: () => AppServices): ExtractionService {
  void ctx; void app;
  return {
    status: constant({ running: 0, queued: 0, bySha: {} }),
    ensure: () => Promise.reject(notImplemented('ExtractionService.ensure')),
    cancel: () => undefined,
  };
}
