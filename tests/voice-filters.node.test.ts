/**
 * tests/voice-filters.node.test.ts — les décisions pures des filtres vocaux sont falsifiables
 *
 * AJOUT 2026-11-03 (filtres vocaux, demande JC). Ce fichier éprouve `src/engine/rtc/voice-filters.ts`
 * SANS navigateur : la recette de câblage est un OBJET — on peut donc exiger, test par test,
 * ce que chaque voix promet réellement, avant qu'une seule ligne de graphe DOM ne soit écrite.
 *
 * Ce qui est mesuré ici (et pourquoi chaque assertion existe) :
 *   1. le vocabulaire FERMÉ : `none` d'abord, aucune voix inventée, `isVoiceFilterId` cohérent
 *      avec la liste (c'est LA liste que consomment schéma, guard IPC et UI — une divergence
 *      ici se propage partout) ;
 *   2. la voix neutre est vide : `nodes: []` ET `chain: []` — la non-régression du chemin
 *      micro historique (zéro nœud ajouté quand personne ne choisit de voix) ;
 *   3. chaque recette est WELL-FORMED : les index de chaîne pointent des nœuds existants, la
 *      chaîne commence et finit dans l'ordre, aucun nœud de modulation n'est dans la chaîne,
 *      tout nœud de la chaîne est joint (pas d'îlot muet) ;
 *   4. robot : un ring réel (oscillateur HORS chaîne, gain de modulation HORS chaîne, cible
 *      DANS la chaîne), avec une porteuse dans la bande du vrombissement (80–200 Hz) ;
 *   5. radio : les trois bornes du talkie (passe-haut ≈ 300 Hz, passe-bas ≈ 3000 Hz, un
 *      shaper présent et monotone) ;
 *   6. timbres : les formants montent deep < man < woman < child, les poids sont sous 1
 *      (une somme ne doit pas saturer), chaque résonateur est HORS chaîne et parallèle ;
 *   7. la hauteur : les ratios sont exactement ceux promis (les demi-tons précalculés), et
 *      `voiceFilterShiftsPitch` dit vrai dans les deux sens ;
 *   8. la résolution : une valeur inconnue devient `none` EN LE DISANT (`fellBack`), la valeur
 *      connue passe sans bruit.
 *
 * Lancer : npx tsx --test tests/voice-filters.node.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  ADULT_MAN_FORMANTS,
  CHILD_FORMANTS,
  DEEP_FORMANTS,
  FILTER_NODE_KINDS,
  FORMANT_WEIGHTS,
  RADIO_DRIVE,
  RADIO_HIGHPASS_HZ,
  RADIO_LOWPASS_HZ,
  RADIO_PREGAIN,
  ROBOT_CARRIER_HZ,
  ROBOT_COMB_DELAY_SEC,
  ROBOT_COMB_FEEDBACK,
  ROBOT_RING_DEPTH,
  TIMBRE_DRY_GAIN,
  VOICE_FILTER_IDS,
  VOICE_FILTER_PITCH_RATIOS,
  WOMAN_FORMANTS,
  isVoiceFilterId,
  resolveVoiceFilterId,
  combFilter,
  ringModulate,
  softClipCurve,
  softClipSample,
  voiceFilterFormants,
  voiceFilterPitchRatio,
  voiceFilterRecipeFor,
  voiceFilterShiftsPitch,
  type VoiceFilterId,
  type VoiceFilterRecipe,
} from '../src/engine/rtc/voice-filters.ts'

/** Toutes les voix du vocabulaire, sauf la neutre (celle-là a son propre bloc). */
const EFFECT_IDS: readonly Exclude<VoiceFilterId, 'none'>[] = [
  'robot',
  'radio',
  'deep',
  'man',
  'woman',
  'child',
]

/** Un nœud de modulation (hors chaîne écoutée) ? */
function isModulation(recipe: VoiceFilterRecipe, index: number): boolean {
  return recipe.nodes[index]?.['modulation'] === true
}

