// An image document (UX §3.7.2): centred, fit or 100 %, and "Describe with AI" (one vision request; the result in an
// AiCard below, nothing stored).
import React, { useEffect, useState } from 'react';
import { Maximize2, Minimize2, Sparkles } from 'lucide-react';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import type { DocSummary } from '../../services/types/documents';
import { useStore } from '../../shell/useStore';
import { Button } from '../../ui/components/Button';
import { Spinner } from '../../ui/components/Feedback';
import { useToast } from '../../ui/components/Toast';
import { useI18n } from '../../ui/i18n';
import { AiCard } from '../../ui/tramado/AiCard';

export function ImageView({ services, classId, doc }: { services: AppServices; classId: ClassId; doc: DocSummary }) {
  const { t } = useI18n();
  const toast = useToast();
  const ai = useStore(services.ai.settings);
  const [fit, setFit] = useState(true);
  const [src, setSrc] = useState<string | null>(null);
  const [described, setDescribed] = useState<{ text: string; model: string } | 'loading' | null>(null);

  useEffect(() => {
    try {
      setSrc(services.forClass(classId).documents.url(doc.path));
    } catch {
      setSrc(null);
    }
  }, [services, classId, doc.path, doc.mtimeMs]);

  const describe = async () => {
    setDescribed('loading');
    try {
      const r = await services.extraction.describe!(classId, doc.path);
      setDescribed(r);
    } catch (e) {
      setDescribed(null);
      toast.error(e);
    }
  };
  const on = ai.enabled && ai.key.set && !!services.extraction.describe;

  return (
    <div className="docimg" data-testid="doc-image">
      <div className="docimg__bar">
        <Button size="sm" variant="ghost" icon={fit ? Maximize2 : Minimize2} onClick={() => setFit((f) => !f)} data-testid="doc-image-fit">
          {fit ? t('documents.view.actualSize') : t('documents.view.fitImage')}
        </Button>
        {on ? (
          <Button size="sm" icon={Sparkles} onClick={() => void describe()} busy={described === 'loading'} data-testid="doc-image-describe">{t('documents.view.describe')}</Button>
        ) : null}
      </div>
      <div className={`docimg__frame${fit ? ' docimg__frame--fit' : ''}`}>
        {src ? <img src={src} alt={doc.name} className="docimg__img" /> : <Spinner label={t('documents.view.loading')} />}
      </div>
      {described === 'loading' ? <p className="t-muted docimg__wait"><Spinner size={14} /> {t('documents.view.describing')}</p> : null}
      {described && described !== 'loading' ? (
        <AiCard title={t('documents.view.describeTitle')} model={services.ai.label(described.model)} className="docimg__card" data-testid="doc-image-description">
          <p>{described.text}</p>
        </AiCard>
      ) : null}
    </div>
  );
}
