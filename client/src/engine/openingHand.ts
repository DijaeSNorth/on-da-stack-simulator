import type { Deck, GameState, SoloOpeningHandCard, SoloOpeningHandSnapshot, SoloTestSession } from '../types/game';
import { analyzeDeck, type DeckStats } from './deckStats';

export interface OpeningHandState {
  shuffledLibrary: SoloOpeningHandCard[];
  currentHand: SoloOpeningHandCard[];
  mulligansTaken: number;
  cardsToBottom: string[];
  kept: boolean;
  handHistory: SoloOpeningHandSnapshot[];
}

export function createOpeningHandSession(deck: Deck, random: () => number = Math.random): OpeningHandState {
  const shuffledLibrary = shuffleOpeningLibrary(buildOpeningLibrary(deck), random);
  const currentHand = shuffledLibrary.slice(0, 7);
  return {
    shuffledLibrary,
    currentHand,
    mulligansTaken: 0,
    cardsToBottom: [],
    kept: false,
    handHistory: [createSnapshot(currentHand, 0, [])],
  };
}

export function mulliganOpeningHandSession(deck: Deck, session: Pick<SoloTestSession, 'mulligansTaken' | 'handHistory'>, random: () => number = Math.random): OpeningHandState {
  const mulligansTaken = (session.mulligansTaken ?? 0) + 1;
  const shuffledLibrary = shuffleOpeningLibrary(buildOpeningLibrary(deck), random);
  const currentHand = shuffledLibrary.slice(0, 7);
  const handHistory = [
    ...(session.handHistory ?? []),
    createSnapshot(currentHand, mulligansTaken, []),
  ];
  return {
    shuffledLibrary,
    currentHand,
    mulligansTaken,
    cardsToBottom: [],
    kept: false,
    handHistory,
  };
}

export function setOpeningHandCardsToBottom(session: SoloTestSession, cardIds: string[]): Partial<SoloTestSession> {
  const handIds = new Set(session.currentHand?.map(card => card.id) ?? []);
  const requirement = getCardsToBottomRequirement(session);
  return {
    cardsToBottom: cardIds.filter(id => handIds.has(id)).slice(0, requirement),
    kept: false,
  };
}

export function keepOpeningHandSession(session: SoloTestSession, cardIdsToBottom: string[] = session.cardsToBottom ?? []): Partial<SoloTestSession> {
  const selected = setOpeningHandCardsToBottom(session, cardIdsToBottom).cardsToBottom ?? [];
  return {
    cardsToBottom: selected,
    kept: true,
    handHistory: [
      ...(session.handHistory ?? []),
      createSnapshot(session.currentHand ?? [], session.mulligansTaken ?? 0, selected),
    ],
  };
}

export function getCardsToBottomRequirement(session: Pick<SoloTestSession, 'mulligansTaken'> | undefined): number {
  return Math.max(0, session?.mulligansTaken ?? 0);
}

export function analyzeOpeningHand(deck: Deck, hand: SoloOpeningHandCard[]): DeckStats {
  const counts = new Map<string, number>();
  for (const card of hand) counts.set(card.name, (counts.get(card.name) ?? 0) + 1);
  return analyzeDeck({
    ...deck,
    commanders: [],
    cards: [...counts.entries()].map(([name, count]) => ({ name, count })),
    sideboard: [],
    maybeboard: [],
  });
}

export function arrangeOpeningHandInGame(game: GameState, playerId: string, session: SoloTestSession): GameState {
  const player = game.players.find(p => p.id === playerId);
  if (!player || !session.currentHand?.length || !session.shuffledLibrary?.length) return game;

  const bottomIds = new Set(session.cardsToBottom ?? []);
  const handCardIds = new Set(session.currentHand.map(card => card.id));
  const keptCards = session.currentHand.filter(card => !bottomIds.has(card.id));
  const bottomCards = session.currentHand.filter(card => bottomIds.has(card.id));
  const remainingLibraryCards = session.shuffledLibrary.filter(card => !handCardIds.has(card.id));
  const desiredLibraryCards = [...remainingLibraryCards, ...bottomCards];

  const availableByName = new Map<string, string[]>();
  for (const instanceId of player.library) {
    const card = game.cards[instanceId];
    const key = card?.definition.name.toLowerCase();
    if (!key) continue;
    const list = availableByName.get(key) ?? [];
    list.push(instanceId);
    availableByName.set(key, list);
  }

  const used = new Set<string>();
  const takeInstance = (name: string): string | undefined => {
    const key = name.toLowerCase();
    const list = availableByName.get(key) ?? [];
    while (list.length > 0) {
      const id = list.shift();
      if (id && !used.has(id)) {
        used.add(id);
        return id;
      }
    }
    return undefined;
  };

  const hand = keptCards.map(card => takeInstance(card.name)).filter((id): id is string => Boolean(id));
  const library = desiredLibraryCards.map(card => takeInstance(card.name)).filter((id): id is string => Boolean(id));
  for (const instanceId of player.library) {
    if (!used.has(instanceId)) library.push(instanceId);
  }
  const handSet = new Set(hand);
  const librarySet = new Set(library);
  const cards = { ...game.cards };
  for (const id of hand) {
    if (cards[id]) cards[id] = { ...cards[id], zone: 'hand' };
  }
  for (const id of library) {
    if (cards[id]) cards[id] = { ...cards[id], zone: 'library' };
  }

  return {
    ...game,
    cards,
    players: game.players.map(p => p.id === playerId ? {
      ...p,
      hand,
      library,
      mulliganCount: session.mulligansTaken ?? p.mulliganCount,
    } : p),
    stack: game.stack.filter(item => !item.sourceInstanceId || !handSet.has(item.sourceInstanceId) || !librarySet.has(item.sourceInstanceId)),
    lastUpdatedAt: Date.now(),
  };
}

function buildOpeningLibrary(deck: Deck): SoloOpeningHandCard[] {
  const commanderNames = new Set(deck.commanders.map(name => name.toLowerCase()));
  const commanderCopiesUsed = new Set<string>();
  const library: SoloOpeningHandCard[] = [];
  for (const entry of deck.cards) {
    const key = entry.name.toLowerCase();
    const commanderCopyInCommandZone = commanderNames.has(key) && !commanderCopiesUsed.has(key);
    const libraryCount = Math.max(0, entry.count - (commanderCopyInCommandZone ? 1 : 0));
    if (commanderCopyInCommandZone) commanderCopiesUsed.add(key);
    for (let i = 0; i < libraryCount; i++) {
      library.push({
        id: `${slugify(entry.name)}-${library.length}`,
        name: entry.name,
        libraryIndex: library.length,
      });
    }
  }
  return library;
}

function shuffleOpeningLibrary(cards: SoloOpeningHandCard[], random: () => number): SoloOpeningHandCard[] {
  const next = [...cards];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next.map((card, index) => ({ ...card, libraryIndex: index }));
}

function createSnapshot(hand: SoloOpeningHandCard[], mulligansTaken: number, cardsToBottom: string[]): SoloOpeningHandSnapshot {
  return {
    id: `hand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    hand,
    mulligansTaken,
    cardsToBottom,
    createdAt: Date.now(),
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'card';
}
