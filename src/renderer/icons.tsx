/**
 * icons.tsx — icônes inline des boutons d'action du salon.
 *
 * SVG dessinés à la main (aucune ressource distante : la CSP l'interdit et le LAN n'en veut pas),
 * en trait `currentColor` : l'icône hérite la couleur du bouton, claire ou sombre selon le thème.
 * Chaque consommateur fournit le libellé accessible (`aria-label`/`title`) — les icônes sont
 * `aria-hidden`, le sens vient du bouton, jamais du dessin.
 */

interface IconProps {
  className?: string;
}

function base(className?: string): { className: string; viewBox: string; fill: string; stroke: string } {
  return { className: className ? `icon ${className}` : 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor' };
}

export function MicIcon({ className }: IconProps): JSX.Element {
  const props = base(className);
  return (
    <svg {...props} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function MicOffIcon({ className }: IconProps): JSX.Element {
  const props = base(className);
  return (
    <svg {...props} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5v6a3 3 0 0 1-.55 1.74" />
      <path d="M9 9v2a3 3 0 0 0 4.68 2.47" />
      <path d="M5 11a7 7 0 0 0 11.62 5.26" />
      <path d="M19 11a7 7 0 0 1-1.17 3.89" />
      <path d="M12 18v3" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function HeadphonesIcon({ className }: IconProps): JSX.Element {
  const props = base(className);
  return (
    <svg {...props} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="3" y="14" width="5" height="7" rx="2" />
      <rect x="16" y="14" width="5" height="7" rx="2" />
    </svg>
  );
}

export function HeadphonesOffIcon({ className }: IconProps): JSX.Element {
  const props = base(className);
  return (
    <svg {...props} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 15v-3a8 8 0 0 1 12.6-6.5" />
      <path d="M20 12v3" />
      <rect x="3" y="14" width="5" height="7" rx="2" />
      <rect x="16" y="14" width="5" height="7" rx="2" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

export function LeaveIcon({ className }: IconProps): JSX.Element {
  const props = base(className);
  return (
    <svg {...props} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
