// PLACEHOLDER (M0) → UI-GROUP (tramado://join links and .tramado-invite files). Renders nothing until then.
import type { AppServices } from '../../services/types/common';

export default function Placeholder({ services }: { services: AppServices }) {
  void services;
  return null;
}
