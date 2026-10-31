/**
 * theme.ts — injection des design tokens comme variables CSS.
 *
 * Aucune couleur, aucun espacement, aucune durée n'est écrit dans les composants ni dans la
 * feuille de style : tout vient de `design/tokens.json`, converti en `--variables` au démarrage.
 * Conséquence directe : changer un token change l'application entière, et une revue de design se
 * fait dans un seul fichier.
 *
 * Le thème clair/sombre suit le réglage (`dark` | `light`) ou le système (`system`). Aucune police
 * distante n'est chargée : `typography.family` ne cite que des polices locales avec repli système.
 *
 * NON VÉRIFIÉ ici : code navigateur, requiert le build Vite (`npm run build`).
 */

import tokens from '../../design/tokens.json';

export type ThemeName = 'dark' | 'light' | 'system';

type TokenGroup = Record<string, string>;

// Double cast assumé (C12-3) : `design/tokens.json` est un objet de tokens hétérogène importé sans
// générique ; sa forme réelle (dark/light → groupes → clés) n'est pas inférable depuis le JSON, et
// il n'existe pas d'alternative sans dupliquer les tokens dans un type explicite. Unique et local.
const COLOR_THEMES = tokens.color.theme as unknown as Record<'dark' | 'light', Record<string, TokenGroup>>;
const COLOR_GROUPS = ['bg', 'border', 'text', 'accent', 'state', 'focus', 'scrim'] as const;

function kebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function colorDeclarations(themeName: 'dark' | 'light'): string[] {
  const theme = COLOR_THEMES[themeName];
  const out: string[] = [];
  for (const group of COLOR_GROUPS) {
    const values = theme[group];
    if (!values) continue;
    for (const [key, value] of Object.entries(values)) {
      out.push(`--color-${group}-${kebab(key)}: ${value};`);
    }
  }
  return out;
}

/** `unit` vide = valeur sans unité (ratios de interligne, graisses). */
function scalarDeclarations(
  prefix: string,
  group: Record<string, string | number>,
  unit: '' | 'px' | 'ms' = '',
): string[] {
  return Object.entries(group).map(([key, value]) => {
    const name = `--${prefix}-${kebab(key)}`;
    if (typeof value === 'number') return `${name}: ${value}${unit};`;
    return `${name}: ${value};`;
  });
}

const SHARED_DECLARATIONS: string[] = [
  ...scalarDeclarations('space', tokens.space, 'px'),
  ...scalarDeclarations('radius', tokens.radius, 'px'),
  ...scalarDeclarations('text', tokens.typography.size, 'px'),
  ...scalarDeclarations('leading', tokens.typography.lineHeight),
  ...scalarDeclarations('weight', tokens.typography.weight),
  ...scalarDeclarations('tracking', tokens.typography.letterSpacing),
  ...scalarDeclarations('motion', tokens.motion.duration, 'ms'),
  ...scalarDeclarations('ease', tokens.motion.easing),
  ...scalarDeclarations('layout', {
    windowWidth: tokens.layout.window.width,
    windowHeight: tokens.layout.window.height,
    windowMinWidth: tokens.layout.window.minWidth,
    windowMinHeight: tokens.layout.window.minHeight,
    titleBar: tokens.layout.titleBarHeight,
    row: tokens.layout.listRowHeight,
    rowAvatar: tokens.layout.rowAvatarSize,
    tileAvatar: tokens.layout.tileAvatarSize,
  }),
  ...scalarDeclarations('component', {
    buttonHeight: tokens.component.button.height,
    buttonHeightCompact: tokens.component.button.heightCompact,
    buttonPaddingX: tokens.component.button.paddingX,
    inputHeight: tokens.component.input.height,
    focusWidth: tokens.component.focus.width,
    focusOffset: tokens.component.focus.offset,
    hairline: tokens.component.border.hairline,
    accentBorder: tokens.component.border.accent,
  }),
  `--font-ui: ${tokens.typography.family.ui};`,
  `--font-mono: ${tokens.typography.family.mono};`,
];

/** Feuille de style des tokens, à injecter une fois au démarrage. */
export function tokensStyleSheet(): string {
  return [
    ':root {',
    ...SHARED_DECLARATIONS.map((declaration) => `  ${declaration}`),
    '}',
    ...[('dark' as const), ('light' as const)].map((themeName) =>
      [`[data-theme="${themeName}"] {`, ...colorDeclarations(themeName).map((d) => `  ${d}`), '}'].join('\n'),
    ),
  ].join('\n');
}

const STYLE_ELEMENT_ID = 'lan-tokens';

/** Injecte les variables puis applique le thème demandé. */
export function applyTheme(root: HTMLElement, theme: ThemeName): void {
  let style = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ELEMENT_ID;
    // Le CSS est généré localement à partir des tokens : rien à autoriser dans la CSP.
    style.textContent = tokensStyleSheet();
    document.head.appendChild(style);
  }
  const resolved =
    theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme;
  root.setAttribute('data-theme', resolved);
  root.style.colorScheme = resolved;
}

/** Suit le thème système quand le réglage vaut `system` ; renvoie une fonction d'arrêt. */
export function watchSystemTheme(root: HTMLElement, theme: ThemeName): () => void {
  if (theme !== 'system') return () => undefined;
  const query = window.matchMedia('(prefers-color-scheme: light)');
  const listener = (): void => applyTheme(root, 'system');
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
