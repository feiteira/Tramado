// The class screen frame (UX §3.3.2): header in the class colour, actions and the tab host of
// CLASS_TABS. M0 builds the frame; UI-SHELL owns it in wave 2 (dialogs `new-class`, `class-settings`).
import React, { Suspense, lazy, useMemo } from 'react';
import { CircleDot, FolderSync, UserPlus } from 'lucide-react';
import type { AppServices } from '../../services/types/common';
import type { ClassView } from '../../services/types/viewModels';
import { CLASS_TABS, CLASS_STATES } from '../registry';
import type { ClassTabId, Route } from '../../shell/routes';
import { useRouter } from '../../shell/router';
import { useDialogs } from '../../shell/useDialogs';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Spinner } from '../../ui/components/Feedback';
import { Tabs } from '../../ui/components/Tabs';
import { ClassTab } from '../../ui/tramado/ClassTab';
import { classStyle } from '../../ui/classColor';
import { useI18n } from '../../ui/i18n';
import { ScreenHeader } from '../../shell/ScreenHeader';
import { Missing } from '../../shell/Placeholder';
import '../../shell/shell.css';

const lazyTabs = Object.fromEntries(Object.entries(CLASS_TABS).map(([k, v]) => [k, lazy(v)])) as Record<ClassTabId, ReturnType<typeof lazy<React.ComponentType<{ classId: string; services: AppServices }>>>>;
const FolderMissing = lazy(CLASS_STATES.folderMissing);

export function tabsOf(cls: ClassView): ClassTabId[] {
  return cls.shared ? ['lectures', 'documents', 'notes', 'exams', 'chat', 'ask', 'members'] : ['lectures', 'documents', 'notes', 'exams', 'ask', 'share'];
}

export default function ClassScreen({ route, services }: { route: Extract<Route, { name: 'class' }>; services: AppServices }) {
  const { t } = useI18n();
  const { replace } = useRouter();
  const dialogs = useDialogs();
  const classes = useStore(services.library.classes);
  const cls = classes.find((c) => c.id === route.classId);
  const tabs = useMemo(() => (cls ? tabsOf(cls) : []), [cls]);
  if (!cls) return <Missing what="class" />;
  const tab: ClassTabId = route.tab && tabs.includes(route.tab) ? route.tab : 'lectures';
  const TabView = lazyTabs[tab];
  const meta = [cls.lecturer, cls.term].filter(Boolean).join(' · ');
  return (
    <div className="class-screen" data-testid="screen-class" data-class-id={cls.id}>
      <ScreenHeader title={cls.name} hideTitle />
      <header className="cls-scope class-header" style={classStyle(cls.color)}>
        <ClassTab color={cls.color} icon={cls.icon} size="lg" filled />
        <div className="class-header__titles">
          <h1 className="class-header__title" tabIndex={-1}>{cls.name}</h1>
          <p className="class-header__meta t-small">{meta || cls.shortName}</p>
        </div>
        <div className="class-header__actions">
          {cls.shared ? (
            <Button icon={UserPlus} onClick={() => dialogs.open('invite', { classId: cls.id })} data-testid="class-invite">{t('classes.header.invite')}</Button>
          ) : (
            <Button icon={FolderSync} onClick={() => replace({ ...route, tab: 'share' })} data-testid="class-share-open">{t('classes.header.share')}</Button>
          )}
          <Button variant="primary" icon={CircleDot} onClick={() => dialogs.open('record', { classId: cls.id })} data-testid="record-class">{t('classes.header.record')}</Button>
        </div>
      </header>
      {cls.sync.kind === 'missingFolder' ? (
        <Suspense fallback={<Spinner />}>
          <FolderMissing classId={cls.id} services={services} />
        </Suspense>
      ) : (
        <div className="cls-scope class-tabs-host" style={classStyle(cls.color)}>
          <Tabs
            label={t('classes.tabs.label')}
            value={tab}
            onChange={(v: ClassTabId) => replace({ name: 'class', classId: cls.id, tab: v })}
            items={tabs.map((id) => ({ value: id, label: t(`classes.tabs.${id}`) }))}
            data-testid="class-tabs"
          >
            <Suspense fallback={<Spinner />}>
              <TabView key={`${cls.id}:${tab}`} classId={cls.id} services={services} />
            </Suspense>
          </Tabs>
        </div>
      )}
    </div>
  );
}
