// Settings › Storage (UX §3.14.7): where new classes go (with the cloud-folder warning), each class's size with its
// recordings and the deleted files Syncthing keeps 30 days ([Empty class trash], Skip audio), classes still being
// left, the speech models, the cache ([Clear cache]) and the retention of my recordings once transcribed.
import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import type { ClassEntry, StorageUsage } from '../../platform/types';
import type { AppServices } from '../../services/types/common';
import { useAppState } from '../../shell/AppState';
import { useRouter } from '../../shell/router';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { RadioGroup, Switch } from '../../ui/components/Choice';
import { useConfirm } from '../../ui/components/Confirm';
import { Notice } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { ClassTab } from '../../ui/tramado/ClassTab';
import { formatBytes } from '../../ui/format';
import { useI18n } from '../../ui/i18n';
import { cloudServiceOf } from '../onboarding/cloud';
import { Group, Row, SectionRoot } from './Group';

export default function StorageSection({ services }: { services: AppServices }) {
  const i18n = useI18n();
  const { t } = i18n;
  const app = useAppState();
  const { go } = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { platform } = services.ctx;
  const classes = useStore(services.library.classes);
  const prefs = useStore(services.ctx.prefs.store);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<ClassEntry[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const size = (n: number) => formatBytes(t, i18n.meta.bcp47, n);

  const load = useCallback(async () => {
    const [u, r, list] = await Promise.all([
      platform.storage.usage().catch(() => null),
      platform.classes.root().catch(() => null),
      platform.classes.list().catch(() => [] as ClassEntry[]),
    ]);
    setUsage(u);
    setRoot(r?.path ?? null);
    setLeaving(list.filter((e) => e.leaving));
  }, [platform]);
  useEffect(() => {
    void load();
  }, [load, classes]);

  const run = async (id: string, f: () => Promise<unknown>, done?: string) => {
    setBusy(id);
    try {
      await f();
      if (done) toast.show({ message: done, tone: 'success' });
      await load();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const chooseRoot = () =>
    void run('root', async () => {
      const pick = await platform.dialogs.pickFolder({ title: t('settings.storage.root') });
      if (pick) await platform.classes.setRoot(pick.token);
    });
  const emptyTrash = async (classId: string, name: string, bytes: number) => {
    const ok = await confirm({
      title: t('settings.storage.emptyTrashConfirm.title', { size: size(bytes), class: name }),
      body: t('settings.storage.emptyTrashConfirm.body'),
      confirmLabel: t('settings.storage.emptyTrashConfirm.confirm'),
      danger: true,
    });
    if (ok) await run(`trash:${classId}`, () => platform.classes.emptyTrash(classId), t('settings.storage.trashEmptied'));
  };
  const cloud = root ? cloudServiceOf(root) : null;
  const retention = prefs['privacy.deleteAudioAfterDays'] ?? '0';
  const usageOf = (id: string) => usage?.classes.find((c) => c.classId === id) ?? null;

  return (
    <SectionRoot testid="settings-storage" title={t('settings.sections.storage')}>
      <Group id="root">
        <Row label={t('settings.storage.root')} hint={t('settings.storage.rootHint')} stack testid="storage-root">
          <div className="set-path">
            <code className="set-path__value" data-testid="storage-root-path">{root ?? '…'}</code>
            <Button size="sm" icon={FolderOpen} busy={busy === 'root'} onClick={chooseRoot} data-testid="storage-root-change">
              {t('onboarding.name.folderChange')}
            </Button>
          </div>
          {cloud ? (
            <Notice tone="warning" data-testid="storage-cloud-warning">
              {t('onboarding.name.cloudWarning', { service: cloud })}
            </Notice>
          ) : null}
        </Row>
      </Group>
      <Group id="classes" title={t('settings.storage.classes')}>
        {classes.map((c) => {
          const u = usageOf(c.id);
          return (
            <Row
              key={c.id}
              testid="storage-class"
              className="set-row--class"
              label={
                <span className="set-class">
                  <ClassTab color={c.color} icon={c.icon} size="sm" />
                  <span className="set-class__name">{c.name}</span>
                </span>
              }
              hint={u ? t('settings.storage.classSize', { size: size(u.total), audio: size(u.audio), trash: size(u.trash) }) : undefined}
            >
              <div className="set-inline">
                <Button
                  size="sm"
                  icon={Trash2}
                  disabled={!u || u.trash === 0}
                  busy={busy === `trash:${c.id}`}
                  onClick={() => u && void emptyTrash(c.id, c.name, u.trash)}
                  data-class-id={c.id}
                  data-testid="storage-empty-trash"
                >
                  {t('settings.storage.emptyTrash')}
                </Button>
                <Switch
                  label={t('settings.storage.skipAudio')}
                  checked={c.skipAudio}
                  onChange={(v) => void run(`skip:${c.id}`, async () => {
                    await platform.classes.update(c.id, { skipAudio: v });
                    await services.library.load();
                  })}
                  data-testid="storage-skip-audio"
                />
              </div>
            </Row>
          );
        })}
        {leaving.map((e) => (
          <Row key={e.classId} testid="storage-leaving" label={<span className="set-class"><span className="set-class__name">{e.dirName}</span></span>} hint={t('settings.storage.leaving')} />
        ))}
      </Group>
      <Group id="other">
        <Row label={t('settings.storage.models')} hint={usage ? size(usage.models) : undefined} testid="storage-models">
          <Button size="sm" onClick={() => go({ name: 'settings', section: 'transcription' })} data-testid="storage-models-manage">
            {t('settings.storage.manage')}
          </Button>
        </Row>
        <Row label={t('settings.storage.cache')} hint={`${usage ? size(usage.cache) : '…'} · ${t('settings.storage.cacheHint')}`} testid="storage-cache">
          <Button size="sm" busy={busy === 'cache'} onClick={() => void run('cache', () => platform.cache.clear(), t('settings.storage.cacheCleared'))} data-testid="storage-cache-clear">
            {t('settings.storage.clearCache')}
          </Button>
        </Row>
        <Row label={t('settings.storage.retention')} hint={t('settings.storage.retentionHint')} stack>
          <RadioGroup
            label={t('settings.storage.retention')}
            hideLabel
            value={retention as '0' | '30' | '90'}
            onChange={(v: '0' | '30' | '90') => void app.setPref('privacy.deleteAudioAfterDays', v)}
            options={[
              { value: '0', label: t('settings.storage.retentionNever') },
              { value: '30', label: t('settings.storage.retention30') },
              { value: '90', label: t('settings.storage.retention90') },
            ]}
            data-testid="storage-audio-retention"
          />
        </Row>
      </Group>
    </SectionRoot>
  );
}