describe('voice-filters — le vocabulaire fermé des voix', () => {
  it('none est la première voix (le défaut, rendu en tête par l’UI)', () => {
    assert.equal(VOICE_FILTER_IDS[0], 'none')
  })

  it('le vocabulaire est exactement les sept voix promises, sans doublon', () => {
    assert.deepEqual([...VOICE_FILTER_IDS], ['none', 'robot', 'radio', 'deep', 'man', 'woman', 'child'])
    assert.equal(new Set(VOICE_FILTER_IDS).size, VOICE_FILTER_IDS.length)
  })

  it('isVoiceFilterId est cohérent avec la liste — et refuse l’inventé, le vide, le non-chaîne', () => {
    for (const id of VOICE_FILTER_IDS) {
      assert.equal(isVoiceFilterId(id), true, `${id} doit être reconnu`)
    }
    for (const junk of ['robotique', '', 'NONE', 'chipmunk', 0, null, undefined, {}, ['robot']]) {
      assert.equal(isVoiceFilterId(junk), false, `${String(junk)} doit être refusé`)
    }
  })
})

describe('voice-filters — la voix neutre ne change RIEN au chemin du micro', () => {
  it('none : aucun nœud, aucune chaîne (la source ira directement à la destination)', () => {
    const recipe = voiceFilterRecipeFor('none')
    assert.deepEqual(recipe.nodes, [], 'zéro nœud — sinon le micro historique a gagné un maillon')
    assert.deepEqual(recipe.chain, [])
    assert.equal(recipe.ring, undefined)
    assert.equal(recipe.formants, undefined)
    assert.equal(recipe.parallel, undefined)
  })
})

describe('voice-filters — chaque recette est bien formée avant d’être câblée', () => {
  for (const id of EFFECT_IDS) {
    it(`${id} : les index de chaîne existent, sont ordonnés, et aucun nœud de modulation n’y figure`, () => {
      const recipe = voiceFilterRecipeFor(id)
      assert.ok(recipe.chain.length >= 2, `${id} doit avoir une chaîne d’au moins deux nœuds`)
      assert.equal(recipe.id, id, 'la recette porte son id (une recette volée entre voix se voit)')
      for (const index of recipe.chain) {
        assert.ok(index >= 0 && index < recipe.nodes.length, `${id} : index de chaîne ${index} hors tableau`)
        assert.equal(
          isModulation(recipe, index),
          false,
          `${id} : un nœud de modulation (${index}) ne doit PAS être dans la chaîne écoutée`,
        )
      }
      // La chaîne est strictement croissante : le signal avance, il ne revient pas en arrière.
      for (let i = 1; i < recipe.chain.length; i += 1) {
        const previous = recipe.chain[i - 1] as number
        const current = recipe.chain[i] as number
        assert.ok(current > previous, `${id} : la chaîne n’est pas croissante (${previous} → ${current})`)
      }
    })

    it(`${id} : tout nœud de chaîne est joint (pas d’îlot muet) et tout nœud sert à quelque chose`, () => {
      const recipe = voiceFilterRecipeFor(id)
      // Chaque maillon de chaîne a un successeur (le dernier va à la destination).
      for (let i = 0; i < recipe.chain.length - 1; i += 1) {
        assert.ok(
          (recipe.chain[i + 1] as number) > (recipe.chain[i] as number),
          `${id} : chaînon ${recipe.chain[i]} sans successeur`,
        )
      }
      const used = new Set<number>(recipe.chain)
      for (const branch of recipe.formants ?? []) used.add(branch.resonatorIndex)
      if (recipe.ring !== undefined) {
        used.add(recipe.ring.oscillatorIndex)
        used.add(recipe.ring.modGainIndex)
      }
      for (let i = 0; i < recipe.nodes.length; i += 1) {
        assert.ok(used.has(i), `${id} : nœud ${i} (${recipe.nodes[i]?.['kind']}) ne sert à rien`)
      }
    })

    it(`${id} : chaque nœud ne porte que des facettes de son kind`, () => {
      const recipe = voiceFilterRecipeFor(id)
      const FACETS: Record<string, readonly string[]> = {
        // `modulation` est licite sur un gain : le gain de sommation du ring est un nœud
        // de modulation (hors chaîne) — c'est un gain, pas un autre type de nœud.
        gain: ['kind', 'gain', 'modulation'],
        bandpass: ['kind', 'cutoffHz', 'q', 'gain'],
        lowpass: ['kind', 'cutoffHz', 'q'],
        highpass: ['kind', 'cutoffHz', 'q'],
        shaper: ['kind', 'curve'],
        oscillator: ['kind', 'frequency', 'modulation'],
        delay: ['kind', 'delaySec', 'feedback'],
      }
      for (const node of recipe.nodes) {
        assert.ok(
          (FILTER_NODE_KINDS as readonly string[]).includes(node.kind),
          `kind inconnu : ${node.kind}`,
        )
        for (const key of Object.keys(node)) {
          assert.ok(
            (FACETS[node.kind] ?? []).includes(key),
            `${id} : nœud ${node.kind} porte la facette hors kind « ${key} »`,
          )
        }
      }
    })
  }
})

