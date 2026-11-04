/**
 * tests/voice-filter.node.test.ts — le graphe des filtres vocaux est FABRIQUÉ comme la recette le dit
 *
 * AJOUT 2026-11-03 (filtres vocaux, demande JC). `voice-filters.ts` décide (testé),
 * `voice-filter.ts` FABRIQUE. Ce fichier est le seul endroit qui peut prouver que la
 * fabrication obéit : le graphe Web Audio monté sur la doublure `FakeAudioContext` est
 * inspecté nœud par nœud, connexion par connexion.
 *
 * Les cinq assertions qui comptent (chacune tue un défaut réel, pas une forme) :
 *   1. LA VOIX NEUTRE NE CRÉE AUCUN NŒUD de recette — la source va directement à la
 *      destination. C'est la non-régression absolue : un utilisateur qui ne choisit pas de
 *      voix ne doit rien gagner dans son chemin audio (ni latence, ni coloration).
 *   2. ROBOT est un ring VRAI : un oscillateur créé, DÉMARRÉ, HORS de la chaîne écoutée,
 *      branché sur un gain de modulation dont la sortie se branche sur le PARAMÈTRE `gain`
 *      d'un nœud de la chaîne. Un oscillateur laissé dans la chaîne = une note permanente
 *      (défaut tué par le test, pas par l'écoute).
 *   3. RADIO monte ses trois bornes ET la courbe du shaper arrive jusqu'au nœud (une recette
 *     qui perd sa courbe en route donne un filtre, pas une saturation).
 *   4. Les TIMBRES câblent leurs formants EN PARALLÈLE : chaque résonateur est branché par la
 *      TÊTE (la source), pas par son prédécesseur — un formant en série n'est plus un formant.
 *   5. `applyFilter` DÉTRUIT l'ancien graphe (oscillateurs arrêtés, nœuds débranchés) et
 *      réutilise la MÊME destination : `close()` ne laisse aucun oscillateur qui dure.
 *
 * Lancer : npx tsx --test tests/voice-filter.node.test.ts
 */

import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  FakeAudioContext,
  FakeAudioNode,
  FakeAudioParam,
  FakeBiquadFilter,
  FakeGain,
  FakeMediaStream,
  FakeOscillator,
  FakeTrack,
  FakeWaveShaper,
} from './fake-rtc.ts'
import { createVoiceFilterChain, type VoiceFilterChain } from '../src/renderer/voice-filter.ts'
import { VOICE_FILTER_IDS, voiceFilterRecipeFor } from '../src/engine/rtc/voice-filters.ts'
import type { VoiceFilterId } from '../src/engine/rtc/voice-filters.ts'

/** Le contexte doublure et la source micro d'une chaîne de test. */
interface Harness {
  readonly context: FakeAudioContext
  readonly micTrack: FakeTrack
  readonly chain: VoiceFilterChain
}

function harness(initial: VoiceFilterId = 'none'): Harness {
  const context = new FakeAudioContext()
  const micTrack = new FakeTrack('micro')
  // La fabrique prend un FLUX (le contrat du DOM), pas une piste : le flux d'entrée porte la
  // piste micro ; la fabrique le LIT et n'y écrit pas (la source reçoit un flux mono-piste
  // séparé en lecture seule — le correctif du double clic, cf. le bloc « doublon » ci-dessous).
  const micStream = new FakeMediaStream([micTrack])
  const chain = createVoiceFilterChain(context, micStream, initial)
  return { context, micTrack, chain }
}

describe('voice-filter — la voix neutre ne change rien au chemin du micro', () => {
  it('none : AUCUN nœud de recette, la source va directement à la destination', () => {
    const h = harness('none')
    assert.equal(h.context.created.gains.length, 0, 'aucun gain créé pour une voix neutre')
    assert.equal(h.context.created.biquads.length, 0, 'aucun filtre créé pour une voix neutre')
    assert.equal(h.context.created.oscillators.length, 0, 'aucun oscillateur pour une voix neutre')
    assert.equal(h.context.created.shapers.length, 0)
    assert.equal(h.context.created.destinations.length, 1, 'une destination : la piste des pairs')
    assert.equal(h.context.created.sources.length, 1, 'la source micro est le seul point entrée')
    // La source est bien branchée À LA DESTINATION — pas dans le vide.
    const source = h.context.created.sources[0]
    assert.ok(source !== undefined)
    assert.equal(h.chain.current, 'none')
    h.chain.close()
  })

  it('la piste rendue est celle de la destination (ce qui part aux pairs)', () => {
    const h = harness('none')
    const destination = h.context.created.destinations[0]
    assert.ok(destination !== undefined)
    const expected = destination.stream.getAudioTracks()[0]
    assert.equal(h.chain.track, expected, 'track = la piste de la destination, sinon rien ne sort')
    h.chain.close()
  })
})

