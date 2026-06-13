import type { CustomCardDefinition, Deck, ManaColor } from '../types/game';

export type DeckStatsColorKey = ManaColor | 'Colorless' | 'Unknown';
export type DeckStatsCurveKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | 'unknown';

export interface DeckStats {
  totalCards: number;
  commanderCount: number;
  mainDeckCount: number;
  landCount: number;
  nonlandCount: number;
  creatureCount: number;
  instantSorceryCount: number;
  artifactCount: number;
  enchantmentCount: number;
  planeswalkerCount: number;
  battleCount: number;
  manaCurve: Record<DeckStatsCurveKey, number>;
  averageManaValue: number;
  colorDistribution: Record<DeckStatsColorKey, number>;
  colorIdentity: ManaColor[];
  rampCount: number;
  drawCount: number;
  removalCount: number;
  boardWipeCount: number;
  unknownManaValueCount: number;
  unknownTypeCount: number;
  warnings: string[];
}

type DeckEntry = { name: string; count: number; section: 'commander' | 'main' };

type DeckCardMetadata = Partial<CustomCardDefinition> & {
  cardTypes?: string[];
  type_line?: string;
  type?: string;
  card?: Partial<CustomCardDefinition> & { cardTypes?: string[]; type_line?: string; type?: string };
  definition?: Partial<CustomCardDefinition> & { cardTypes?: string[]; type_line?: string; type?: string };
};

const COLOR_ORDER: ManaColor[] = ['W', 'U', 'B', 'R', 'G'];
const CARD_TYPES = ['Creature', 'Land', 'Artifact', 'Enchantment', 'Planeswalker', 'Instant', 'Sorcery', 'Battle'];
const BASIC_LANDS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes']);

export function analyzeDeck(deck?: Deck | null): DeckStats {
  const entries = deck ? getCommanderDeckEntries(deck) : [];
  const cardIndex = deck ? getDeckCardMetadataIndex(deck) : new Map<string, DeckCardMetadata>();
  const manaCurve = createEmptyCurve();
  const colorDistribution = createEmptyColorDistribution();
  const colorIdentitySet = new Set<ManaColor>();
  let totalCards = 0;
  let mainDeckCount = 0;
  let landCount = 0;
  let creatureCount = 0;
  let instantSorceryCount = 0;
  let artifactCount = 0;
  let enchantmentCount = 0;
  let planeswalkerCount = 0;
  let battleCount = 0;
  let manaValueTotal = 0;
  let manaValueCards = 0;
  let unknownManaValueCount = 0;
  let unknownTypeCount = 0;
  let rampCount = 0;
  let drawCount = 0;
  let removalCount = 0;
  let boardWipeCount = 0;

  for (const color of deck?.colorIdentity ?? []) {
    if (isManaColor(color) && color !== 'C') colorIdentitySet.add(color);
  }

  for (const entry of entries) {
    totalCards += entry.count;
    if (entry.section === 'main') mainDeckCount += entry.count;
    const metadata = cardIndex.get(entry.name.toLowerCase());
    const types = getCardTypes(entry.name, metadata);
    if (types.length === 0) unknownTypeCount += entry.count;
    const isLand = types.includes('Land');
    if (isLand) landCount += entry.count;
    if (types.includes('Creature')) creatureCount += entry.count;
    if (types.includes('Instant') || types.includes('Sorcery')) instantSorceryCount += entry.count;
    if (types.includes('Artifact')) artifactCount += entry.count;
    if (types.includes('Enchantment')) enchantmentCount += entry.count;
    if (types.includes('Planeswalker')) planeswalkerCount += entry.count;
    if (types.includes('Battle')) battleCount += entry.count;

    const manaValue = getManaValue(metadata);
    if (!isLand) {
      if (typeof manaValue === 'number' && Number.isFinite(manaValue)) {
        const curveKey = getCurveKey(manaValue);
        manaCurve[curveKey] += entry.count;
        manaValueTotal += manaValue * entry.count;
        manaValueCards += entry.count;
      } else {
        manaCurve.unknown += entry.count;
        unknownManaValueCount += entry.count;
      }
    }

    const colors = getColorIdentity(metadata);
    if (colors.length > 0) {
      for (const color of colors) {
        colorDistribution[color] += entry.count;
        colorIdentitySet.add(color);
      }
    } else if (metadata || isKnownColorlessName(entry.name) || isLand) {
      colorDistribution.Colorless += entry.count;
    } else {
      colorDistribution.Unknown += entry.count;
    }

    const categoryText = getCategoryText(metadata);
    if (isRampText(categoryText)) rampCount += entry.count;
    if (isDrawText(categoryText)) drawCount += entry.count;
    if (isBoardWipeText(categoryText)) boardWipeCount += entry.count;
    else if (isRemovalText(categoryText)) removalCount += entry.count;
  }

  const warnings: string[] = [];
  if (unknownTypeCount > 0) warnings.push(`${unknownTypeCount} card(s) have unknown type data.`);
  if (unknownManaValueCount > 0) warnings.push(`${unknownManaValueCount} nonland card(s) have unknown mana value.`);

  return {
    totalCards,
    commanderCount: deck?.commanders.length ?? 0,
    mainDeckCount,
    landCount,
    nonlandCount: Math.max(0, totalCards - landCount),
    creatureCount,
    instantSorceryCount,
    artifactCount,
    enchantmentCount,
    planeswalkerCount,
    battleCount,
    manaCurve,
    averageManaValue: manaValueCards > 0 ? manaValueTotal / manaValueCards : 0,
    colorDistribution,
    colorIdentity: [...colorIdentitySet].sort(colorSort),
    rampCount,
    drawCount,
    removalCount,
    boardWipeCount,
    unknownManaValueCount,
    unknownTypeCount,
    warnings,
  };
}

