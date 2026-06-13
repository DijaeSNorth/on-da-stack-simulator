import type { Deck, DeckValidationResult, SoloModeTab } from '../../types/game';
import { exportDeckText } from '../../engine/deckImportExport';

export const SOLO_DECK_LAB_TABS: { id: SoloModeTab; label: string; description: string }[] = [
  { id: 'builder', label: 'Builder', description: 'Load, import, and prepare a deck.' },
  { id: 'test_hand', label: 'Test Hand', description: 'Start a quick one-player hand test.' },
  { id: 'goldfish', label: 'Goldfish', description: 'Play solo turns against an empty table.' },
  { id: 'stats', label: 'Stats', description: 'Review deck counts and validation status.' },
  { id: 'sandbox', label: 'Sandbox', description: 'Open a manual test table for card logic.' },
  { id: 'dummy', label: 'Dummy', description: 'Practice against scripted dummy opponents.' },
  { id: 'reports', label: 'Reports', description: 'Save, filter, export, import, and compare solo test reports.' },
  { id: 'export', label: 'Export', description: 'Copy a portable decklist.' },
];

export function getDeckCardCount(deck?: Deck): number {
  return deck?.cards.reduce((sum, card) => sum + card.count, 0) ?? 0;
}

export function getDeckCommanderLine(deck?: Deck): string {
  if (!deck || deck.commanders.length === 0) return 'No commander selected';
  return deck.commanders.join(', ');
}

export function getValidationLabel(validation?: DeckValidationResult): { label: string; color: string } {
  if (!validation) return { label: 'Not validated', color: '#94a3b8' };
  if (validation.valid) return { label: 'Commander legal', color: '#86efac' };
  return { label: 'Needs attention', color: '#fca5a5' };
}

export function formatDeckForExport(deck?: Deck): string {
  return exportDeckText(deck);
}