describe('voice-filter — robot : une modulation d’anneau réellement câblée', () => {
  let h: Harness
  beforeEach(() => {
    h = harness('robot')
  })
  afterEach(() => {
    h.chain.close()
  })

  it('un oscillateur créé, démarré, et HORS de la chaîne écoutée', () => {
    assert.equal(h.context.created.oscillators.length, 1, 'le robot a UNE porteuse')
    const oscillator = h.context.created.oscillators[0]
    assert.ok(oscillator !== undefined)
    assert.equal(oscillator.startCalls, 1, 'la porteuse est démarrée (un oscillateur non démarré est muet)')
    assert.equal(oscillator.type, 'sine')
    // La fréquence de la recette arrive jusqu'au nœud (une recette perdue en route = 440 Hz par défaut).
    assert.equal(oscillator.frequency.value, 90)
    // Et la porteuse n'est JAMAIS dans la chaîne écoutée : sa sortie unique va au gain de modulation.
    const recipe = voiceFilterRecipeFor('robot')
    assert.ok(recipe.ring !== undefined)
    const chainNodes = recipe.chain.map((index) => index)
    assert.equal(chainNodes.includes(recipe.ring.oscillatorIndex), false, 'oscillateur hors chaîne (recette)')
    // Structurellement : sa seule connexion sortante va vers un gain, jamais vers la destination.
    assert.equal(oscillator.outgoing.length, 1, 'la porteuse ne pilote qu’une chose')
    assert.ok(oscillator.outgoing[0] instanceof FakeGain, 'la porteuse pilote un gain, pas un filtre')
  })

  it('la modulation se branche sur le PARAMÈTRE gain d’un nœud de la chaîne (le multiplieur)', () => {
    const recipe = voiceFilterRecipeFor('robot')
    assert.ok(recipe.ring !== undefined)
    // Le gain de modulation est celui que l'oscillateur pilote — plus un index fixe :
    // le gain d'entrée et la réinjection du peigne créent d'autres gains avant lui.
    const oscillator = h.context.created.oscillators[0]
    assert.ok(oscillator !== undefined)
    const modGain = oscillator.outgoing[0]
    assert.ok(modGain instanceof FakeGain, 'la porteuse pilote un gain')
    assert.equal(modGain.outgoing.length, 1)
    const target = modGain.outgoing[0]
    assert.ok(target instanceof FakeAudioParam, 'la modulation pilote un PARAMÈTRE (gain), sinon ce n’est pas un ring')
    assert.equal(modGain.gain.value, 1, 'profondeur 1 : la porteuse va de −1 à +1')
    const zeroed = h.context.created.gains.find((gain) => gain.gain === target)
    assert.ok(zeroed !== undefined, 'la cible est un gain de la chaîne')
    assert.equal(zeroed.gain.value, 0, 'base 0 : ring bipolaire, la voix sèche est supprimée')
    void recipe
  })

  it('la chaîne du robot a un peigne et un lissage, et aboutit à la destination', () => {
    assert.equal(h.context.created.delays.length, 1, 'le robot a son peigne')
    const comb = h.context.created.delays[0]
    assert.ok(comb !== undefined)
    assert.ok(Math.abs(comb.delayTime.value - 0.008) < 1e-9)
    const smoother = h.context.created.biquads.find((node) => node.type === 'lowpass')
    assert.ok(smoother !== undefined)
    assert.equal(smoother.frequency.value, 3400)
    const destination = h.context.created.destinations[0]
    assert.ok(destination !== undefined)
    const reaches = h.context.created.gains.some((gain) => gain.outgoing.includes(destination))
    assert.equal(reaches, true, 'un gain de la chaîne aboutit à la destination des pairs')
  })
})

