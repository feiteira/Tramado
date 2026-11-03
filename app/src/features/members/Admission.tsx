// PLACEHOLDER (M0) → UI-GROUP (UX §3.12.4 admission notices). Renders nothing until then.
import type { AppServices } from '../../services/types/common';

export default function Placeholder({ services }: { services: AppServices }) {
  void services;
  return null;
}
