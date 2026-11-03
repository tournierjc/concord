/**
 * tests/voice-chain.node.test.ts — le châssis de filtres vocaux, en Node, sans Web Audio
 *
 * CE QUI EST EN CAUSE ici n'est pas le graphe (éprouvé par `voice-filter.node.test.ts`) ni la
 * recette (éprouvée par `voice-filters.node.test.ts`), mais le CYCLE DE VIE du filtre branché
 * sur le plan média :
 *   • `open` ferme l'ancienne chaîne (deux graphes superposés = deux voix aux pairs) ;
 *   • la panne du constructeur rend la piste BRUTE et trace — jamais une session muette ;
 *   • `apply` avant `open` rend `null` (une intention, pas un succès prétendu) ;
 *   • `close` est idempotent et ne touche JAMAIS les pistes du flux (le flux appartient au
 *     plan média, pas au filtre) ;
 *   • sans constructeur, `open` rend la piste micro telle quelle (non-régression : la voix
 *     historique est exactement la piste de `getUserMedia`).
 *
 * Les doublures sont des DOUBLURES, pas des nœuds : le châssis ne lit des pistes que
 * l'identité (laquelle est rendue) et ne leur écrit jamais rien (ni `stop`, ni `enabled` —
 * c'est le plan média qui possède le flux). Elles sont donc passées là où le contrat dit
 * `MediaStreamTrack` par une SEULE conversion assumée du harnais, au point de passage des
 * doublures — jamais dans le produit, qui n'a aucun `as`.
 *
 *   node --test tests/voice-chain.node.test.ts
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  createVoiceChainHost,
  type VoiceChainFactory,
  type VoiceChainLike,
} from '../src/engine/rtc/voice-chain.ts'
import type { VoiceFilterId } from '../src/engine/rtc/voice-filters.ts'

/* ------------------------------------------------------------------ */
/* Doublures : une piste, un flux, une chaîne qui obéit (ou qui lève)   */
/* ------------------------------------------------------------------ */

class ChainTrack {
  public readonly kind = 'audio'
  public readonly label: string
  public stopped = false
  public constructor(label: string) {
    this.label = label
  }
  public stop(): void {
    this.stopped = true
  }
}

class ChainStream {
  public readonly tracks: ChainTrack[]
  public readonly added: ChainTrack[] = []
  public constructor(tracks: ChainTrack[]) {
    this.tracks = [...tracks]
  }
  public getAudioTracks(): ChainTrack[] {
    return this.tracks
  }
  public addTrack(track: ChainTrack): void {
    this.added.push(track)
  }
  public getTracks(): ChainTrack[] {
    return this.tracks
  }
}

/** Le passage doublure→contrat : une conversion, au point de passage des doublures. */
function asTrack(track: ChainTrack): MediaStreamTrack {
  return track as unknown as MediaStreamTrack
}
function asStream(stream: ChainStream): MediaStream {
  return stream as unknown as MediaStream
}

/** Une chaîne doublure qui enregistre ce qu'on lui a demandé. */
class FakeChain implements VoiceChainLike {
  public current: VoiceFilterId
  public readonly fakeTrack: ChainTrack
  public applied: VoiceFilterId[] = []
  public closeCalls = 0
  public constructor(id: VoiceFilterId, fakeTrack: ChainTrack) {
    this.current = id
    this.fakeTrack = fakeTrack
  }
  get track(): MediaStreamTrack {
    return asTrack(this.fakeTrack)
  }
  public applyFilter(id: VoiceFilterId): MediaStreamTrack {
    this.applied.push(id)
    this.current = id
    return this.track
  }
  public close(): void {
    this.closeCalls += 1
  }
}

/** Ce qu'un test peut imposer à la fabrication (lever, ou une chaîne qui lève en vol). */
type Builder = (_context: unknown, stream: ChainStream, id: VoiceFilterId) => VoiceChainLike

interface Harness {
  readonly micTrack: ChainTrack
  readonly stream: ChainStream
  readonly warnings: string[]
  readonly chains: FakeChain[]
  readonly host: ReturnType<typeof createVoiceChainHost>
}

function harness(options: { build?: Builder | null } = {}): Harness {
  const micTrack = new ChainTrack('micro')
  const stream = new ChainStream([micTrack])
  const warnings: string[] = []
  const chains: FakeChain[] = []
  const host = createVoiceChainHost({
    stream: asStream(stream),
    track: asTrack(micTrack),
    warn: (message) => {
      warnings.push(message)
    },
    ...(options.build === null
      ? {}
      : {
          buildChain: ((context: unknown, builtStream: MediaStream, id: VoiceFilterId): VoiceChainLike =>
            (options.build ?? ((_c, s, voice) => {
              const chain = new FakeChain(voice, new ChainTrack(`voix:${voice}`))
              chains.push(chain)
              return chain
            }))(context, builtStream as never, id)) as VoiceChainFactory,
        }),
  })
  return { micTrack, stream, warnings, chains, host }
}

/* ------------------------------------------------------------------ */

