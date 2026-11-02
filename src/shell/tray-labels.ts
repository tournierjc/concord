/**
 * tray-labels.ts — libellés du menu de l'icône de la barre des tâches (0.4.2).
 *
 * Le process principal ne peut pas lire `design/i18n.json` : ce fichier est hors du `rootDir` de
 * `tsconfig.main.json` (l'import JSON du renderer passe par Vite, pas par tsc). Ces deux libellés
 * vivent donc ici, choisis sur la locale des réglages — ils n'appartiennent PAS au catalogue
 * renderer (le garde « clé morte » ne les voit pas, et ne doit pas les voir).
 */

export function trayLabels(locale: 'fr' | 'en'): { show: string; quit: string } {
  return locale === 'en'
    ? { show: 'Open Concord', quit: 'Quit Concord' }
    : { show: 'Ouvrir Concord', quit: 'Quitter Concord' };
}
