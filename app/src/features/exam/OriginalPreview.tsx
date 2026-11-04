// The original of an exam paper on the Review screen (UX §3.9.6): PDF pages rendered by pdf.js in the image worker
// (`ctx.pdfRender`) and photos as they are, page after page; the page of the selected question is scrolled into view.
import React, { useEffect, useRef, useState } from 'react';
import type { ExamFile } from '../../core/model/files';
import type { ClassId } from '../../core/model/ids';
import type { AppServices } from '../../services/types/common';
import { useI18n } from '../../ui/i18n';
import { scrollBehavior } from '../../ui/media';

interface Shown { file: string; page: number; url: string }
const MAX_PAGES = 20;

export function OriginalPreview({ services, classId, files, page }: { services: AppServices; classId: ClassId; files: ExamFile['files']; page: { file: string; page: number } | null }) {
  const { t } = useI18n();
  const [shown, setShown] = useState<Shown[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    const urls: string[] = [];
    void (async () => {
      const out: Shown[] = [];
      try {
        for (const f of files) {
          if (out.length >= MAX_PAGES) break;
          const bytes = await services.ctx.platform.fs.read(classId, f.path);
          if (/^image\//.test(f.mime)) {
            const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: f.mime }));
            urls.push(url);
            out.push({ file: f.path, page: 1, url });
          } else if (f.mime === 'application/pdf') {
            const n = Math.min(await services.ctx.pdfRender.pages(bytes), MAX_PAGES - out.length);
            for (let p = 1; p <= n; p++) {
              const jpeg = await services.ctx.pdfRender.renderJpeg(bytes, p, 1100);
              const url = URL.createObjectURL(new Blob([jpeg as BlobPart], { type: 'image/jpeg' }));
              urls.push(url);
              out.push({ file: f.path, page: p, url });
              if (live) setShown([...out]);
            }
          }
        }
        if (live) {
          setShown(out);
          setState('ready');
        }
      } catch {
        if (live) setState(out.length ? 'ready' : 'error');
      }
    })();
    return () => {
      live = false;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [services, classId, files]);

  useEffect(() => {
    if (!page || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`[data-file="${CSS.escape(page.file)}"][data-page="${page.page}"]`);
    el?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }, [page, shown.length]);

  return (
    <div className="original" ref={box} role="region" aria-label={t('exams.review.original')} tabIndex={0} data-testid="review-original">
      <h2 className="review__col-title">{t('exams.review.original')}</h2>
      {shown.map((s) => (
        <figure key={`${s.file}#${s.page}`} className="original__page" data-file={s.file} data-page={s.page}>
          <img src={s.url} alt={t('exams.review.page', { n: s.page })} />
          <figcaption className="t-small t-muted">{t('exams.review.page', { n: s.page })}</figcaption>
        </figure>
      ))}
      {state === 'loading' && !shown.length ? <p className="t-muted t-small">{t('common.loading')}</p> : null}
      {state === 'error' ? <p className="t-muted t-small">{t('exams.review.noPreview')}</p> : null}
    </div>
  );
}