function getCommanderDeckEntries(deck: Deck): DeckEntry[] {
  const commanderNames = new Set(deck.commanders.map(name => name.toLowerCase()));
  const cardNames = new Set(deck.cards.map(card => card.name.toLowerCase()));
  return [
    ...deck.commanders
      .filter(name => !cardNames.has(name.toLowerCase()))
      .map(name => ({ name, count: 1, section: 'commander' as const })),
    ...deck.cards.map(card => ({
      name: card.name,
      count: card.count,
      section: commanderNames.has(card.name.toLowerCase()) ? 'commander' as const : 'main' as const,
    })),
  ];
}

function getDeckCardMetadataIndex(deck: Deck): Map<string, DeckCardMetadata> {
  const index = new Map<string, DeckCardMetadata>();
  for (const card of deck.logicFile?.customCards ?? []) {
    index.set(card.name.toLowerCase(), card);
  }

  const readEntryMetadata = (entry: { name: string; count: number }): DeckCardMetadata | undefined => {
    const raw = entry as unknown as DeckCardMetadata;
    return raw.definition ?? raw.card ?? raw;
  };

  for (const entry of [...deck.cards, ...deck.sideboard, ...deck.maybeboard]) {
    if (index.has(entry.name.toLowerCase())) continue;
    const metadata = readEntryMetadata(entry);
    if (metadata?.typeLine || metadata?.type_line || metadata?.cardTypes || metadata?.faces || metadata?.cmc !== undefined) {
      index.set(entry.name.toLowerCase(), { ...metadata, name: entry.name });
    }
  }
  return index;
}

function createEmptyCurve(): Record<DeckStatsCurveKey, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, unknown: 0 };
}

function createEmptyColorDistribution(): Record<DeckStatsColorKey, number> {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, Colorless: 0, Unknown: 0 };
}

function getCardTypes(name: string, card?: DeckCardMetadata): string[] {
  if (!card && BASIC_LANDS.has(name.toLowerCase())) return ['Land'];
  const explicitTypes = Array.isArray(card?.cardTypes) ? card.cardTypes : [];
  const faceTypes = (card?.faces ?? [])
    .flatMap(face => Array.isArray(face.cardTypes) ? face.cardTypes : getCardTypesFromTypeLine(face.typeLine));
  const typeLine = card?.typeLine ?? card?.type_line ?? card?.type ?? '';
  const fromLine = getCardTypesFromTypeLine(typeLine);
  return CARD_TYPES.filter(type =>
    explicitTypes.some(cardType => cardType.toLowerCase() === type.toLowerCase()) ||
    faceTypes.some(cardType => cardType.toLowerCase() === type.toLowerCase()) ||
    fromLine.includes(type)
  );
}

function getCardTypesFromTypeLine(typeLine: string | undefined): string[] {
  return CARD_TYPES.filter(type => new RegExp(`\\b${type}\\b`, 'i').test(typeLine ?? ''));
}

function getManaValue(card?: DeckCardMetadata): number | undefined {
  if (typeof card?.cmc === 'number') return card.cmc;
  if (typeof card?.manaCost?.cmc === 'number') return card.manaCost.cmc;
  const faceValue = (card?.faces ?? []).find(face => typeof face.cmc === 'number')?.cmc;
  return typeof faceValue === 'number' ? faceValue : undefined;
}

function getCurveKey(manaValue: number): DeckStatsCurveKey {
  const normalized = Math.max(0, Math.floor(manaValue));
  if (normalized >= 7) return '7';
  return String(normalized) as DeckStatsCurveKey;
}

function getColorIdentity(card?: DeckCardMetadata): ManaColor[] {
  const colors = card?.colorIdentity ?? card?.colors ?? [];
  return [...new Set(colors.filter((color): color is ManaColor => isManaColor(color) && color !== 'C'))].sort(colorSort);
}

function colorSort(a: ManaColor, b: ManaColor): number {
  return COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b);
}

function isManaColor(value: unknown): value is ManaColor {
  return typeof value === 'string' && ['W', 'U', 'B', 'R', 'G', 'C'].includes(value);
}

function isKnownColorlessName(name: string): boolean {
  return BASIC_LANDS.has(name.toLowerCase());
}

function getCategoryText(card?: DeckCardMetadata): string {
  return [
    card?.oracleText,
    card?.keywords?.join(' '),
    ...(card?.faces ?? []).map(face => `${face.oracleText ?? ''} ${face.keywords?.join(' ') ?? ''}`),
  ].filter(Boolean).join(' ').toLowerCase();
}

function isRampText(text: string): boolean {
  return /\badd\s+\{?[wubrgc]/i.test(text) ||
    text.includes('search your library for a land') ||
    text.includes('search your library for a basic land') ||
    text.includes('put a land card');
}

function isDrawText(text: string): boolean {
  return /\bdraw (a|two|three|x|\d+) cards?\b/i.test(text) || text.includes('draw a card');
}

function isBoardWipeText(text: string): boolean {
  return text.includes('destroy all') ||
    text.includes('exile all') ||
    text.includes('all creatures') ||
    text.includes('each creature');
}

function isRemovalText(text: string): boolean {
  return text.includes('destroy target') ||
    text.includes('exile target') ||
    text.includes('counter target') ||
    /deals? \d+ damage to target/i.test(text);
}
