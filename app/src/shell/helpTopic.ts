import type { RouteName } from './router';

// Which part of the manual (docs/manual, wave 3) a screen is about: the topic the screen on show
// declared in its ScreenHeader, else the one for its route. Module state: one screen shows at a time.
// In 0.1, F1 and "?" open the keyboard-shortcuts overlay (UX §2.6, §2.10); the topic travels with it.

export const ROUTE_TOPICS: Record<RouteName, string> = {
  today: 'today',
  class: 'classes',
  lecture: 'lectures',
  document: 'documents',
  note: 'notes',
  exam: 'exams',
  practice: 'exams#practice',
  ask: 'ai',
  settings: 'settings',
};

let declared: { topic: string } | null = null;

/** The manual topic for a route. */
export function routeTopic(name: RouteName): string | null {
  return ROUTE_TOPICS[name] ?? null;
}

/** Declares the topic of the screen being shown; returns the function that withdraws it. */
export function declareHelpTopic(topic: string): () => void {
  const mine = { topic };
  declared = mine;
  return () => {
    if (declared === mine) declared = null;
  };
}

/** The topic F1 opens on `route`. */
export function currentHelpTopic(route: RouteName): string | null {
  return declared?.topic ?? routeTopic(route);
}