describe('voice-chain — la voix historique ne touche rien', () => {
  it('sans constructeur, open rend LA piste micro, telle quelle', () => {
    const h = harness({ build: null })
    const track = h.host.open('none')
    assert.equal(track, asTrack(h.micTrack), 'la piste brute est rendue sans intermédiaire')
    assert.equal(h.warnings.length, 0, 'aucune chaîne demandée : rien à tracer')
    assert.equal(h.host.current(), null, 'aucune chaîne ne vit')
  })

  it('open sans constructeur puis close : idempotent, silencieux', () => {
    const h = harness({ build: null })
    h.host.open('none')
    h.host.close()
    h.host.close()
    assert.equal(h.warnings.length, 0)
  })
})

describe('voice-chain — une chaîne à la fois', () => {
  it('open ferme l’ancienne chaîne avant d’en ouvrir une nouvelle', () => {
    const h = harness()
    h.host.open('robot')
    assert.equal(h.chains.length, 1)
    h.host.open('child')
    assert.equal(h.chains.length, 2, 'la nouvelle chaîne vit')
    assert.equal(h.chains[0]?.closeCalls, 1, 'l’ancienne est fermée (deux graphes = deux voix)')
    assert.equal(h.chains[1]?.closeCalls, 0, 'la nouvelle vit')
  })

  it('la piste rendue est celle de la CHAÎNE, pas celle du micro', () => {
    const h = harness()
    const track = h.host.open('radio')
    assert.notEqual(track, asTrack(h.micTrack), 'ce qui part aux pairs est la piste filtrée')
  })
})

describe('voice-chain — la panne du filtre n’éteint pas la session', () => {
  it('un constructeur qui lève rend la piste BRUTE et trace', () => {
    const h = harness({
      build: () => {
        throw new Error('AudioWorklet indisponible')
      },
    })
    const track = h.host.open('child')
    assert.equal(track, asTrack(h.micTrack), 'la voix brute est rendue — une session qui parle')
    assert.equal(h.warnings.length, 1, 'l’échec est tracé, jamais muet')
    assert.match(h.warnings[0] ?? '', /voix brute/, 'la trace nomme le remède effectif')
    assert.equal(h.host.current(), null, 'aucune voix n’est PRÉTENDUE appliquée')
  })

  it('apply sans chaîne vivante rend null (intention, pas succès)', () => {
    const h = harness({ build: null })
    assert.equal(h.host.apply('robot'), null, 'rien n’est ouvert : rien n’est prétendu changé')
  })

  it('apply sur une chaîne qui lève en vol rend la piste brute et trace', () => {
    let explode = false
    const h = harness({
      build: (_context, _stream, id) => {
        const chain = new FakeChain(id, new ChainTrack('voix'))
        const base = chain.applyFilter.bind(chain)
        chain.applyFilter = ((requested: VoiceFilterId): MediaStreamTrack => {
          if (explode) throw new Error('graphe refusé par la page')
          return base(requested)
        }) as never
        return chain
      },
    })
    h.host.open('robot')
    explode = true
    const track = h.host.apply('child')
    assert.equal(track, asTrack(h.micTrack), 'la voix brute remplace le refus')
    assert.equal(h.warnings.length, 1, 'le refus en vol est tracé')
  })
})

describe('voice-chain — apply et current sur une chaîne vivante', () => {
  it('apply transmet la voix à la chaîne et rend sa piste', () => {
    const h = harness()
    h.host.open('none')
    const track = h.host.apply('deep')
    assert.equal(h.chains[0]?.applied.join(','), 'deep', 'la chaîne a reçu la voix')
    assert.equal(track, h.chains[0]?.track, 'la piste des pairs est celle de la chaîne')
  })

  it('current rend la voix de la chaîne, pas une intention', () => {
    const h = harness()
    h.host.open('woman')
    assert.equal(h.host.current(), 'woman')
    h.host.close()
    assert.equal(h.host.current(), null, 'après close : plus aucune voix revendiquée')
  })
})

describe('voice-chain — close ne touche jamais le flux', () => {
  it('close ferme la chaîne et laisse les pistes du micro vivantes', () => {
    const h = harness()
    h.host.open('robot')
    h.host.close()
    assert.equal(h.chains[0]?.closeCalls, 1, 'la chaîne est débranchée')
    assert.equal(h.micTrack.stopped, false, 'la piste micro appartient au plan média, pas au filtre')
    h.host.close()
    assert.equal(h.chains[0]?.closeCalls, 1, 'close est idempotent')
  })

  it('un close qui lève est tracé, pas propagé (la fermeture du plan continue)', () => {
    const h = harness({
      build: (_context, _stream, id) => {
        const chain = new FakeChain(id, new ChainTrack('voix'))
        chain.close = (() => {
          throw new Error('débranchement impossible')
        }) as never
        return chain
      },
    })
    h.host.open('radio')
    h.host.close()
    assert.equal(h.warnings.length, 1, 'l’anomalie de fermeture est tracée')
    assert.equal(h.host.current(), null, 'la chaîne est oubliée quand même')
  })
})
