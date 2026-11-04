// Settings › Notifications (UX §3.14.6): system notifications on or off, the default level for new classes, which
// events notify, and each class's own level (also in the class's ⋯ › Notifications).
import React from 'react';
import type { AppServices } from '../../services/types/common';
import { useAppState } from '../../shell/AppState';
import { useStore } from '../../shell/useStore';
import { Checkbox, RadioGroup, Switch } from '../../ui/components/Choice';
import { Select } from '../../ui/components/Field';
import { ClassTab } from '../../ui/tramado/ClassTab';
import { useI18n } from '../../ui/i18n';
import { Group, Row, SectionRoot } from './Group';

type Level = 'important' | 'all' | 'none';
const KINDS = [
  ['transcript', 'notify.transcripts'],
  ['joins', 'notify.joins'],
  ['exams', 'notify.exams'],
  ['model', 'notify.model'],
] as const;

export default function NotificationsSection({ services }: { services: AppServices }) {
  const { t } = useI18n();
  const app = useAppState();
  const prefs = useStore(services.ctx.prefs.store);
  const classes = useStore(services.library.classes).filter((c) => !c.archived);
  const get = (k: string, dflt: string) => prefs[k] ?? dflt;
  const system = get('notify.system', '1') === '1';
  const levels = (['important', 'all', 'none'] as const).map((v) => ({ value: v, label: t(`classes.header.notify.${v}`) }));
  return (
    <SectionRoot testid="settings-notifications" title={t('settings.sections.notifications')}>
      <Group id="system">
        <Row>
          <Switch label={t('settings.notifications.system')} checked={system} onChange={(v) => void app.setPref('notify.system', v ? '1' : '0')} data-testid="notify-system" />
        </Row>
        <Row label={t('settings.notifications.default')} stack>
          <RadioGroup
            label={t('settings.notifications.default')}
            hideLabel
            value={get('notify.default', 'important') as Level}
            onChange={(v: Level) => void app.setPref('notify.default', v)}
            options={levels}
            data-testid="notify-default"
          />
        </Row>
        <Row label={t('settings.notifications.kinds')} stack>
          <div className="set-checks" data-testid="notify-kinds" role="group" aria-label={t('settings.notifications.kinds')}>
            {KINDS.map(([id, key]) => (
              <Checkbox
                key={id}
                label={t(`settings.notifications.${id === 'transcript' ? 'transcript' : id}`)}
                checked={get(key, '1') === '1'}
                disabled={!system}
                onChange={(v) => void app.setPref(key, v ? '1' : '0')}
                data-testid={`notify-kind-${id}`}
              />
            ))}
          </div>
        </Row>
      </Group>
      {classes.length ? (
        <Group id="classes" title={t('settings.notifications.classes')} description={t('settings.notifications.perClass')}>
          {classes.map((c) => (
            <Row
              key={c.id}
              label={
                <span className="set-class">
                  <ClassTab color={c.color} icon={c.icon} size="sm" />
                  {c.name}
                </span>
              }
              labelId={`notify-class-${c.id}`}
              testid="notify-class"
            >
              <Select
                aria-labelledby={`notify-class-${c.id}`}
                value={c.notify}
                onChange={(v: Level) => void app.setPref(`notify.class.${c.id}`, v)}
                options={levels}
                size="sm"
                className="set-select"
                data-class-id={c.id}
                data-testid="notify-class-level"
              />
            </Row>
          ))}
        </Group>
      ) : null}
    </SectionRoot>
  );
}