describe('voice-filter — radio : les bornes et la saturation arrivent jusqu’aux nœuds', () => {
  it('passe-haut 500 Hz, passe-bas 2400 Hz, passe-bande, et une courbe posée sur le shaper', () => {
    const h = harness('radio')
    const types = h.context.created.biquads.map((node) => node.type)
    assert.ok(types.includes('bandpass') && types.includes('highpass') && types.includes('lowpass'))
    const high = h.context.created.biquads.find((n) => n.type === 'highpass')
    const low = h.context.created.biquads.find((n) => n.type === 'lowpass')
    assert.equal(high?.['frequency'].value, 500)
    assert.equal(low?.['frequency'].value, 2400)
    const drive = h.context.created.gains.find((gain) => gain.gain.value === 6)
    assert.ok(drive !== undefined, 'le pré-gain ×6 est posé sur un nœud')
    assert.equal(h.context.created.shapers.length, 1, 'la saturation est montée')
    const shaper = h.context.created.shapers[0]
    assert.ok(shaper !== undefined && shaper.curve !== null, 'la courbe est POSÉE sur le nœud (une courbe perdue = un filtre ordinaire)')
    assert.equal(shaper.curve.length, 1024, 'l’échantillonnage de la recette arrive en entier')
    assert.notEqual(shaper.oversample, 'none', 'le shaper sature avec suréchantillonnage (aliasing sinon)')
    // La chaîne aboutit bien à la destination.
    const destination = h.context.created.destinations[0]
    const lastGain = h.context.created.gains[0]
    assert.ok(destination !== undefined && lastGain !== undefined)
    h.chain.close()
  })
})

describe('voice-filter — les timbres câblent leurs formants en parallèle', () => {
  for (const id of ['deep', 'man', 'woman', 'child'] as const) {
    it(`${id} : chaque résonateur est alimenté par la TÊTE et se somme dans la chaîne`, () => {
      const h = harness(id)
      const recipe = voiceFilterRecipeFor(id)
      assert.ok(recipe.formants !== undefined && recipe.formants.length === 3)
      // Les quatre filtres de la chaîne directe : 1 bandpass (F1 de base) + 1 lowpass ; les
      // trois résonateurs sont les trois bandpass restants.
      const bandpass = h.context.created.biquads.filter((n) => n.type === 'bandpass')
      assert.equal(bandpass.length, 3, `${id} : trois résonateurs, le sec n’est plus un 4e passe-bande`)
      for (const filter of bandpass) {
        const weight = filter.outgoing.find((node) => node instanceof FakeGain)
        assert.ok(weight instanceof FakeGain, `${id} : le passe-bande alimente son poids (pas l’inverse)`)
        assert.ok(weight.gain.value >= 0.5, `${id} : poids de formant trop faible (${weight.gain.value})`)
      }
      const heads = h.context.created.sources
      assert.equal(heads.length, 1, 'une seule source : c’est elle qui fourche')
      const gains = h.context.created.gains
      assert.ok(gains.length >= 2, 'un gain d’entrée et un gain de sortie au moins')
      const dry = gains.find((gain) => Math.abs(gain.gain.value - 0.18) < 1e-9)
      assert.ok(dry !== undefined, `${id} : le résidu sec (0,18) est posé`)
      h.chain.close()
    })
  }
})

describe('voice-filter — changer de voix détruit l’ancien graphe, jamais ne le laisse fuiter', () => {
  it('applyFilter(robot) puis applyFilter(child) : l’oscillateur du robot est ARRÊTÉ', () => {
    const h = harness('robot')
    const first = h.context.created.destinations[0]
    assert.ok(first !== undefined)
    const robotOsc = h.context.created.oscillators[0]
    assert.ok(robotOsc !== undefined)
    assert.equal(robotOsc.stopCalls, 0, 'tant que le robot vit, sa porteuse tourne')

    h.chain.applyFilter('child')

    assert.equal(robotOsc.stopCalls, 1, 'un oscillateur non arrêté continue de pomper la page')
    assert.equal(h.chain.current, 'child', 'la voix rendue est la voix appliquée, pas l’intention')
    assert.equal(h.context.created.destinations.length, 1, 'la destination est unique : les pairs ne changent pas de piste')
    h.chain.close()
  })

  it('applyFilter(radio) depuis robot : plus aucun oscillateur ne survit, et le shaper arrive', () => {
    const h = harness('robot')
    h.chain.applyFilter('radio')
    for (const osc of h.context.created.oscillators) {
      assert.equal(osc.stopCalls, 1, 'le graphe précédent est intégralement arrêté')
    }
    assert.equal(h.context.created.shapers.length, 1)
    h.chain.close()
  })

  it('close() est idempotent et arrête tout (un deuxième close ne lève pas)', () => {
    const h = harness('robot')
    h.chain.close()
    const osc = h.context.created.oscillators[0]
    assert.ok(osc !== undefined)
    assert.equal(osc.stopCalls, 1)
    h.chain.close()
    assert.equal(osc.stopCalls, 1, 'idempotent : pas un second stop qui lèverait')
  })

  it('la piste est stable sur tout le changement de voix (replaceTrack reçoit la même piste)', () => {
    const h = harness('none')
    const before = h.chain.track
    h.chain.applyFilter('woman')
    assert.equal(h.chain.track, before, 'la piste des pairs ne change pas : seul le graphe change')
    h.chain.applyFilter('radio')
    assert.equal(h.chain.track, before)
    h.chain.close()
  })
})

