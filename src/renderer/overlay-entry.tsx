/**
 * overlay-entry.tsx — entrée du document overlay (fenêtre séparée, sans cadre).
 *
 * NON VÉRIFIÉ ici : React + Vite non installables dans cet environnement.
 * Vérification future : `cd /work/lan-voice && npm ci && npm run build` puis lancement Electron.
 */

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { ParticipantDto } from '../shell/ipc-contract';
import type { OverlayPlacement } from '../shell/overlay-geometry';
import { lanApi } from './api';
import { browserTimers } from './browser-timers';
import { ErrorBoundary } from './ErrorBoundary';
import type { Locale } from './i18n';
import { Overlay } from './Overlay';
import { createSpeakingSurface, type SpeakingIds } from './speaking-surface';
import { applyTheme } from './theme';
import './styles.css';

function OverlayRoot(): JSX.Element {
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [revision, setRevision] = useState(0);
  const [locale, setLocale] = useState<Locale>('fr');
  const [placement, setPlacement] = useState<OverlayPlacement>('top-right');
  const [selfId, setSelfId] = useState<string | null>(null);
  // Parole relayée : `[]` n'affirme rien (l'overlay n'a aucune mesure à lui, AD-17 D1).
  const [parole, afficherParole] = useState<SpeakingIds>([]);

  useEffect(() => {
    const api = lanApi();
    let active = true;
    void api.getSettings().then((settings) => {
      if (!active) return;
      setLocale(settings.locale);
      setPlacement(settings.overlay.placement);
    });
    const unsubscribeSettings = api.onSettingsChanged(({ settings }) => {
      if (!active) return;
      setPlacement(settings.overlay.placement);
    });
    const unsubscribe = api.onParticipants((next) => {
      setParticipants(next);
      setRevision((value) => value + 1);
    });
    // L'overlay ne reçoit que la liste des participants : l'id local arrive par le salon, et c'est
    // lui seul qui donne un sens aux drapeaux mute/déafen (T18).
    const unsubscribeRoom = api.onRoomState((state) => {
      if (active) setSelfId(state.selfId);
    });

    // Parole : sens unique renderer → main → overlay (AD-25 §6). L'overlay ne publie jamais ; il
    // reçoit des ids déjà mesurés, estampille l'ARRIVÉE et éteint par échéancier à 2000 ms.
    // L'échéancier passe par le port de minuterie de la page (A3 : deux fichiers, pas trois).
    const surface = createSpeakingSurface({
      timers: browserTimers(),
      clock: () => performance.now(),
      // Appelé seulement quand l'état affiché change : la garde-vie à 1 Hz ne rend rien (ACo-16).
      onChange: (ids) => {
        if (active) afficherParole(ids);
      },
    });
    const unsubscribeSpeaking = api.onSpeakingSet((payload) => surface.receive(payload.speaking));

    return () => {
      active = false;
      unsubscribe();
      unsubscribeSettings();
      unsubscribeRoom();
      unsubscribeSpeaking();
      // Démontage : aucun minuteur ne survit à l'overlay (AD-25 D2, `cancel` par les deux chemins).
      surface.dispose();
    };
  }, []);

  return (
    <Overlay
      locale={locale}
      participants={participants}
      selfId={selfId}
      speaking={parole}
      revision={revision}
      placement={placement}
    />
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('élément #root absent de overlay.html');

// L'overlay est toujours sombre : c'est un incrustat sur jeu/éditeur, pas une fenêtre de travail.
applyTheme(document.documentElement, 'dark');

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary compact>
      <OverlayRoot />
    </ErrorBoundary>
  </StrictMode>,
);