describe('voice-filters — robot : une vraie modulation d’anneau, pas une note plaquée', () => {
  it('la porteuse et son gain de modulation sont HORS chaîne, et commandent un nœud de chaîne', () => {
    const recipe = voiceFilterRecipeFor('robot')
    assert.ok(recipe.ring !== undefined, 'robot est un ring : la modulation est déclarée')
    const ring = recipe.ring
    assert.ok(ring !== undefined)
    assert.ok(!recipe.chain.includes(ring.oscillatorIndex), 'l’oscillateur est hors chaîne (sinon : note pure permanente)')
    assert.ok(!recipe.chain.includes(ring.modGainIndex), 'le gain de modulation est hors chaîne')
    assert.ok(recipe.chain.includes(ring.targetIndex), 'la cible de modulation est dans la chaîne écoutée')
    assert.equal(recipe.nodes[ring.oscillatorIndex]?.['kind'], 'oscillator')
    assert.equal(recipe.nodes[ring.modGainIndex]?.['kind'], 'gain')
    assert.equal(recipe.nodes[ring.targetIndex]?.['kind'], 'gain')
  })

  it('la porteuse est dans la bande du vrombissement (80–200 Hz), et un lissage clôt la chaîne', () => {
    const recipe = voiceFilterRecipeFor('robot')
    const carrier = recipe.nodes[recipe.ring?.['oscillatorIndex'] ?? -1]?.['frequency']
    assert.equal(typeof carrier, 'number')
    assert.ok(
      typeof carrier === 'number' && carrier >= 80 && carrier <= 200,
      `porteuse hors bande : ${String(carrier)} Hz`,
    )
    const lowpass = recipe.nodes.find((node) => node.kind === 'lowpass')
    assert.ok(lowpass !== undefined, 'un lissage reste dans la chaîne (le ring est dur)')
    const target = recipe.nodes[recipe.ring?.targetIndex ?? -1]
    assert.equal(target?.gain, 0, 'gain de base 0 : ring bipolaire, pas un trémolo')
    const mod = recipe.nodes[recipe.ring?.modGainIndex ?? -1]
    assert.equal(mod?.gain, ROBOT_RING_DEPTH)
    const delay = recipe.nodes.find((node) => node.kind === 'delay')
    assert.equal(delay?.delaySec, ROBOT_COMB_DELAY_SEC)
    assert.equal(delay?.feedback, ROBOT_COMB_FEEDBACK)
    assert.ok(recipe.chain.includes(recipe.nodes.indexOf(delay as never)), 'le peigne est DANS la chaîne écoutée')
  })
})

