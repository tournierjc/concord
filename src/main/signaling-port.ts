/**
 * signaling-port.ts — le port de signalisation RÉELLEMENT utilisé, tel que l'UI doit l'afficher.
 *
 * POURQUOI CE MODULE EXISTE. L'onglet Réseau affichait `settings.network.signalingPort` : la valeur
 * **demandée** dans le fichier de réglages. Le moteur ne la lit pas — et ne le peut pas : SPEC-001 A5
 * dit que le port part de 47821 et **incrémente jusqu'à 47830 si le port est pris**, puis que « le port
 * réel est publié dans le beacon mDNS ». SPEC-002 **D1** en tire la règle d'affichage : « l'interface
 * n'affiche **jamais** un port qu'elle n'a pas lu du beacon », et S3.15 prévoit la ligne
 * `settings.network.portBumped` quand le port n'est plus le port par défaut.
 *
 * Autrement dit : le port est une **mesure** (quelle socket écoute, ou quel port l'hôte du salon a
 * annoncé), pas un réglage. Deux cas, et un seul chiffre à choisir :
 *   — ce poste HÉBERGE : le port de la socket d'écoute du lien de signalisation ;
 *   — ce poste est CLIENT : le port de l'hôte, lu dans l'annonce du salon (mDNS/balayage) ;
 *   — hors salon : `null` — l'UI dit « aucun » plutôt que d'inventer un chiffre.
 *
 * Module PUR (aucun import d'Electron, aucune horloge) : la règle est falsifiable par `node --test`,
 * alors que `index.ts` ne l'est pas.
 */

/** Ce qu'on sait du port : la socket écoutée, le salon courant, les salons annoncés. */
export interface SignalingPortFacts {
  /** Infos d'écoute du lien de signalisation — `null` en client, ou si le lien a refusé de démarrer. */
  readonly listen: { readonly host: string; readonly port: number } | null;
  /** Salon courant (celui du `RoomStateDto`) — `null` hors salon. */
  readonly roomId: string | null;
  /** Salons annoncés sur le réseau : c'est là qu'on LIT le port de l'hôte (jamais deviné). */
  readonly rooms: readonly { readonly roomId: string; readonly port: number }[];
}

/**
 * Rend le port de signalisation effectif, ou `null` quand il n'y en a pas à montrer.
 *
 * L'écoute l'emporte sur l'annonce : un poste qui héberge connaît son port mieux que son propre
 * beacon (et le lien le connaît dès `listen()`), et un poste client ne peut, lui, que lire celui de
 * l'hôte. Aucune valeur de repli n'est inventée : hors salon, la réponse est `null`.
 */
export function effectiveSignalingPort(facts: SignalingPortFacts): number | null {
  if (facts.listen !== null) return facts.listen.port;
  if (facts.roomId === null) return null;
  const remote = facts.rooms.find((room) => room.roomId === facts.roomId);
  return remote === undefined ? null : remote.port;
}
