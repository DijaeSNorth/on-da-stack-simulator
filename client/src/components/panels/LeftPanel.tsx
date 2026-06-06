import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { Player } from '../../types/game';
import { TutorialTooltip } from '../tutorial/TutorialTooltip';
import { TOOLTIPS } from '../../store/tutorialStore';
import { getPhaseLabel } from '../../engine/phaseMeta';
import { PlayerAvatar } from '../profile/PlayerAvatar';
import type { CardState } from '../../types/game';

function CommanderLifeIcon({ commander }: { commander?: CardState }) {
  const name = commander?.definition.name ?? 'Commander';
  const imageUrl = commander?.definition.imageUrl;
  return (
    <div
      data-testid={`commander-life-icon-${commander?.ownerId ?? 'empty'}`}
      title={commander ? `${name} - commander` : 'Commander'}
      style={{
        width: 32,
        height: 32,
        borderRadius: '50%',
        border: '2px solid #fbbf24',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #1f2937, #451a03)',
        color: '#fbbf24',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        fontWeight: 900,
        flexShrink: 0,
        boxShadow: '0 0 14px rgba(251,191,36,0.28)',
      }}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: '50% 18%',
            display: 'block',
          }}
        />
      ) : (
        <span aria-hidden="true">C</span>
      )}
    </div>
  );
}