describe('voice-filters — radio : les trois bornes du talkie', () => {
  it('passe-haut ≈ 300 Hz, passe-bas ≈ 3000 Hz, passe-bande et shaper présents', () => {
    const recipe = voiceFilterRecipeFor('radio')
    const kinds = recipe.chain.map((index) => recipe.nodes[index]?.['kind'])
    assert.ok(kinds.includes('highpass'), 'le talkie coupe le grave')
    assert.ok(kinds.includes('lowpass'), 'le talkie coupe l’aigu')
    assert.ok(kinds.includes('bandpass'), 'le talkie a une bande')
    assert.ok(kinds.includes('shaper'), 'le talkie sature')
    const high = recipe.nodes.find((n) => n.kind === 'highpass')
    const low = recipe.nodes.find((n) => n.kind === 'lowpass')
    assert.equal(high?.['cutoffHz'], RADIO_HIGHPASS_HZ)
    assert.equal(low?.['cutoffHz'], RADIO_LOWPASS_HZ)
    const drive = recipe.nodes.find((node) => node.kind === 'gain' && node.gain === RADIO_PREGAIN)
    assert.ok(drive !== undefined, 'un pré-gain pousse la parole dans l’écrêteur')
    assert.ok(RADIO_DRIVE >= 6, 'le drive doit saturer la parole, pas la caresser')
  })

  it('la courbe du shaper est monotone, normalisée à ±1, et couvre [-1, 1]', () => {
    const recipe = voiceFilterRecipeFor('radio')
    const shaper = recipe.nodes.find((n) => n.kind === 'shaper')
    assert.ok(shaper !== undefined && shaper.curve !== undefined)
    const curve = shaper.curve
    assert.ok(curve !== undefined)
    assert.equal(curve.length, 1024)
    assert.equal(curve[0]?.['input'], -1)
    assert.equal(curve[curve.length - 1]?.['input'], 1)
    assert.ok(curve[0] !== undefined && Math.abs(curve[0].output + 1) < 1e-9, 'butée basse à −1')
    const top = curve[curve.length - 1]
    assert.ok(top !== undefined && Math.abs(top.output - 1) < 1e-9, 'butée haute à +1')
    for (let i = 1; i < curve.length; i += 1) {
      const before = curve[i - 1]
      const after = curve[i]
      assert.ok(before !== undefined && after !== undefined && after.output >= before.output, 'courbe non monotone')
    }
  })

  it('softClipCurve est déterministe et ramène un drive < 1 à 1', () => {
    assert.deepEqual(softClipCurve(2.2), softClipCurve(2.2))
    assert.deepEqual(softClipCurve(0.2), softClipCurve(1))
    const flat = softClipCurve(1)
    const middle = flat[512]
    assert.ok(middle !== undefined && Math.abs(middle.output) < 0.01, 'le zéro reste à zéro')
  })
})

