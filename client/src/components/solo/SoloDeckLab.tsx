import { useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { HouseRule, PlayerAvatarImage } from '../../types/game';
import { SOLO_DECK_LAB_TABS, getDeckCardCount, getDeckCommanderLine, getValidationLabel } from './soloUiModel';
import { SoloBuilderPanel } from './SoloBuilderPanel';
import { SoloTestHandPanel } from './SoloTestHandPanel';
import { SoloGoldfishPanel } from './SoloGoldfishPanel';
import { SoloStatsPanel } from './SoloStatsPanel';
import { SoloSandboxPanel } from './SoloSandboxPanel';
import { SoloDummyPanel } from './SoloDummyPanel';
import { SoloReportHistoryPanel } from './SoloReportHistoryPanel';
import { SoloExportPanel } from './SoloExportPanel';

export interface SoloDeckLabPlayerSetup {
  id?: string;
  name?: string;
  color?: string;
  avatarInitial?: string;
  avatarStyle?: 'solid' | 'gradient' | 'outline';
  avatarImage?: PlayerAvatarImage;
}

export interface SoloDeckLabStartOptions {
  player?: SoloDeckLabPlayerSetup;
  startingLife?: number;
  houseRules?: HouseRule[];
}

interface SoloDeckLabProps {
  startOptions?: SoloDeckLabStartOptions;
}

export function SoloDeckLab({ startOptions }: SoloDeckLabProps) {
  const store = useGameStore();
  const activeDeck = store.soloDeckLab.draftDeck
    ?? store.decks.find(deck => deck.id === store.soloDeckLab.activeDeckId);
  const validation = store.soloDeckLab.lastValidation;
  const validationBadge = getValidationLabel(validation);
  const activeTab = store.ui.soloModeTab;
  const tabDescription = useMemo(
    () => SOLO_DECK_LAB_TABS.find(tab => tab.id === activeTab)?.description ?? '',
    [activeTab],
  );

  return (
    <div
      data-testid="solo-deck-lab"
      style={{
        background: '#0b1411',
        border: '1px solid #1f4f3a',
        borderRadius: 12,
        padding: 16,
        display: 'grid',
        gap: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 800 }}>
            Deck Lab
          </div>
          <div style={{ color: '#f8fafc', fontSize: 18, fontWeight: 800, marginTop: 3 }}>
            {activeDeck?.name ?? 'No deck loaded'}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 3 }}>
            {activeDeck ? `${getDeckCardCount(activeDeck)} cards | ${getDeckCommanderLine(activeDeck)}` : 'Import or load a saved deck to begin testing.'}
          </div>
        </div>
        <div style={{
          alignSelf: 'flex-start',
          color: validationBadge.color,
          background: 'rgba(15,23,42,0.72)',
          border: `1px solid ${validationBadge.color}55`,
          borderRadius: 999,
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 800,
        }}>
          {validationBadge.label}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(78px, 1fr))', gap: 6 }}>
        {SOLO_DECK_LAB_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            data-testid={`solo-tab-${tab.id}`}
            onClick={() => store.setSoloModeTab(tab.id)}
            style={{
              padding: '8px 6px',
              borderRadius: 7,
              border: `1px solid ${activeTab === tab.id ? '#22c55e' : '#1e293b'}`,
              background: activeTab === tab.id ? 'rgba(34,197,94,0.18)' : '#111827',
              color: activeTab === tab.id ? '#bbf7d0' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 10,
              fontWeight: 800,
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ color: '#64748b', fontSize: 11 }}>{tabDescription}</div>

      {activeTab === 'builder' && <SoloBuilderPanel />}
      {activeTab === 'test_hand' && <SoloTestHandPanel startOptions={startOptions} />}
      {activeTab === 'goldfish' && <SoloGoldfishPanel startOptions={startOptions} />}
      {activeTab === 'stats' && <SoloStatsPanel />}
      {activeTab === 'sandbox' && <SoloSandboxPanel startOptions={startOptions} />}
      {activeTab === 'dummy' && <SoloDummyPanel startOptions={startOptions} />}
      {activeTab === 'reports' && <SoloReportHistoryPanel />}
      {activeTab === 'export' && <SoloExportPanel />}
    </div>
  );
}
