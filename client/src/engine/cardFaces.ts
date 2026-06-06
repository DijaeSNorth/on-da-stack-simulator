import type { CardDefinition, CardFaceDefinition, CardState } from '../types/game';

export function getActiveCardFace(card: CardState): CardFaceDefinition | undefined {
  const faces = card.definition.faces;
  if (!faces?.length) return undefined;
  return faces[card.transformed ? 1 : 0] ?? faces[0];
}

export function getEffectiveCardDefinition(card: CardState): CardDefinition {
  const face = getActiveCardFace(card);
  if (!face) return card.definition;

  return {
    ...card.definition,
    name: face.name || card.definition.name,
    manaCost: face.manaCost ?? card.definition.manaCost,
    cmc: face.cmc ?? card.definition.cmc,
    typeLine: face.typeLine || card.definition.typeLine,
    superTypes: face.superTypes.length ? face.superTypes : card.definition.superTypes,
    cardTypes: face.cardTypes.length ? face.cardTypes : card.definition.cardTypes,
    subTypes: face.subTypes,
    oracleText: face.oracleText,
    flavorText: face.flavorText ?? card.definition.flavorText,
    power: face.power ?? card.definition.power,
    toughness: face.toughness ?? card.definition.toughness,
    loyalty: face.loyalty ?? card.definition.loyalty,
    colors: face.colors.length ? face.colors : card.definition.colors,
    keywords: face.keywords.length ? face.keywords : card.definition.keywords,
    imageUrl: face.imageUrl ?? card.definition.imageUrl,
  };
}

export function getEffectiveOracleText(card: CardState): string {
  return getEffectiveCardDefinition(card).oracleText || '';
}

export function getEffectiveCardName(card: CardState): string {
  return getEffectiveCardDefinition(card).name;
}

export function getLandFaceIndex(definition: CardDefinition): number | null {
  const directLand = definition.cardTypes.includes('Land');
  if (directLand) return 0;
  const faceIndex = definition.faces?.findIndex(face => face.cardTypes.includes('Land')) ?? -1;
  return faceIndex >= 0 ? faceIndex : null;
}