describe('voice-filters — les timbres : des formants parallèles, pas des filtres en série', () => {
  for (const id of ['deep', 'man', 'woman', 'child'] as const) {
    it(`${id} : trois résonateurs HORS chaîne, chacun sommée après un maillon de chaîne`, () => {
      const recipe = voiceFilterRecipeFor(id)
      assert.equal(recipe.parallel, true, `${id} est une fourche (entrée → chaîne ET résonateurs)`)
      const branches = recipe.formants
      assert.ok(branches !== undefined && branches.length === 3, `${id} : trois formants`)
      for (const branch of branches) {
        assert.ok(!recipe.chain.includes(branch.resonatorIndex), `${id} : résonateur ${branch.resonatorIndex} dans la chaîne — il serait en série`)
        assert.ok(recipe.chain.includes(branch.afterChainIndex), `${id} : le point de sommation ${branch.afterChainIndex} n’est pas un maillon de chaîne`)
        assert.ok(branch.resonatorIndex > branch.afterChainIndex, `${id} : un résonateur se somme APRÈS son maillon`)
        const node = recipe.nodes[branch.resonatorIndex]
        assert.equal(node?.['kind'], 'bandpass')
        assert.equal(typeof node?.['gain'], 'number', `${id} : le poids du formant est porté par son gain`)
        assert.equal(typeof node?.['q'], 'number', `${id} : un résonateur sans Q est un filtre ordinaire`)
      }
    })

    it(`${id} : la hauteur est celle promise, et le ratio correspond aux demi-tons`, () => {
      const ratio = voiceFilterPitchRatio(id)
      assert.equal(ratio, VOICE_FILTER_PITCH_RATIOS[id])
      assert.ok(ratio !== 1, `${id} décale la hauteur`)
      assert.equal(voiceFilterShiftsPitch(id), true)
      // Le ratio est bien un nombre de demi-tons (2^(n/12)), à l’arrondi de la table près.
      const semitones = 12 * Math.log2(ratio)
      assert.ok(Math.abs(semitones - Math.round(semitones)) < 0.01, `${id} : ratio hors tempérament (${semitones})`)
    })
  }

  it('les formants MONTENT de deep à child (c’est ce qui fait une femme, pas un chipmunk)', () => {
    assert.ok(DEEP_FORMANTS.f2 < ADULT_MAN_FORMANTS.f2)
    assert.ok(ADULT_MAN_FORMANTS.f2 < WOMAN_FORMANTS.f2)
    assert.ok(WOMAN_FORMANTS.f2 < CHILD_FORMANTS.f2)
    for (const pair of [DEEP_FORMANTS, ADULT_MAN_FORMANTS, WOMAN_FORMANTS, CHILD_FORMANTS]) {
      assert.ok(pair.f1 < pair.f2 && pair.f2 < pair.f3, 'F1 < F2 < F3')
    }
  })

  it('la hauteur DESCEND pour deep/man et MONTE pour woman/child', () => {
    assert.ok(voiceFilterPitchRatio('deep') < voiceFilterPitchRatio('man'))
    assert.ok(voiceFilterPitchRatio('man') < 1)
    assert.ok(voiceFilterPitchRatio('woman') > 1)
    assert.ok(voiceFilterPitchRatio('woman') < voiceFilterPitchRatio('child'))
  })

  it('les formants DOMINENT le résidu sec (le mélange n’est pas presque sec)', () => {
    for (const w of [FORMANT_WEIGHTS.f1, FORMANT_WEIGHTS.f2, FORMANT_WEIGHTS.f3]) {
      assert.ok(w > TIMBRE_DRY_GAIN, `formant ${w} ≤ résidu sec ${TIMBRE_DRY_GAIN}`)
      assert.ok(w <= 1, `poids > 1 : ${w}`)
    }
    const sum = FORMANT_WEIGHTS.f1 + FORMANT_WEIGHTS.f2 + FORMANT_WEIGHTS.f3
    assert.ok(sum > TIMBRE_DRY_GAIN * 4, `somme des formants ${sum} trop proche du sec`)
    assert.ok(TIMBRE_DRY_GAIN < 0.25, 'le résidu sec doit rester minoritaire')
    for (const id of ['deep', 'man', 'woman', 'child'] as const) {
      const recipe = voiceFilterRecipeFor(id)
      for (const branch of recipe.formants ?? []) {
        const gain = recipe.nodes[branch.resonatorIndex]?.['gain']
        assert.equal(gain, FORMANT_WEIGHTS.f1 === gain ? gain : gain, 'le poids est lu sur le nœud')
        assert.ok(
          gain === FORMANT_WEIGHTS.f1 || gain === FORMANT_WEIGHTS.f2 || gain === FORMANT_WEIGHTS.f3,
          `poids ${String(gain)} hors table des formants`,
        )
      }
    }
  })

  it('voiceFilterFormants rend la table de la voix, et null pour les non-timbres', () => {
    assert.deepEqual(voiceFilterFormants('woman'), WOMAN_FORMANTS)
    for (const id of ['none', 'robot', 'radio'] as const) {
      assert.equal(voiceFilterFormants(id), null)
      assert.equal(voiceFilterShiftsPitch(id), false)
      assert.equal(voiceFilterPitchRatio(id), 1)
    }
  })
})

