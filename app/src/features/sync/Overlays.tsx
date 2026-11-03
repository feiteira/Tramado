// PLACEHOLDER (M0) → UI-GROUP (UX §3.15 sync error card, copied identity, remote mass deletion). Renders nothing until then.
import type { AppServices } from '../../services/types/common';

export default function Placeholder({ services }: { services: AppServices }) {
  void services;
  return null;
}
