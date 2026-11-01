/**
 * main.tsx — entrée du document principal (fenêtre salons / réglages).
 *
 * NON VÉRIFIÉ ici : React + Vite non installables dans cet environnement.
 * Vérification future : `cd /work/lan-voice && npm ci && npm run build` puis lancement Electron.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { applyTheme } from './theme';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('élément #root absent de index.html');

// Thème provisoire : le réglage persistant l'emporte dès qu'il est chargé (App).
applyTheme(document.documentElement, 'system');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
