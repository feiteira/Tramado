// Settings › Privacy (UX §3.14.8): "What leaves this computer" from core/privacy/flows.ts (the same list as
// PRIVACY.md), the AI activity log grouped per action (`platform.ai.activity(500)`, [Clear the log]), and where
// the data is (opens each folder).
import React, { useCallback, useEffect, useState } from 'react';
import { FolderOpen, Trash2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { FLOWS, flowText } from '../../core/privacy/flows';
import { groupActivity, type ActivityRow } from '../../core/privacy/activity';
import type { AppServices } from '../../services/types/common';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { useConfirm } from '../../ui/components/Confirm';
import { Badge, Spinner } from '../../ui/components/Feedback';
import { Table, TBody, TD, TH, THead, TR } from '../../ui/components/Table';
import { useToast } from '../../ui/components/Toast';
import { ClassChip } from '../../ui/tramado/ClassChip';
import { modelLabelOf } from '../../shell/pills';
import { useI18n } from '../../ui/i18n';
import { Group, SectionRoot } from './Group';

const ACTIONS = new Set(['ask', 'chat', 'explain', 'summary', 'terms', 'annotate', 'studyNotes', 'examExtract', 'examOcr', 'examAnswer', 'hint', 'deep', 'title', 'describe', 'docOcr', 'cloudSpeech', 'keyCheck', 'catalog']);

export default function PrivacySection({ services }: { services: AppServices }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const toast = useToast();
  const confirm = useConfirm();
  const classes = useStore(services.library.classes);
  const [rows, setRows] = useState<ActivityRow[] | null>(null);
  const load = useCallback(async () => {
    try {
      setRows(groupActivity(await services.ai.activity(500)));
    } catch {
      setRows([]);
    }
  }, [services]);
  useEffect(() => {
    void load();
  }, [load]);
  const clear = async () => {
    const ok = await confirm({ title: t('privacy.log.clear'), body: t('privacy.log.intro'), confirmLabel: t('privacy.log.clear'), danger: true });
    if (!ok) return;
    try {
      await services.ai.clearActivity();
      toast.show({ message: t('privacy.log.cleared'), tone: 'success' });
      await load();
    } catch (e) {
      toast.error(e);
    }
  };
  const reveal = (which: 'classesRoot' | 'private' | 'models' | 'cache') => void services.ctx.platform.storage.reveal(which).catch((e: unknown) => toast.error(e));
  const label = (id: string) => services.ai.label(id).label || modelLabelOf(id);
  return (
    <SectionRoot testid="settings-privacy" title={t('settings.sections.privacy')}>
      <Group id="flows" title={t('privacy.title')} description={t('privacy.intro')}>
        <div className="set-table-wrap">
          <Table label={t('privacy.title')} data-testid="privacy-table">
            <THead>
              <TR>
                <TH scope="col">{t('privacy.columns.when')}</TH>
                <TH scope="col">{t('privacy.columns.what')}</TH>
                <TH scope="col">{t('privacy.columns.to')}</TH>
              </TR>
            </THead>
            <TBody>
              {FLOWS.map((f) => {
                const r = flowText(f.id, locale);
                return (
                  <TR key={f.id} data-testid="privacy-flow" data-flow={f.id}>
                    <TD className="privacy-when">{r.when}</TD>
                    <TD>{r.what}</TD>
                    <TD className="privacy-to">{r.to}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </div>
      </Group>
      <Group
        id="ai-log"
        title={t('privacy.log.title')}
        description={t('privacy.log.intro')}
        testid="privacy-ai-log"
        actions={
          <Button size="sm" icon={Trash2} disabled={!rows || rows.length === 0} onClick={() => void clear()} data-testid="privacy-ai-log-clear">
            {t('privacy.log.clear')}
          </Button>
        }
      >
        {rows === null ? (
          <div className="set-empty"><Spinner /></div>
        ) : rows.length === 0 ? (
          <p className="set-empty" data-testid="privacy-ai-log-empty">{t('privacy.log.empty')}</p>
        ) : (
          <div className="set-table-wrap">
            <Table label={t('privacy.log.title')} dense>
              <THead>
                <TR>
                  <TH scope="col">{t('privacy.log.columns.time')}</TH>
                  <TH scope="col">{t('privacy.log.columns.class')}</TH>
                  <TH scope="col">{t('privacy.log.columns.action')}</TH>
                  <TH scope="col">{t('privacy.log.columns.model')}</TH>
                  <TH scope="col" numeric>{t('privacy.log.columns.passages')}</TH>
                  <TH scope="col" numeric>{t('privacy.log.columns.requests')}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.slice(0, 200).map((r, i) => {
                  const at = DateTime.fromISO(r.at);
                  const cls = r.classId ? classes.find((c) => c.id === r.classId) : undefined;
                  return (
                    <TR key={`${r.at}-${i}`} data-testid="privacy-ai-log-row">
                      <TD className="t-tabular">{`${i18n.date(at, 'short')} ${i18n.time(at)}`}</TD>
                      <TD>{cls ? <ClassChip cls={cls} short /> : '—'}</TD>
                      <TD>
                        {r.action && ACTIONS.has(r.action) ? t(`privacy.log.actions.${r.action as 'ask'}`) : '—'}
                        {r.codes.length ? <Badge tone="warning" className="privacy-code">{r.codes.join(', ')}</Badge> : null}
                      </TD>
                      <TD>{r.models.map(label).join(', ') || '—'}</TD>
                      <TD numeric>{r.passages}</TD>
                      <TD numeric>{r.requests}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Group>
      <Group id="where" title={t('privacy.where.title')} description={t('privacy.whereBody')}>
        <div className="set-links">
          <Button size="sm" icon={FolderOpen} onClick={() => reveal('classesRoot')} data-testid="privacy-open-classes">{t('privacy.where.classes')}</Button>
          <Button size="sm" icon={FolderOpen} onClick={() => reveal('private')} data-testid="privacy-open-private">{t('privacy.where.private')}</Button>
          <Button size="sm" icon={FolderOpen} onClick={() => reveal('models')} data-testid="privacy-open-models">{t('privacy.where.models')}</Button>
          <Button size="sm" icon={FolderOpen} onClick={() => reveal('cache')} data-testid="privacy-open-cache">{t('privacy.where.cache')}</Button>
        </div>
      </Group>
    </SectionRoot>
  );
}
