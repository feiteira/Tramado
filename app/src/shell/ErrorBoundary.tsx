import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { i18nStatic } from '../ui/i18n';
import '../ui/components/button.css';
import './errorboundary.css';

/**
 * Last-resort screen. Data is saved on every change, so a reload loses nothing. It shows what
 * went wrong and where, as selectable text the researcher can copy into a report: the desktop
 * app has no developer console, so this is the only place the error can be seen.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; where: string; copied: boolean }> {
  override state = { error: null as Error | null, where: '', copied: false };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    this.setState({ where: (info.componentStack ?? '').trim() });
  }

  override render() {
    const { error, where, copied } = this.state;
    if (!error) return this.props.children;
    const { t } = i18nStatic();
    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';
    const details = [
      `Tramado ${version}`,
      `${error.name}: ${error.message}`,
      ...(error.stack ?? '').split('\n').slice(0, 12),
      '',
      ...where.split('\n').slice(0, 16).map((l) => l.trim()),
    ].join('\n');
    return (
      <div className="crash" role="alert">
        <div className="crash__inner">
          <h1 className="crash__title">{t('app.crash.title')}</h1>
          <p className="crash__body">{t('app.crash.body')}</p>
          <div className="crash__actions">
            <button type="button" className="btn btn--primary btn--md" onClick={() => window.location.reload()} data-testid="crash-reload">
              {t('app.crash.reload')}
            </button>
            <button
              type="button"
              className="btn btn--secondary btn--md"
              data-testid="crash-copy"
              onClick={() => {
                void navigator.clipboard?.writeText(details).then(
                  () => this.setState({ copied: true }),
                  () => undefined,
                );
              }}
            >
              {copied ? t('app.crash.copied') : t('app.crash.copy')}
            </button>
          </div>
          <pre className="crash__details" data-testid="crash-details" tabIndex={0}>
            {details}
          </pre>
        </div>
      </div>
    );
  }
}
