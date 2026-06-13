import { useMemo } from 'react';
import { analyzeOpeningHand, getCardsToBottomRequirement } from '../../engine/openingHand';
import { useGameStore } from '../../store/gameStore';
import type { SoloDeckLabStartOptions } from './SoloDeckLab';

interface SoloTestHandPanelProps {
  startOptions?: SoloDeckLabStartOptions;
}

export function SoloTestHandPanel({ startOptions }: SoloTestHandPanelProps) {
  const store = useGameStore();
  const activeDeck = store.soloDeckLab.draftDeck
    ?? store.decks.find(deck => deck.id === store.soloDeckLab.activeDeckId);
  const session = store.soloDeckLab.testSession?.mode === 'test_hand'
    ? store.soloDeckLab.testSession
    : undefined;
  const hand = session?.currentHand ?? [];
  const selectedBottom = new Set(session?.cardsToBottom ?? []);
  const bottomRequirement = getCardsToBottomRequirement(session);
  const handStats = useMemo(
    () => activeDeck ? analyzeOpeningHand(activeDeck, hand) : undefined,
    [activeDeck, hand],
  );

  function toggleBottom(cardId: string) {
    const next = new Set(selectedBottom);
    if (next.has(cardId)) next.delete(cardId);
    else next.add(cardId);
    store.setSoloOpeningHandCardsToBottom([...next]);
  }

  if (!activeDeck) {
    return (
      <div data-testid="solo-test-hand-empty" style={panelStyle}>
        <div style={{ color: '#94a3b8', fontSize: 11 }}>
          Load or create a deck before testing opening hands.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div>
            <div style={titleStyle}>Opening Hand Tester</div>
            <div style={{ color: '#94a3b8', fontSize: 11 }}>
              {activeDeck.name} | London mulligan | {session?.kept ? 'Kept' : 'Testing'}
            </div>
          </div>
          <div style={{ color: '#cffafe', fontSize: 11, fontWeight: 900 }}>
            Mulligans: {session?.mulligansTaken ?? 0} | Bottom: {(session?.cardsToBottom ?? []).length}/{bottomRequirement}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <button type="button" data-testid="solo-draw-opening-hand" onClick={() => store.drawSoloOpeningHand()} style={buttonStyle('#083344', '#cffafe')}>
            Draw Opening Hand
          </button>
          <button type="button" data-testid="solo-mulligan-hand" onClick={() => store.mulliganSoloOpeningHand()} disabled={!session?.currentHand} style={buttonStyle('#332511', '#fde68a')}>
            Mulligan
          </button>
          <button type="button" data-testid="solo-keep-hand" onClick={() => store.keepSoloOpeningHand()} disabled={!session?.currentHand} style={buttonStyle('#14532d', '#dcfce7')}>
            Keep
          </button>
          <button type="button" data-testid="solo-new-hand" onClick={() => store.newSoloOpeningHand()} style={buttonStyle('#1e3a5f', '#bfdbfe')}>
            New Hand
          </button>
          <button type="button" data-testid="solo-start-from-hand" onClick={() => void store.startSoloGameFromOpeningHand(startOptions)} disabled={!session?.currentHand} style={buttonStyle('#4c1d95', '#ddd6fe')}>
            Start Goldfish From This Hand
          </button>
        </div>

        {bottomRequirement > 0 && (
          <div style={{ color: '#fcd34d', fontSize: 10 }}>
            Select {bottomRequirement} card{bottomRequirement === 1 ? '' : 's'} to put on bottom before starting. Manual choice is allowed.
          </div>
        )}
      </div>

      {handStats && (
        <div style={summaryGridStyle}>
          <Summary label="Lands" value={handStats.landCount} />
          <Summary label="Nonlands" value={handStats.nonlandCount} />
          <Summary label="Avg MV" value={handStats.averageManaValue.toFixed(2)} />
          <Summary label="Ramp" value={handStats.rampCount} />
          <Summary label="Draw" value={handStats.drawCount} />
          <Summary label="Removal" value={handStats.removalCount + handStats.boardWipeCount} />
        </div>
      )}

      <div style={panelStyle}>
        <div style={titleStyle}>Current hand</div>
        {hand.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 11 }}>Draw an opening hand to begin.</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {hand.map(card => {
              const bottomed = selectedBottom.has(card.id);
              return (
                <button
                  key={card.id}
                  type="button"
                  data-testid={`solo-hand-card-${card.name}`}
                  onClick={() => toggleBottom(card.id)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderRadius: 7,
                    border: `1px solid ${bottomed ? '#f59e0b' : '#26323a'}`,
                    background: bottomed ? 'rgba(245,158,11,0.14)' : '#0b0f12',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800 }}>{card.name}</span>
                  <span style={{ color: bottomed ? '#fde68a' : '#64748b', fontSize: 10 }}>
                    {bottomed ? 'Bottom' : 'Keep'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {session?.handHistory?.length ? (
        <div style={panelStyle}>
          <div style={titleStyle}>Hand history</div>
          <div style={{ display: 'grid', gap: 4 }}>
            {session.handHistory.slice(-5).map((snapshot, index) => (
              <div key={snapshot.id} style={{ color: '#94a3b8', fontSize: 10 }}>
                {index + 1}. Mulligan {snapshot.mulligansTaken}: {snapshot.hand.map(card => card.name).join(', ')}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={summaryStyle}>
      <div style={{ color: '#64748b', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 900 }}>{value}</div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 8,
  padding: 10,
};

const titleStyle: React.CSSProperties = {
  color: '#e2e8f0',
  fontSize: 11,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
  gap: 7,
};

const summaryStyle: React.CSSProperties = {
  background: '#0b0f12',
  border: '1px solid #26323a',
  borderRadius: 7,
  padding: 8,
};

function buttonStyle(background: string, color: string): React.CSSProperties {
  return {
    background,
    color,
    border: `1px solid ${color}44`,
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: 10,
    fontWeight: 900,
    cursor: 'pointer',
    textTransform: 'uppercase',
  };
}
