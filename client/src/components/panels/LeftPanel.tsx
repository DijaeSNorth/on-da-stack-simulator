import { useGameStore } from '../../store/gameStore';
import type { Player } from '../../types/game';
import { TutorialTooltip } from '../tutorial/TutorialTooltip';
import { TOOLTIPS } from '../../store/tutorialStore';
import { getPhaseLabel } from '../../engine/phaseMeta';

function LifeCounter({ player, onChange }: { player: Player; onChange: (delta: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        data-testid={`life-decrease-${player.id}`}
        onClick={() => onChange(-1)}
        style={{
          background: '#7f1d1d', color: '#fca5a5',
          border: 'none', borderRadius: 3,
          width: 20, height: 20, cursor: 'pointer',
          fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1,
        }}
      >−</button>
      <div
        data-testid={`life-total-${player.id}`}
        style={{
          fontSize: 22, fontWeight: 800, color: '#e2e8f0',
          minWidth: 36, textAlign: 'center',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {player.life}
      </div>
      <button
        data-testid={`life-increase-${player.id}`}
        onClick={() => onChange(1)}
        style={{
          background: '#14532d', color: '#86efac',
          border: 'none', borderRadius: 3,
          width: 20, height: 20, cursor: 'pointer',
          fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1,
        }}
      >+</button>
    </div>
  );
}

export function LeftPanel() {
  const store = useGameStore();
  const { game, ui, localPlayerId } = store;
  const phaseLabel = getPhaseLabel(game.phase);
  const phaseBlocked = game.stack.length > 0;

  if (!ui.leftPanelOpen) return null;

  const players = game.players;

  return (
    <div
      data-testid="left-panel"
      style={{
        width: 200,
        background: '#111827',
        borderRight: '1px solid #1e293b',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #1e293b',
        fontSize: 10,
        fontWeight: 700,
        color: '#475569',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        Players
        <button
          onClick={store.toggleLeftPanel}
          style={{
            background: 'none', border: 'none',
            color: '#475569', cursor: 'pointer', fontSize: 14,
            padding: 0, lineHeight: 1,
          }}
        >‹</button>
      </div>

      {/* Player cards */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 6 }}>
        {players.map(player => {
          const isActive = player.id === game.activePlayerId;
          const hasPriority = player.id === game.priorityPlayerId;
          const bfCount = player.battlefield.length;
          const cmdDmgEntries = Object.entries(player.commanderDamage).filter(([, v]) => v > 0);

          return (
            <div
              key={player.id}
              data-testid={`player-card-${player.id}`}
              onClick={() => store.setFocusedPlayer(player.id === ui.focusedPlayerId ? null : player.id)}
              style={{
                background: isActive ? `${player.color}18` : 'rgba(255,255,255,0.02)',
                border: `1px solid ${isActive ? player.color + '44' : '#1e293b'}`,
                borderLeft: `3px solid ${player.color}`,
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 4,
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {player.name}
                  {player.id === localPlayerId && <span style={{ color: '#6b7280', fontWeight: 400 }}> (you)</span>}
                </span>
                <div style={{ display: 'flex', gap: 3 }}>
                  {isActive && (
                    <span style={{
                      fontSize: 8, background: '#14532d', color: '#86efac',
                      borderRadius: 2, padding: '1px 4px', fontWeight: 700,
                    }}>ACT</span>
                  )}
                  {hasPriority && (
                    <span style={{
                      fontSize: 8, background: '#1e3a5f', color: '#93c5fd',
                      borderRadius: 2, padding: '1px 4px', fontWeight: 700,
                    }}>PRI</span>
                  )}
                </div>
              </div>

              {/* Life */}
              <LifeCounter
                player={player}
                onChange={(delta) => store.modifyPlayerLife(player.id, delta)}
              />

              {/* Status row */}
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                {player.poisonCounters > 0 && (
                  <div style={{ fontSize: 10, color: '#86efac' }}>
                    ☠ {player.poisonCounters}
                  </div>
                )}
                {player.energyCounters > 0 && (
                  <div style={{ fontSize: 10, color: '#fcd34d' }}>
                    ⚡ {player.energyCounters}
                  </div>
                )}
                <div style={{ fontSize: 10, color: '#475569' }}>
                  {player.hand.length} cards
                </div>
                <div style={{ fontSize: 10, color: '#475569' }}>
                  {bfCount} perms
                </div>
              </div>

              {/* Commander damage */}
              {cmdDmgEntries.length > 0 && (
                <div style={{ marginTop: 4 }}>
                  {cmdDmgEntries.map(([cmdId, dmg]) => {
                    const cmdCard = game.cards[cmdId];
                    return (
                      <div key={cmdId} style={{
                        fontSize: 9, color: dmg >= 21 ? '#ef4444' : '#f97316',
                        display: 'flex', justifyContent: 'space-between',
                      }}>
                        <span>⚔ {cmdCard?.definition.name?.slice(0, 14) || '?'}</span>
                        <span style={{ fontWeight: 700 }}>{dmg}{dmg >= 21 ? ' 💀' : ''}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Commander zone */}
              {player.commandZone.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 9, color: '#7c3aed' }}>
                  ⚜ {player.commandZone.map(id =>
                    game.cards[id]?.definition.name || '?'
                  ).join(', ')}
                  {player.commanders[0] && player.commanderCastCount[player.commanders[0]] > 0 && (
                    <span style={{ color: '#a78bfa' }}>
                      {' '}(Tax: {player.commanderCastCount[player.commanders[0]] * 2})</span>
                  )}
                </div>
              )}

              {/* Quick actions */}
              <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                <button
                  data-testid={`btn-draw-${player.id}`}
                  onClick={(e) => { e.stopPropagation(); store.drawCard(player.id); }}
                  style={{
                    fontSize: 9, padding: '2px 6px',
                    background: '#1e3a5f', color: '#93c5fd',
                    border: 'none', borderRadius: 3, cursor: 'pointer',
                  }}
                >Draw</button>
                <TutorialTooltip content={TOOLTIPS.zone_graveyard} placement="top" delay={500}>
                  <button
                    data-testid={`btn-open-graveyard-${player.id}`}
                    onClick={(e) => { e.stopPropagation(); store.openZoneDrawer('graveyard', player.id); }}
                    style={{
                      fontSize: 9, padding: '2px 6px',
                      background: '#1c1917', color: '#78716c',
                      border: '1px solid #292524', borderRadius: 3, cursor: 'pointer',
                    }}
                  >GY ({player.graveyard.length})</button>
                </TutorialTooltip>
                <TutorialTooltip content={TOOLTIPS.zone_exile} placement="top" delay={500}>
                  <button
                    data-testid={`btn-open-exile-${player.id}`}
                    onClick={(e) => { e.stopPropagation(); store.openZoneDrawer('exile', player.id); }}
                    style={{
                      fontSize: 9, padding: '2px 6px',
                      background: '#1c1917', color: '#78716c',
                      border: '1px solid #292524', borderRadius: 3, cursor: 'pointer',
                    }}
                  >Ex ({player.exile.length})</button>
                </TutorialTooltip>
              </div>
            </div>
          );
        })}
      </div>

      {/* Phase controls */}
      <div style={{
        borderTop: '1px solid #1e293b',
        padding: 8,
      }}>
        <div style={{ fontSize: 9, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          Turn {game.turn} · {phaseLabel}
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            data-testid="btn-next-phase"
            aria-label={phaseBlocked ? 'Resolve the stack before advancing phase' : `Advance from ${phaseLabel} to the next phase`}
            onClick={store.advancePhase}
            disabled={phaseBlocked}
            title={phaseBlocked ? 'Resolve stack before advancing' : 'Advance to next phase'}
            style={{
              flex: 1, padding: '5px 0',
              background: phaseBlocked ? '#334155' : '#1d4ed8',
              color: phaseBlocked ? '#64748b' : '#fff',
              border: 'none', borderRadius: 4,
              cursor: phaseBlocked ? 'not-allowed' : 'pointer',
              fontSize: 10, fontWeight: 700,
            }}
          >{phaseBlocked ? 'Stack Pending' : 'Next Phase'}</button>
          <button
            data-testid="btn-next-turn"
            aria-label="End the current turn"
            onClick={store.advanceTurn}
            style={{
              padding: '5px 8px',
              background: '#4c1d95', color: '#c4b5fd',
              border: 'none', borderRadius: 4, cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
            }}
          >End Turn</button>
        </div>
      </div>
    </div>
  );
}