function LifeCounter({ player, commander, onChange }: { player: Player; commander?: CardState; onChange: (delta: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <CommanderLifeIcon commander={commander} />
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
  const [revealedTopPlayers, setRevealedTopPlayers] = useState<Set<string>>(new Set());
  const phaseLabel = getPhaseLabel(game.phase);
  const phaseBlocked = game.stack.length > 0;

  if (!ui.leftPanelOpen) return null;

  const players = game.players;

  return (
    <div
      data-testid="left-panel"
      style={{
        width: '100%',
        background: '#111827',
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
          const isDeckOwner = player.id === localPlayerId;
          const topLibraryCard = player.library[0] ? game.cards[player.library[0]] : undefined;
          const revealTop = revealedTopPlayers.has(player.id);
          const bfCount = player.battlefield.length;
          const commanderCard = player.commanders.map(id => game.cards[id]).find(Boolean);
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 6 }}>
                <PlayerAvatar
                  name={player.name}
                  color={player.color}
                  initial={player.avatarInitial ?? player.name.slice(0, 1)}
                  styleMode={player.avatarStyle}
                  image={player.avatarImage}
                  size={28}
                />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', maxWidth: 82, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 'auto' }}>
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
                commander={commanderCard}
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
                  data-help-title="Draw Card"
                  data-help-body="Draws from this player's library into their hand and writes the draw to the shared timeline."
                  data-help-example="Use Draw during draw step, card effects, or solo testing."
                  onClick={(e) => { e.stopPropagation(); store.drawCard(player.id); }}
                  style={{
                    fontSize: 9, padding: '2px 6px',
                    background: '#1e3a5f', color: '#93c5fd',
                    border: 'none', borderRadius: 3, cursor: 'pointer',
                  }}
                >Draw</button>
                {isDeckOwner && (
                  <>
                    <button
                      data-testid={`btn-shuffle-${player.id}`}
                      data-help-title="Shuffle Library"
                      data-help-body="Shuffles your library and logs the shuffle. Only the deck owner gets this quick control."
                      data-help-example="Use after tutors, fetches, or deck-builder reloads."
                      onClick={(e) => { e.stopPropagation(); store.shuffleLibrary(player.id); }}
                      style={{
                        fontSize: 9, padding: '2px 6px',
                        background: '#123642', color: '#67e8f9',
                        border: 'none', borderRadius: 3, cursor: 'pointer',
                      }}
                    >Shuffle</button>
                    <button
                      data-testid={`btn-reveal-top-${player.id}`}
                      data-help-title="Reveal Top Card"
                      data-help-body="Shows the top card only to the deck owner for practice and logs the reveal toggle. It is useful for known-top-library effects."
                      data-help-example="Turn it off again when the effect ends."
                      aria-pressed={revealTop}
                      onClick={(e) => {
                        e.stopPropagation();
                        const nextReveal = !revealedTopPlayers.has(player.id);
                        setRevealedTopPlayers(prev => {
                          const next = new Set(prev);
                          if (next.has(player.id)) next.delete(player.id);
                          else next.add(player.id);
                          return next;
                        });
                        store.logAction(player.id, 'OTHER', `${player.name} toggled top-card reveal ${nextReveal ? 'on' : 'off'}.`);
                      }}
                      style={{
                        fontSize: 9, padding: '2px 6px',
                        background: revealTop ? '#713f12' : '#1e293b',
                        color: revealTop ? '#fde68a' : '#94a3b8',
                        border: `1px solid ${revealTop ? '#f59e0b' : '#334155'}`,
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >Reveal Top</button>
                  </>
                )}
                <TutorialTooltip content={TOOLTIPS.zone_graveyard} placement="top" delay={500}>
                  <button
                    data-testid={`btn-open-graveyard-${player.id}`}
                    data-help-title="View Graveyard"
                    data-help-body="Opens this player's graveyard so you can inspect cards, move them, or review what has resolved this game."
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
                    data-help-title="View Exile"
                    data-help-body="Opens this player's exile zone for cards exiled by spells, abilities, replacement effects, or cleanup."
                    onClick={(e) => { e.stopPropagation(); store.openZoneDrawer('exile', player.id); }}
                    style={{
                      fontSize: 9, padding: '2px 6px',
                      background: '#1c1917', color: '#78716c',
                      border: '1px solid #292524', borderRadius: 3, cursor: 'pointer',
                    }}
                  >Ex ({player.exile.length})</button>
                </TutorialTooltip>
              </div>
              {isDeckOwner && revealTop && (
                <div
                  data-testid={`revealed-top-card-${player.id}`}
                  style={{
                    marginTop: 5,
                    padding: '4px 6px',
                    borderRadius: 4,
                    background: 'rgba(113,63,18,0.24)',
                    border: '1px solid #713f12',
                    color: '#fde68a',
                    fontSize: 9,
                    lineHeight: 1.3,
                  }}
                >
                  Top: {topLibraryCard?.definition.name ?? 'Library empty'}
                  {topLibraryCard?.definition.typeLine && (
                    <span style={{ color: '#a8a29e' }}> - {topLibraryCard.definition.typeLine}</span>
                  )}
                </div>
              )}
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
            data-help-title={phaseBlocked ? 'Advance And Flag' : 'Next Phase'}
            data-help-body={phaseBlocked ? 'Moves to the next phase even though the stack still has items. The judge assistant will flag it for review.' : 'Moves to the next phase using the guided turn order.'}
            data-help-example="Use the phase guide bar above the table for more precise jumps."
            aria-label={phaseBlocked ? 'Advance phase with stack pending' : `Advance from ${phaseLabel} to the next phase`}
            onClick={store.advancePhase}
            title={phaseBlocked ? 'Advance anyway and let the assistant flag the pending stack' : 'Advance to next phase'}
            style={{
              flex: 1, padding: '5px 0',
              background: phaseBlocked ? '#78350f' : '#1d4ed8',
              color: phaseBlocked ? '#fcd34d' : '#fff',
              border: 'none', borderRadius: 4,
              cursor: 'pointer',
              fontSize: 10, fontWeight: 700,
            }}
          >{phaseBlocked ? 'Advance + Flag' : 'Next Phase'}</button>
          <button
            data-testid="btn-next-turn"
            data-help-title="End Turn"
            data-help-body="Ends the current turn and moves to the next player. Check end-step triggers, cleanup, and hand size before using it."
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
