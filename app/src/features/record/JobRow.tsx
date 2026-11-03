// PLACEHOLDER (M0) → UI-LECTURES (UX §2.7 transcription / model download row). Renders nothing until then.
import type { AppServices } from '../../services/types/common';

export default function Placeholder({ services }: { services: AppServices }) {
  void services;
  return null;
}