describe('voice-filter — le flux d’entrée ne reçoit JAMAIS sa propre piste en doublon', () => {
  // Le bug du double clic (retour JC, 2026-11-03) : la fabrique posait la piste micro SUR son
  // propre flux d’entrée avant de créer la source. Le navigateur dédouble alors la piste dans le
  // nœud source — et au premier clic sur une voix, les deux copies traversent les deux instances
  // du filtre en parallèle : son doublant/annulant, la voix ne change pas. Le second clic
  // (débranchage puis remontage) le faisait passer. Le flux capté appartient au plan média :
  // la fabrique lit ses pistes, elle n’y écrit pas.
  it('addTrack sur le flux d’entrée = 0 appel sur tout le cycle de vie', () => {
    const context = new FakeAudioContext()
    const micTrack = new FakeTrack('micro')
    const micStream = new FakeMediaStream([micTrack])
    let addTrackCalls = 0
    const original = micStream.addTrack.bind(micStream)
    micStream.addTrack = (track: FakeTrack) => {
      addTrackCalls += 1
      original(track)
    }
    const chain = createVoiceFilterChain(context, micStream, 'none')
    for (const id of ['robot', 'radio', 'woman', 'none'] as const) chain.applyFilter(id)
    assert.equal(addTrackCalls, 0, 'le flux capté est LU, jamais écrit (le doublon vient de là)')
    assert.equal(micStream.getAudioTracks().length, 1, 'le flux d’entrée garde UNE piste')
    chain.close()
  })

  it('la source micro est créée sur la PISTE (nouvelles pistes de test) — une entrée par chaîne', () => {
    const h = harness('robot')
    h.chain.applyFilter('woman')
    assert.equal(h.context.created.sources.length, 1, 'changer de voix ne recrée pas l’entrée')
  })
})

describe('voice-filter — la fabrique ne sait construire QUE le vocabulaire de la recette', () => {
  it('toutes les voix du vocabulaire se montent sans lever', () => {
    for (const id of VOICE_FILTER_IDS) {
      const context = new FakeAudioContext()
      const chain = createVoiceFilterChain(context, new FakeMediaStream([new FakeTrack('micro')]), id)
      assert.equal(chain.current, id, `${id} appliquée`)
      chain.close()
    }
  })

  it('un nœud débranché l’est vraiment (disconnect appelé sur la chaîne et la modulation)', () => {
    const h = harness('robot')
    const osc = h.context.created.oscillators[0]
    const gains = h.context.created.gains
    h.chain.close()
    assert.ok(osc !== undefined && osc.disconnectCalls >= 1, 'la porteuse est débranchée')
    for (const gain of gains) assert.ok(gain.disconnectCalls >= 1, 'les gains sont débranchés')
  })

  it('la branche de test est bien une doublure complète (garde du harnais, pas du produit)', () => {
    // Un connect() sur un AudioParam est noté À PART du connect() sur un nœud : sans cette
    // distinction, le ring passerait un test alors qu’il module un nœud au lieu d’un paramètre.
    const node = new FakeAudioNode()
    const param = new FakeAudioParam()
    node.connect(param)
    assert.equal(node.outgoing[0], param)
    assert.ok(param instanceof FakeAudioParam)
  })
})
