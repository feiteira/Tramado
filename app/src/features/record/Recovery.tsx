// PLACEHOLDER (M0) → UI-LECTURES (UX §3.6.5 start-up recovery overlay). Renders nothing until then.
import type { AppServices } from '../../services/types/common';

export default function Placeholder({ services }: { services: AppServices }) {
  void services;
  return null;
}
