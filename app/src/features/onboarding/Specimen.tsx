// The welcome screen's picture (UX §3.1, lab mock welcome-light): three class cards like binder dividers, an AI
// answer citing two sources and the twelve class colours. Decorative: the parent is aria-hidden.
import React from 'react';
import { AudioLines, Files, FlaskConical, Palette, Scale, Sparkles, type LucideIcon } from 'lucide-react';
import { CLASS_COLORS, classStyle } from '../../ui/classColor';
import { useI18n } from '../../ui/i18n';

const CARDS: ReadonlyArray<{ key: 'law' | 'chem' | 'art'; colour: string; icon: LucideIcon; lectures: number; docs: number }> = [
  { key: 'law', colour: '#12a594', icon: Scale, lectures: 14, docs: 38 },
  { key: 'chem', colour: '#f76b15', icon: FlaskConical, lectures: 9, docs: 21 },
  { key: 'art', colour: '#ab4aba', icon: Palette, lectures: 6, docs: 54 },
];

export function Specimen() {
  const { t, tp } = useI18n();
  return (
    <div className="specimen">
      {CARDS.map((c, i) => (
        <div key={c.key} className={`specimen__card specimen__card--${i + 1} cls-scope`} style={classStyle(c.colour)}>
          <span className="specimen__tab">
            <c.icon size={13} strokeWidth={2} />
            {t(`onboarding.specimen.${c.key}Tab`)}
          </span>
          <span className="specimen__name">{t(`onboarding.specimen.${c.key}Name`)}</span>
          <span className="specimen__line">{t(`onboarding.specimen.${c.key}Line`)}</span>
          <span className="specimen__meta">
            <span>
              <AudioLines size={13} strokeWidth={1.75} />
              {tp('onboarding.specimen.lectures', c.lectures, { n: c.lectures })}
            </span>
            <span>
              <Files size={13} strokeWidth={1.75} />
              {tp('onboarding.specimen.docs', c.docs, { n: c.docs })}
            </span>
          </span>
        </div>
      ))}
      <div className="specimen__ai">
        <span className="badge badge--ai specimen__badge">
          <Sparkles size={12} strokeWidth={2} />
          {t('onboarding.specimen.aiBadge')}
        </span>
        <span className="specimen__q">{t('onboarding.specimen.aiQuestion')}</span>
        <span className="specimen__a">
          {t('onboarding.specimen.aiAnswerA')} <span className="specimen__cite">1</span>
          {t('onboarding.specimen.aiAnswerB')} <span className="specimen__cite">2</span>.
        </span>
      </div>
      <div className="specimen__swatches">
        {CLASS_COLORS.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}
