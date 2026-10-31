#!/usr/bin/env node
// design/check-contrast.mjs — vérifie le contraste WCAG 2.1 AA des paires de design/tokens.json.
// Node pur, zéro dépendance : ni npm, ni node_modules (voir SPEC-002 §2.2).
//   cd /work/lan-voice && node design/check-contrast.mjs
// Sortie : une ligne par paire en échec, un récapitulatif, CONTRAST RESULT=PASS|FAIL, exit 0/1.
import { readFileSync } from 'node:fs';

const tokens = JSON.parse(readFileSync(new URL('./tokens.json', import.meta.url), 'utf8'));

const PAIRS = [
  { theme: 'dark', fg: 'text.primary', bg: 'bg.canvas', fgHex: '#F1F4F8', bgHex: '#0E1116', doc: 17.14, min: 4.5, usage: "Texte principal sur fond de fenêtre" },
  { theme: 'dark', fg: 'text.primary', bg: 'bg.surface', fgHex: '#F1F4F8', bgHex: '#151A21', doc: 15.84, min: 4.5, usage: "Texte principal sur panneau" },
  { theme: 'dark', fg: 'text.primary', bg: 'bg.raised', fgHex: '#F1F4F8', bgHex: '#1C232C', doc: 14.35, min: 4.5, usage: "Texte principal sur carte / ligne de salon" },
  { theme: 'dark', fg: 'text.primary', bg: 'bg.hover', fgHex: '#F1F4F8', bgHex: '#232B36', doc: 12.95, min: 4.5, usage: "Texte principal sur ligne survolée" },
  { theme: 'dark', fg: 'text.primary', bg: 'bg.inset', fgHex: '#F1F4F8', bgHex: '#090B0F', doc: 17.85, min: 4.5, usage: "Texte principal sur champ creux" },
  { theme: 'dark', fg: 'text.primary', bg: 'bg.overlay', fgHex: '#F1F4F8', bgHex: '#0B0E13', doc: 17.52, min: 4.5, usage: "Texte principal dans l overlay" },
  { theme: 'dark', fg: 'text.secondary', bg: 'bg.canvas', fgHex: '#AEB9C6', bgHex: '#0E1116', doc: 9.51, min: 4.5, usage: "Texte secondaire sur fond de fenêtre" },
  { theme: 'dark', fg: 'text.secondary', bg: 'bg.surface', fgHex: '#AEB9C6', bgHex: '#151A21', doc: 8.78, min: 4.5, usage: "Texte secondaire sur panneau" },
  { theme: 'dark', fg: 'text.secondary', bg: 'bg.raised', fgHex: '#AEB9C6', bgHex: '#1C232C', doc: 7.96, min: 4.5, usage: "Texte secondaire sur carte" },
  { theme: 'dark', fg: 'text.secondary', bg: 'bg.inset', fgHex: '#AEB9C6', bgHex: '#090B0F', doc: 9.9, min: 4.5, usage: "Texte de champ creux" },
  { theme: 'dark', fg: 'text.secondary', bg: 'bg.overlay', fgHex: '#AEB9C6', bgHex: '#0B0E13', doc: 9.71, min: 4.5, usage: "Pseudo dans l overlay" },
  { theme: 'dark', fg: 'text.muted', bg: 'bg.canvas', fgHex: '#8B97A5', bgHex: '#0E1116', doc: 6.36, min: 4.5, usage: "Texte atténué sur fond de fenêtre" },
  { theme: 'dark', fg: 'text.muted', bg: 'bg.surface', fgHex: '#8B97A5', bgHex: '#151A21', doc: 5.88, min: 4.5, usage: "Texte atténué sur panneau (aide, horodatage)" },
  { theme: 'dark', fg: 'text.muted', bg: 'bg.raised', fgHex: '#8B97A5', bgHex: '#1C232C', doc: 5.33, min: 4.5, usage: "Texte atténué sur carte" },
  { theme: 'dark', fg: 'accent.default', bg: 'bg.surface', fgHex: '#4C9AFF', bgHex: '#151A21', doc: 6.14, min: 4.5, usage: "Lien / texte accent sur panneau" },
  { theme: 'dark', fg: 'accent.default', bg: 'bg.canvas', fgHex: '#4C9AFF', bgHex: '#0E1116', doc: 6.64, min: 4.5, usage: "Lien / texte accent sur fond de fenêtre" },
  { theme: 'dark', fg: 'accent.on', bg: 'accent.default', fgHex: '#06121F', bgHex: '#4C9AFF', doc: 6.62, min: 4.5, usage: "Libellé du bouton primaire" },
  { theme: 'dark', fg: 'accent.on', bg: 'accent.hover', fgHex: '#06121F', bgHex: '#6FB0FF', doc: 8.37, min: 4.5, usage: "Libellé du bouton primaire survolé" },
  { theme: 'dark', fg: 'accent.on', bg: 'accent.pressed', fgHex: '#06121F', bgHex: '#2F7FE0', doc: 4.7, min: 4.5, usage: "Libellé du bouton primaire enfoncé" },
  { theme: 'dark', fg: 'text.primary', bg: 'accent.subtle', fgHex: '#F1F4F8', bgHex: '#16273D', doc: 13.68, min: 4.5, usage: "Texte sur fond accentué discret (badge)" },
  { theme: 'dark', fg: 'state.mute', bg: 'bg.surface', fgHex: '#FF6B6B', bgHex: '#151A21', doc: 6.3, min: 4.5, usage: "Texte / icône muet sur panneau" },
  { theme: 'dark', fg: 'state.mute', bg: 'state.muteSubtle', fgHex: '#FF6B6B', bgHex: '#3A1417', doc: 5.86, min: 4.5, usage: "Texte de bandeau d erreur" },
  { theme: 'dark', fg: 'state.mute', bg: 'bg.overlay', fgHex: '#FF6B6B', bgHex: '#0B0E13', doc: 6.97, min: 4.5, usage: "Croix de muet dans l overlay" },
  { theme: 'dark', fg: 'state.warn', bg: 'bg.surface', fgHex: '#FFB020', bgHex: '#151A21', doc: 9.56, min: 4.5, usage: "Texte / icône d avertissement sur panneau" },
  { theme: 'dark', fg: 'state.warn', bg: 'state.warnSubtle', fgHex: '#FFB020', bgHex: '#33260A', doc: 8.07, min: 4.5, usage: "Texte de bandeau d avertissement" },
  { theme: 'dark', fg: 'state.ok', bg: 'bg.surface', fgHex: '#3DDC84', bgHex: '#151A21', doc: 9.79, min: 4.5, usage: "Texte / icône état sain sur panneau" },
  { theme: 'dark', fg: 'state.ok', bg: 'bg.raised', fgHex: '#3DDC84', bgHex: '#1C232C', doc: 8.87, min: 4.5, usage: "Pastille qualité sur carte" },
  { theme: 'dark', fg: 'text.inverse', bg: 'text.primary', fgHex: '#0B0E13', bgHex: '#F1F4F8', doc: 17.52, min: 4.5, usage: "Texte sur pastille pleine (avatar de secours)" },
  { theme: 'dark', fg: 'border.strong', bg: 'bg.surface', fgHex: '#6E7D90', bgHex: '#151A21', doc: 4.16, min: 3, usage: "Bordure de champ de saisie (seule limite visible)" },
  { theme: 'dark', fg: 'border.strong', bg: 'bg.inset', fgHex: '#6E7D90', bgHex: '#090B0F', doc: 4.69, min: 3, usage: "Bordure de champ sur fond creux" },
  { theme: 'dark', fg: 'focus.ring', bg: 'bg.canvas', fgHex: '#8CC4FF', bgHex: '#0E1116', doc: 10.32, min: 3, usage: "Anneau de focus sur fond de fenêtre" },
  { theme: 'dark', fg: 'focus.ring', bg: 'bg.surface', fgHex: '#8CC4FF', bgHex: '#151A21', doc: 9.53, min: 3, usage: "Anneau de focus sur panneau" },
  { theme: 'dark', fg: 'focus.ring', bg: 'bg.overlay', fgHex: '#8CC4FF', bgHex: '#0B0E13', doc: 10.54, min: 3, usage: "Anneau de focus dans l overlay (jamais rendu)" },
  { theme: 'dark', fg: 'state.speaking', bg: 'bg.raised', fgHex: '#3DDC84', bgHex: '#1C232C', doc: 8.87, min: 3, usage: "Halo de parole 2 px autour de l avatar" },
  { theme: 'dark', fg: 'state.speaking', bg: 'bg.overlay', fgHex: '#3DDC84', bgHex: '#0B0E13', doc: 10.83, min: 3, usage: "Halo de parole dans l overlay" },
  { theme: 'dark', fg: 'accent.default', bg: 'bg.canvas', fgHex: '#4C9AFF', bgHex: '#0E1116', doc: 6.64, min: 3, usage: "Bouton primaire (aplat) sur fond de fenêtre" },
  { theme: 'dark', fg: 'accent.default', bg: 'bg.surface', fgHex: '#4C9AFF', bgHex: '#151A21', doc: 6.14, min: 3, usage: "Bouton primaire (aplat) sur panneau" },
  { theme: 'light', fg: 'text.primary', bg: 'bg.canvas', fgHex: '#12171D', bgHex: '#F4F6F9', doc: 16.64, min: 4.5, usage: "Texte principal sur fond de fenêtre" },
  { theme: 'light', fg: 'text.primary', bg: 'bg.surface', fgHex: '#12171D', bgHex: '#FFFFFF', doc: 18.01, min: 4.5, usage: "Texte principal sur panneau" },
  { theme: 'light', fg: 'text.primary', bg: 'bg.raised', fgHex: '#12171D', bgHex: '#FFFFFF', doc: 18.01, min: 4.5, usage: "Texte principal sur carte / ligne de salon" },
  { theme: 'light', fg: 'text.primary', bg: 'bg.hover', fgHex: '#12171D', bgHex: '#E7ECF2', doc: 15.16, min: 4.5, usage: "Texte principal sur ligne survolée" },
  { theme: 'light', fg: 'text.primary', bg: 'bg.inset', fgHex: '#12171D', bgHex: '#EDF0F4', doc: 15.76, min: 4.5, usage: "Texte principal sur champ creux" },
  { theme: 'light', fg: 'text.primary', bg: 'bg.overlay', fgHex: '#12171D', bgHex: '#FFFFFF', doc: 18.01, min: 4.5, usage: "Texte principal dans l overlay" },
  { theme: 'light', fg: 'text.secondary', bg: 'bg.canvas', fgHex: '#48545F', bgHex: '#F4F6F9', doc: 7.16, min: 4.5, usage: "Texte secondaire sur fond de fenêtre" },
  { theme: 'light', fg: 'text.secondary', bg: 'bg.surface', fgHex: '#48545F', bgHex: '#FFFFFF', doc: 7.75, min: 4.5, usage: "Texte secondaire sur panneau" },
  { theme: 'light', fg: 'text.secondary', bg: 'bg.raised', fgHex: '#48545F', bgHex: '#FFFFFF', doc: 7.75, min: 4.5, usage: "Texte secondaire sur carte" },
  { theme: 'light', fg: 'text.secondary', bg: 'bg.inset', fgHex: '#48545F', bgHex: '#EDF0F4', doc: 6.78, min: 4.5, usage: "Texte de champ creux" },
  { theme: 'light', fg: 'text.secondary', bg: 'bg.overlay', fgHex: '#48545F', bgHex: '#FFFFFF', doc: 7.75, min: 4.5, usage: "Pseudo dans l overlay" },
  { theme: 'light', fg: 'text.muted', bg: 'bg.canvas', fgHex: '#5B6672', bgHex: '#F4F6F9', doc: 5.41, min: 4.5, usage: "Texte atténué sur fond de fenêtre" },
  { theme: 'light', fg: 'text.muted', bg: 'bg.surface', fgHex: '#5B6672', bgHex: '#FFFFFF', doc: 5.85, min: 4.5, usage: "Texte atténué sur panneau (aide, horodatage)" },
  { theme: 'light', fg: 'text.muted', bg: 'bg.raised', fgHex: '#5B6672', bgHex: '#FFFFFF', doc: 5.85, min: 4.5, usage: "Texte atténué sur carte" },
  { theme: 'light', fg: 'accent.default', bg: 'bg.surface', fgHex: '#1B62D6', bgHex: '#FFFFFF', doc: 5.58, min: 4.5, usage: "Lien / texte accent sur panneau" },
  { theme: 'light', fg: 'accent.default', bg: 'bg.canvas', fgHex: '#1B62D6', bgHex: '#F4F6F9', doc: 5.15, min: 4.5, usage: "Lien / texte accent sur fond de fenêtre" },
  { theme: 'light', fg: 'accent.on', bg: 'accent.default', fgHex: '#FFFFFF', bgHex: '#1B62D6', doc: 5.58, min: 4.5, usage: "Libellé du bouton primaire" },
  { theme: 'light', fg: 'accent.on', bg: 'accent.hover', fgHex: '#FFFFFF', bgHex: '#1751B0', doc: 7.39, min: 4.5, usage: "Libellé du bouton primaire survolé" },
  { theme: 'light', fg: 'accent.on', bg: 'accent.pressed', fgHex: '#FFFFFF', bgHex: '#12408C', doc: 9.82, min: 4.5, usage: "Libellé du bouton primaire enfoncé" },
  { theme: 'light', fg: 'text.primary', bg: 'accent.subtle', fgHex: '#12171D', bgHex: '#E3EDFC', doc: 15.25, min: 4.5, usage: "Texte sur fond accentué discret (badge)" },
  { theme: 'light', fg: 'state.mute', bg: 'bg.surface', fgHex: '#C4282B', bgHex: '#FFFFFF', doc: 5.7, min: 4.5, usage: "Texte / icône muet sur panneau" },
  { theme: 'light', fg: 'state.mute', bg: 'state.muteSubtle', fgHex: '#C4282B', bgHex: '#FDE9E9', doc: 4.89, min: 4.5, usage: "Texte de bandeau d erreur" },
  { theme: 'light', fg: 'state.mute', bg: 'bg.overlay', fgHex: '#C4282B', bgHex: '#FFFFFF', doc: 5.7, min: 4.5, usage: "Croix de muet dans l overlay" },
  { theme: 'light', fg: 'state.warn', bg: 'bg.surface', fgHex: '#8A5A00', bgHex: '#FFFFFF', doc: 5.93, min: 4.5, usage: "Texte / icône d avertissement sur panneau" },
  { theme: 'light', fg: 'state.warn', bg: 'state.warnSubtle', fgHex: '#8A5A00', bgHex: '#FDF3DC', doc: 5.37, min: 4.5, usage: "Texte de bandeau d avertissement" },
  { theme: 'light', fg: 'state.ok', bg: 'bg.surface', fgHex: '#0D6B43', bgHex: '#FFFFFF', doc: 6.56, min: 4.5, usage: "Texte / icône état sain sur panneau" },
  { theme: 'light', fg: 'state.ok', bg: 'bg.raised', fgHex: '#0D6B43', bgHex: '#FFFFFF', doc: 6.56, min: 4.5, usage: "Pastille qualité sur carte" },
  { theme: 'light', fg: 'text.inverse', bg: 'text.primary', fgHex: '#FFFFFF', bgHex: '#12171D', doc: 18.01, min: 4.5, usage: "Texte sur pastille pleine (avatar de secours)" },
  { theme: 'light', fg: 'border.strong', bg: 'bg.surface', fgHex: '#767F8C', bgHex: '#FFFFFF', doc: 4.05, min: 3, usage: "Bordure de champ de saisie (seule limite visible)" },
  { theme: 'light', fg: 'border.strong', bg: 'bg.inset', fgHex: '#767F8C', bgHex: '#EDF0F4', doc: 3.54, min: 3, usage: "Bordure de champ sur fond creux" },
  { theme: 'light', fg: 'focus.ring', bg: 'bg.canvas', fgHex: '#1B62D6', bgHex: '#F4F6F9', doc: 5.15, min: 3, usage: "Anneau de focus sur fond de fenêtre" },
  { theme: 'light', fg: 'focus.ring', bg: 'bg.surface', fgHex: '#1B62D6', bgHex: '#FFFFFF', doc: 5.58, min: 3, usage: "Anneau de focus sur panneau" },
  { theme: 'light', fg: 'focus.ring', bg: 'bg.overlay', fgHex: '#1B62D6', bgHex: '#FFFFFF', doc: 5.58, min: 3, usage: "Anneau de focus dans l overlay (jamais rendu)" },
  { theme: 'light', fg: 'state.speaking', bg: 'bg.raised', fgHex: '#0D6B43', bgHex: '#FFFFFF', doc: 6.56, min: 3, usage: "Halo de parole 2 px autour de l avatar" },
  { theme: 'light', fg: 'state.speaking', bg: 'bg.overlay', fgHex: '#0D6B43', bgHex: '#FFFFFF', doc: 6.56, min: 3, usage: "Halo de parole dans l overlay" },
  { theme: 'light', fg: 'accent.default', bg: 'bg.canvas', fgHex: '#1B62D6', bgHex: '#F4F6F9', doc: 5.15, min: 3, usage: "Bouton primaire (aplat) sur fond de fenêtre" },
  { theme: 'light', fg: 'accent.default', bg: 'bg.surface', fgHex: '#1B62D6', bgHex: '#FFFFFF', doc: 5.58, min: 3, usage: "Bouton primaire (aplat) sur panneau" },
  { theme: 'dark', fg: 'state.deaf', bg: 'bg.surface', doc: null, min: 4.5, usage: "Sourdine — pictogramme sur panneau" },
  { theme: 'dark', fg: 'state.deaf', bg: 'bg.raised', doc: null, min: 4.5, usage: "Sourdine — pictogramme sur tuile" },
  { theme: 'dark', fg: 'state.deaf', bg: 'state.deafSubtle', doc: null, min: 4.5, usage: "Sourdine — pictogramme sur sa pastille" },
  { theme: 'dark', fg: 'state.reconnect', bg: 'bg.surface', doc: null, min: 4.5, usage: "Reconnexion — texte + pastille" },
  { theme: 'dark', fg: 'state.reconnect', bg: 'state.reconnectSubtle', doc: null, min: 4.5, usage: "Reconnexion — bandeau ambre" },
  { theme: 'dark', fg: 'state.offline', bg: 'bg.surface', doc: null, min: 4.5, usage: "Pair parti — texte grisé" },
  { theme: 'light', fg: 'state.deaf', bg: 'bg.surface', doc: null, min: 4.5, usage: "Sourdine — pictogramme sur panneau" },
  { theme: 'light', fg: 'state.deaf', bg: 'bg.raised', doc: null, min: 4.5, usage: "Sourdine — pictogramme sur tuile" },
  { theme: 'light', fg: 'state.deaf', bg: 'state.deafSubtle', doc: null, min: 4.5, usage: "Sourdine — pictogramme sur sa pastille" },
  { theme: 'light', fg: 'state.reconnect', bg: 'bg.surface', doc: null, min: 4.5, usage: "Reconnexion — texte + pastille" },
  { theme: 'light', fg: 'state.reconnect', bg: 'state.reconnectSubtle', doc: null, min: 4.5, usage: "Reconnexion — bandeau ambre" },
  { theme: 'light', fg: 'state.offline', bg: 'bg.surface', doc: null, min: 4.5, usage: "Pair parti — texte grisé" },
];

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const h = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error('couleur invalide : ' + hex);
  return 0.2126 * channel(parseInt(h.slice(0, 2), 16)) + 0.7152 * channel(parseInt(h.slice(2, 4), 16)) + 0.0722 * channel(parseInt(h.slice(4, 6), 16));
}
function ratio(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function resolve(theme, path) {
  let node = tokens.color.theme[theme];
  for (const part of path.split('.')) {
    if (node === undefined) return undefined;
    node = node[part];
  }
  return node;
}

const failures = [];
let checked = 0;

for (const pair of PAIRS) {
  const fgHex = resolve(pair.theme, pair.fg);
  const bgHex = resolve(pair.theme, pair.bg);
  if (!fgHex || !bgHex) {
    failures.push(`  ${pair.theme} ${pair.fg} / ${pair.bg} — jeton absent de tokens.json`);
    continue;
  }
  if (pair.fgHex && fgHex.toUpperCase() !== pair.fgHex) {
    failures.push(`  ${pair.theme} ${pair.fg} — tokens.json=${fgHex} attendu=${pair.fgHex} (palette divergente)`);
  }
  if (pair.bgHex && bgHex.toUpperCase() !== pair.bgHex) {
    failures.push(`  ${pair.theme} ${pair.bg} — tokens.json=${bgHex} attendu=${pair.bgHex} (palette divergente)`);
  }
  const r = ratio(fgHex, bgHex);
  checked += 1;
  if (r + 1e-9 < pair.min) {
    failures.push(`  ${pair.theme} ${pair.fg} sur ${pair.bg} = ${r.toFixed(2)}:1 < ${pair.min}:1 — ${pair.usage}`);
  }
  if (pair.doc !== null && Math.abs(r - pair.doc) > 0.02) {
    failures.push(`  ${pair.theme} ${pair.fg} sur ${pair.bg} = ${r.toFixed(2)}:1, SPEC-002 §2.2 annonce ${pair.doc}:1`);
  }
}

const byTheme = { dark: 0, light: 0 };
for (const p of PAIRS) byTheme[p.theme] += 1;
function minOf(threshold) {
  return PAIRS.filter((p) => p.min === threshold).reduce((acc, p) => {
    const r = ratio(resolve(p.theme, p.fg) || '#000000', resolve(p.theme, p.bg) || '#FFFFFF');
    return r < acc.r ? { r, id: p.theme + ' ' + p.fg + '/' + p.bg } : acc;
  }, { r: Infinity, id: '' });
}
const minText = minOf(4.5);
const minUi = minOf(3);
const textPairs = PAIRS.filter((p) => p.min === 4.5).length;
const uiPairs = PAIRS.filter((p) => p.min === 3).length;

console.log(`CONTRAST pairs=${PAIRS.length} (dark=${byTheme.dark} light=${byTheme.light}) text=${textPairs} nonText=${uiPairs} checked=${checked}`);
console.log(`CONTRAST minText=${minText.r.toFixed(2)}:1 (${minText.id}) seuil 4.5:1`);
console.log(`CONTRAST minNonText=${minUi.r.toFixed(2)}:1 (${minUi.id}) seuil 3:1`);
if (failures.length) {
  console.log('CONTRAST failures=' + failures.length);
  for (const f of failures) console.log(f);
}
const pass = failures.length === 0 && checked === PAIRS.length;
console.log(`CONTRAST RESULT=${pass ? 'PASS' : 'FAIL'}`);
process.exit(pass ? 0 : 1);
