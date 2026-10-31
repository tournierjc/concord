// a16-renders.js — ACo-16 (SPEC-015 rév. 6 §5.2) : compte des RENDUS de l'overlay, pas des messages.
// Préparé, NON lancé : nécessite une fenêtre Electron réelle (l'overlay doit être monté) — voir
// VERIF-024 rév. 3, étape 7c. Usage prévu (dans le renderer, après montage) :
//   const n = await window.__aco16.count(3000);
//   n.rendus_overlay, n.rendus_test, n.mutations[], n.parSeconde
// Règle d'attribution : un rendu provoqué par le test lui-même se compte à part (rendus_test),
// jamais noyé dans rendus_overlay.
(function () {
  'use strict';

  function classify(rec, t0) {
    // écriture d'attribut data-* sur une vignette, ou ajout/retrait de vignette
    if (rec.type === 'attributes') {
      const name = rec.attributeName || '';
      if (name.indexOf('data-') === 0) return 'attribut';
      return null;
    }
    if (rec.type === 'childList') return 'vignette';
    return null;
  }

  async function count(durationMs) {
    const cible = document.querySelector('[data-overlay-vignettes], .overlay-grid, #overlay');
    if (!cible) return { erreur: 'conteneur de vignettes introuvable — ACo-16 non mesurable' };
    const t0 = performance.now();
    const rendus = [];
    const obs = new MutationObserver(function (recs) {
      for (const r of recs) {
        const k = classify(r, t0);
        if (!k) continue;
        const t = performance.now() - t0;
        const test = boolean(window.__acoTestRender); // posé par le test autour de son propre rendu
        rendus.push({ t_ms: Math.round(t), type: k, cible: (r.target && r.target.className) || null, test: test });
      }
    });
    obs.observe(cible, { attributes: true, attributeFilter: null, childList: true, subtree: true });
    await new Promise(function (res) { setTimeout(res, durationMs); });
    obs.disconnect();
    const test_n = rendus.filter(function (r) { return r.test; }).length;
    const seaux = {};
    for (const r of rendus) { const s = Math.floor(r.t_ms / 1000); seaux[s] = (seaux[s] || 0) + 1; }
    return {
      duree_ms: durationMs,
      rendus_overlay: rendus.length - test_n,
      rendus_test: test_n,
      par_seconde: seaux,
      mutations: rendus
    };
  }

  window.__aco16 = { count: count, version: 'rev6-1' };
})();
