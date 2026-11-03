// PLACEHOLDER (M0) → UI-LECTURES (recording now): a rail badge store; null = no badge.
import { constant } from '../../services/store';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';

export default function railBadge(services: AppServices, classId: ClassId) {
  void services; void classId;
  return constant<{ count: number; tone: 'neutral' | 'info' | 'danger' } | null>(null);
}
