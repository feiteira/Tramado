import { describe, expect, it } from 'vitest';
import { currentHelpTopic, declareHelpTopic, ROUTE_TOPICS, routeTopic } from './helpTopic';

describe('help topics for F1 and the header’s "?"', () => {
  it('uses the route’s topic', () => {
    expect(routeTopic('lecture')).toBe(ROUTE_TOPICS.lecture);
    expect(currentHelpTopic('settings')).toBe(ROUTE_TOPICS.settings);
  });

  it('prefers the topic the showing screen declared, until it withdraws it', () => {
    const withdraw = declareHelpTopic('lectures#recording');
    expect(currentHelpTopic('lecture')).toBe('lectures#recording');
    withdraw();
    expect(currentHelpTopic('lecture')).toBe(ROUTE_TOPICS.lecture);
  });

  it('keeps a newer declaration when an older one is withdrawn late', () => {
    const a = declareHelpTopic('a');
    const b = declareHelpTopic('b');
    a();
    expect(currentHelpTopic('today')).toBe('b');
    b();
  });
});