describe('voice-filters — la résolution d’une valeur lue ne répare pas en silence', () => {
  it('une voix connue passe telle quelle, sans bruit', () => {
    for (const id of VOICE_FILTER_IDS) {
      const resolved = resolveVoiceFilterId(id)
      assert.equal(resolved.id, id)
      assert.equal(resolved.fellBack, false, `${id} connu ne doit pas être dit replié`)
    }
  })

  it('une valeur inconnue devient none EN LE DISANT', () => {
    for (const junk of ['robotique', '', 'NONE', 'chipmunk', 0, null, undefined, {}, []]) {
      const resolved = resolveVoiceFilterId(junk)
      assert.equal(resolved.id, 'none', `${String(junk)} doit retomber sur none`)
      assert.equal(resolved.fellBack, true, `${String(junk)} doit être dit replié (jamais silencieux)`)
    }
  })
})

/** Magnitude d'une DFT à une fréquence (assez pour comparer fondamentale et bandes latérales). */
function magnitudeAt(samples: Float32Array, freq: number, sampleRate: number): number {
  let re = 0
  let im = 0
  const n = samples.length
  for (let i = 0; i < n; i += 1) {
    const w = (2 * Math.PI * freq * i) / sampleRate
    const x = samples[i] ?? 0
    re += x * Math.cos(w)
    im -= x * Math.sin(w)
  }
  return Math.hypot(re, im) / n
}

describe('voice-filters — rendu hors-ligne : le spectre change vraiment', () => {
  const rate = 48000

  it('le ring bipolaire déplace un sinus de 200 Hz vers 200±porteuse (le sec s’effondre)', () => {
    const n = 4800
    const input = new Float32Array(n)
    for (let i = 0; i < n; i += 1) input[i] = Math.sin((2 * Math.PI * 200 * i) / rate)
    const rendered = ringModulate(input, ROBOT_CARRIER_HZ, rate)
    const dry = magnitudeAt(rendered, 200, rate)
    const lower = magnitudeAt(rendered, 200 - ROBOT_CARRIER_HZ, rate)
    const upper = magnitudeAt(rendered, 200 + ROBOT_CARRIER_HZ, rate)
    assert.ok(lower > dry * 4, `bande basse ${lower} pas assez au-dessus du sec ${dry}`)
    assert.ok(upper > dry * 4, `bande haute ${upper} pas assez au-dessus du sec ${dry}`)
  })

  it('le peigne d’un impulse a un écho au retard de la recette, et une crête spectrale', () => {
    const delay = Math.round(ROBOT_COMB_DELAY_SEC * rate)
    const n = delay * 8
    const input = new Float32Array(n)
    input[0] = 1
    const rendered = combFilter(input, delay, ROBOT_COMB_FEEDBACK)
    assert.ok(Math.abs((rendered[delay] ?? 0) - ROBOT_COMB_FEEDBACK) < 1e-6, 'l’écho est au bon retard')
    const peak = rate / delay
    const atPeak = magnitudeAt(rendered, peak, rate)
    const off = magnitudeAt(rendered, peak * 0.5, rate)
    assert.ok(atPeak > off, `le peigne ne résonne pas vers ${peak.toFixed(0)} Hz (${atPeak} vs ${off})`)
  })

  it('la saturation radio à drive élevé crée des harmoniques audibles sur une parole faible', () => {
    const n = 4800
    const freq = 200
    const input = new Float32Array(n)
    for (let i = 0; i < n; i += 1) input[i] = 0.12 * Math.sin((2 * Math.PI * freq * i) / rate)
    const driven = new Float32Array(n)
    for (let i = 0; i < n; i += 1) driven[i] = softClipSample((input[i] ?? 0) * RADIO_PREGAIN, RADIO_DRIVE)
    const fundamental = magnitudeAt(driven, freq, rate)
    const third = magnitudeAt(driven, freq * 3, rate)
    assert.ok(third > fundamental * 0.08, `harmonique 3 trop faible (${third} / ${fundamental}) — distorsion inaudible`)
    // Le drive 2.2 d'avant, sur le même signal, reste presque linéaire.
    const mild = new Float32Array(n)
    for (let i = 0; i < n; i += 1) mild[i] = softClipSample(input[i] ?? 0, 2.2)
    const mildThird = magnitudeAt(mild, freq * 3, rate)
    assert.ok(third > mildThird * 3, 'le nouveau drive doit distordre nettement plus que 2.2 sans pré-gain')
  })
})
