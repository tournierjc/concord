/**
 * ErrorBoundary.tsx — a render error must never leave an empty window.
 *
 * Without a boundary React unmounts the whole tree on an uncaught render error: the window keeps
 * only its background colour, which is exactly the "black screen" users reported for v0.4.0. The
 * fallback depends on nothing but React and the catalogue — not on `window.lanAPI`, whose absence
 * is one of the failures it has to report.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { createTranslator, type Locale } from './i18n';

function systemLocale(): Locale {
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('en') ? 'en' : 'fr';
}

interface Props {
  children: ReactNode;
  /** Compact layout for the overlay window. */
  compact?: boolean;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[renderer] rendu interrompu', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (this.props.compact) return null;
    const t = createTranslator(systemLocale());
    return (
      <main className="app app--crash" role="alert">
        <section className="panel crash">
          <h1 className="panel__title">{t('app.crash.title')}</h1>
          <p>{t('app.crash.body')}</p>
          <div>
            <button type="button" className="button button--primary" onClick={() => window.location.reload()}>
              {t('app.crash.reload')}
            </button>
          </div>
          <details className="crash__detail">
            <summary>{t('app.crash.detail')}</summary>
            <pre>{error.message}</pre>
          </details>
        </section>
      </main>
    );
  }
}
