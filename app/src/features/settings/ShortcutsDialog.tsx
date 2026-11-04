// The keyboard shortcuts overlay (UX §2.10): every global key, then the keys of the current screen (lecture,
// document, exam and practice, chat and Ask), and the recording keys while recording. F1 or ? opens it; Esc closes.
import React from 'react';
import type { AppServices } from '../../services/types/common';
import type { DialogPropsMap } from '../registry';
import { useRouter } from '../../shell/router';
import { useKeyLabel } from '../../shell/keys';
import { useStore } from '../../shell/useStore';
import type { Route } from '../../shell/routes';
import { Button } from '../../ui/components/Button';
import { Dialog } from '../../ui/components/Dialog';
import { useI18n, type MessageKey } from '../../ui/i18n';
import './settings.css';
import './shortcuts.css';

type Group = 'everywhere' | 'recording' | 'lecture' | 'document' | 'exam' | 'chat' | 'lists';
interface Item { keys: string[]; what: MessageKey }

type KeyLabel = (key: string, opts?: { shift?: boolean; alt?: boolean }) => string;

/** The groups shown for a route (pure: the shortcuts the UX lists for each screen). */
export function shortcutGroups(route: Route, recording: boolean, key: KeyLabel, space = 'Space'): Array<{ group: Group; items: Item[] }> {
  const out: Array<{ group: Group; items: Item[] }> = [
    {
      group: 'everywhere',
      items: [
        { keys: [key('K')], what: 'app.shortcuts.palette' },
        { keys: [key('R', { shift: true })], what: 'app.shortcuts.record' },
        { keys: [key(',')], what: 'app.shortcuts.settings' },
        { keys: [key('H', { shift: true })], what: 'app.shortcuts.today' },
        { keys: [key('1…9')], what: 'app.shortcuts.classN' },
        { keys: [key('J', { shift: true })], what: 'app.shortcuts.join' },
        { keys: ['Alt+←'], what: 'app.shortcuts.back' },
        { keys: ['Esc'], what: 'app.shortcuts.closeLayer' },
        { keys: [key('Z')], what: 'app.shortcuts.undo' },
        { keys: [key('Z', { shift: true }), 'Ctrl+Y'], what: 'app.shortcuts.redo' },
        { keys: ['F1', '?'], what: 'app.shortcuts.help' },
      ],
    },
  ];
  const lectureKeys: Item[] = [
    { keys: [space], what: 'app.shortcuts.playPause' },
    { keys: ['←', '→'], what: 'app.shortcuts.skip5' },
    { keys: ['Shift+←', 'Shift+→'], what: 'app.shortcuts.skip30' },
    { keys: ['[', ']'], what: 'app.shortcuts.speed' },
    { keys: ['F'], what: 'app.shortcuts.follow' },
    { keys: ['E'], what: 'app.shortcuts.editTranscript' },
    { keys: [key('F')], what: 'app.shortcuts.find' },
    { keys: ['1', '2', '3', '4'], what: 'app.shortcuts.markers' },
    { keys: ['N'], what: 'app.shortcuts.note' },
  ];
  if (recording) {
    out.push({
      group: 'recording',
      items: [
        { keys: ['1', '2', '3', '4'], what: 'app.shortcuts.markers' },
        { keys: ['N'], what: 'app.shortcuts.note' },
        { keys: [key('1…4', { alt: true })], what: 'app.shortcuts.globalMarkers' },
      ],
    });
  }
  switch (route.name) {
    case 'lecture':
      out.push({ group: 'lecture', items: recording ? lectureKeys.filter((i) => i.what !== 'app.shortcuts.markers' && i.what !== 'app.shortcuts.note') : lectureKeys });
      break;
    case 'document':
      out.push({
        group: 'document',
        items: [
          { keys: [key('G')], what: 'app.shortcuts.goToPage' },
          { keys: [key('−'), key('=')], what: 'app.shortcuts.zoom' },
          { keys: [key('0')], what: 'app.shortcuts.fitWidth' },
          { keys: [key('F')], what: 'app.shortcuts.find' },
        ],
      });
      break;
    case 'exam':
    case 'practice':
      out.push({
        group: 'exam',
        items: [
          { keys: [space], what: 'app.shortcuts.reveal' },
          { keys: ['1'], what: 'app.shortcuts.again' },
          { keys: ['2'], what: 'app.shortcuts.gotIt' },
          { keys: ['Alt+↑', 'Alt+↓'], what: 'app.shortcuts.nextQuestion' },
          { keys: [key('Enter')], what: 'app.shortcuts.submit' },
        ],
      });
      break;
    case 'ask':
      out.push({ group: 'chat', items: [{ keys: [key('Enter')], what: 'app.shortcuts.submit' }, { keys: ['Shift+Enter'], what: 'app.shortcuts.newline' }] });
      break;
    case 'class': {
      const tab = route.tab ?? 'lectures';
      if (tab === 'chat' || tab === 'ask') {
        out.push({ group: 'chat', items: [{ keys: ['Enter', key('Enter')], what: 'app.shortcuts.submit' }, { keys: ['Shift+Enter'], what: 'app.shortcuts.newline' }, { keys: [key('F')], what: 'app.shortcuts.find' }] });
      } else if (tab !== 'share' && tab !== 'members') {
        out.push({ group: 'lists', items: [{ keys: ['↑', '↓'], what: 'app.shortcuts.moveRows' }, { keys: ['Enter'], what: 'app.shortcuts.openRow' }, { keys: [key('F')], what: 'app.shortcuts.find' }] });
      }
      break;
    }
    default:
      break;
  }
  return out;
}

export default function ShortcutsDialog({ props, services, close }: { props: DialogPropsMap['shortcuts']; services: AppServices; close(): void }) {
  void props;
  const { t } = useI18n();
  const { route } = useRouter();
  const key = useKeyLabel();
  const recording = useStore(services.recording.state);
  const groups = shortcutGroups(route, !!recording, key, t('app.shortcuts.keySpace'));
  return (
    <Dialog
      open
      onClose={close}
      title={t('app.shortcuts.title')}
      description={t('app.shortcuts.notInText')}
      size="md"
      data-testid="shortcuts-dialog"
      footer={
        <Button variant="primary" onClick={close} data-testid="shortcuts-close">
          {t('common.close')}
        </Button>
      }
    >
      <div className="shortcuts">
        {groups.map((g) => (
          <section key={g.group} className="shortcuts__group" aria-labelledby={`shortcuts-${g.group}`} data-testid="shortcuts-group" data-group={g.group}>
            <h3 className="shortcuts__title" id={`shortcuts-${g.group}`}>{t(`app.shortcuts.groups.${g.group}`)}</h3>
            <dl className="shortcuts__list">
              {g.items.map((it) => (
                <div key={`${it.what}-${it.keys.join()}`} className="shortcuts__row">
                  <dt className="shortcuts__what">{t(it.what)}</dt>
                  <dd className="shortcuts__keys">
                    {it.keys.map((k, i) => (
                      <React.Fragment key={k}>
                        {i > 0 ? <span className="shortcuts__or" aria-hidden>/</span> : null}
                        <kbd className="kbd">{k}</kbd>
                      </React.Fragment>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
