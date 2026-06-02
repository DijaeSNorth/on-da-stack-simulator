import { useGameStore } from '../../store/gameStore';
import { PlayerBattlefield } from './PlayerBattlefield';
import { DragCombatProvider, useDragCombatContext } from '../../hooks/DragCombatContext';
import { TriggerQueuePanel } from '../triggers/TriggerQueuePanel';
import type { Player } from '../../types/game';

// ── Combat Summary Bar ────────────────────────────────────────────────────────
// Shown during declareAttackers, declareBlockers, combatDamage, endOfCombat
// Gives every player a clear picture of the combat assignment state.

function CombatSummaryBar() {
  const store = useGameStore();
  const { game } = store;
  const combat = game.combat;
  const phase = game.phase;

  const isCombatPhase = [
    'declareAttackers', 'declareBlockers', 'combatDamage', 'endOfCombat'
  ].includes(phase);

  if (!isCombatPhase) return null;
  if (!combat.active && combat.attackers.length === 0) return null;

  const PHASE_LABEL: Record<string, string> = {
    declareAttackers: '⚔ Declare Attackers',
    declareBlockers: '🛡 Declare Blockers',
    combatDamage: '💥 Combat Damage',
    endOfCombat: '🔔 End of Combat',
  };

  return (
    <div
      data-testid="combat-summary-bar"
      style={{
        margin: '2px 4px 0',
        padding: '5px 12px',
        background: 'rgba(127,29,29,0.35)',
        border: '1px solid #7f1d1d',
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
        flexWrap: 'wrap',
        zIndex: 15,
      }}
    >
      {/* Phase label */}
      <span style={{ fontSize: 10, fontWeight: 800, color: '#fca5a5', letterSpacing: '0.05em', flexShrink: 0 }}>
        {PHASE_LABEL[phase] || phase}
      </span>

      {/* Attackers list */}
      {combat.attackers.length === 0 ? (
        <span style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>No attackers declared</span>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {combat.attackers.map(atk => {
            const card = game.cards[atk.instanceId];
            const target = game.players.find(p => p.id === atk.targetPlayerId);
            const blocker = combat.blockers.find(b => b.blockedAttacker === atk.instanceId);
            const blockerCard = blocker ? game.cards[blocker.instanceId] : null;

            return (
              <div
                key={atk.instanceId}
                data-testid={`combat-atk-${atk.instanceId}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid #7f1d1d',
                  borderRadius: 4,
                  padding: '2px 7px',
                  fontSize: 10,
                }}
              >
                {/* Attacker name */}
                <span style={{ color: '#fca5a5', fontWeight: 700 }}>
                  {card?.definition.name ?? atk.instanceId.slice(0, 8)}
                </span>
                {/* Power/toughness if creature */}
                {card?.definition.power !== undefined && (
                  <span style={{ color: '#f87171', fontSize: 9 }}>
                    {card.definition.power}/{card.definition.toughness}
                  </span>
                )}
                {/* Arrow to target */}
                <span style={{ color: '#ef444466', fontSize: 11 }}>→</span>
                <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                  {target?.name ?? '?'}
                </span>
                {/* Blocker info */}
                {blockerCard ? (
                  <>
                    <span style={{ color: '#3b82f6', fontSize: 11 }}>🛡</span>
                    <span style={{ color: '#93c5fd', fontWeight: 600, fontSize: 10 }}>
                      {blockerCard.definition.name}
                    </span>
                    {blockerCard.definition.power !== undefined && (
                      <span style={{ color: '#60a5fa', fontSize: 9 }}>
                        {blockerCard.definition.power}/{blockerCard.definition.toughness}
                      </span>
                    )}
                  </>
                ) : phase !== 'declareAttackers' ? (
                  <span style={{ color: '#f59e0b', fontSize: 9, fontStyle: 'italic' }}>unblocked</span>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Attacker count badge */}
      {combat.attackers.length > 0 && (
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: '#f87171' }}>
            {combat.attackers.length} attacker{combat.attackers.length !== 1 ? 's' : ''}
          </span>
          {combat.blockers.length > 0 && (
            <span style={{ fontSize: 9, color: '#60a5fa' }}>
              {combat.blockers.length} blocker{combat.blockers.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Commander table layouts — local player (seatIndex 0) always at bottom
function getPlayerLayout(playerCount: number): {
  top?: number[]; left?: number[]; right?: number[]; bottom: number[];
} {
  switch (playerCount) {
    case 2: return { top: [1], bottom: [0] };
    case 3: return { top: [1, 2], bottom: [0] };
    case 4: return { top: [2], left: [1], right: [3], bottom: [0] };
    case 5: return { top: [2, 3], left: [1], right: [4], bottom: [0] };
    case 6: return { top: [2, 3], left: [1], right: [4], bottom: [0, 5] };
    default: return { bottom: [0] };
  }
}

// ── Inner table uses drag context ─────────────────────────────────────────────

function CommanderTableInner() {
  const store = useGameStore();
  const game = store.game;
  const ui = store.ui;
  const drag = useDragCombatContext();
  const players = game.players;

  if (players.length === 0) return null;

  const layout = getPlayerLayout(players.length);
  const isActive = (p: Player) => p.id === game.activePlayerId;
  const getPlayers = (indices?: number[]) => (indices || []).map(i => players[i]).filter(Boolean);

  const topPlayers    = getPlayers(layout.top);
  const leftPlayers   = getPlayers(layout.left);
  const rightPlayers  = getPlayers(layout.right);
  const bottomPlayers = getPlayers(layout.bottom);
  const localPlayerId = store.localPlayerId;

  const sectionStyle = (side: 'top' | 'bottom' | 'left' | 'right'): React.CSSProperties => {
    const base: React.CSSProperties = { display: 'flex', gap: 2, flex: 1, overflow: 'hidden' };
    return (side === 'top' || side === 'bottom')
      ? { ...base, flexDirection: 'row' }
      : { ...base, flexDirection: 'column', maxWidth: '18%', minWidth: 120 };
  };

  function wrapPlayerSlot(player: Player, isLocal: boolean, compact: boolean) {
    const isDropTarget = drag.dropTarget?.id === player.id && drag.dropTarget?.type === 'player';
    const isDraggingAttack = drag.dragState?.mode === 'attack';
    // Opponent zones glow green when a valid attack drag is in progress
    const showDropGlow = isDraggingAttack && !isLocal;

    // Player zone is a drop target for attack drags
    const dropHandlers = !isLocal ? drag.playerDropHandlers(player.id) : {};

    return (
      <div
        key={player.id}
        style={{
          flex: 1,
          background: isActive(player)
            ? `linear-gradient(180deg, ${player.color}15, transparent)`
            : 'rgba(255,255,255,0.02)',
          border: isDropTarget
            ? `2px solid #22c55e`
            : showDropGlow
              ? `1px solid ${player.color}66`
              : `1px solid ${player.color}33`,
          borderRadius: 8,
          overflow: 'hidden',
          position: 'relative',
          minWidth: 0,
          minHeight: compact ? 80 : 120,
          transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: isDropTarget
            ? `0 0 20px 4px #22c55e44, inset 0 0 20px 2px #22c55e22`
            : 'none',
          cursor: isDraggingAttack && !isLocal ? 'copy' : undefined,
        }}
        {...dropHandlers}
      >
        <PlayerBattlefield
          player={player}
          isLocal={isLocal}
          isActive={isActive(player)}
          compact={compact}
        />

        {/* Drop overlay label */}
        {isDropTarget && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(34,197,94,0.08)',
            pointerEvents: 'none', zIndex: 10,
            borderRadius: 7,
          }}>
            <div style={{
              background: '#14532d', color: '#86efac',
              border: '1px solid #22c55e',
              borderRadius: 8, padding: '6px 14px',
              fontSize: 12, fontWeight: 700,
              boxShadow: '0 4px 12px rgba(34,197,94,0.3)',
            }}>
              ⚔ Attack {player.name}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="commander-table"
      style={{
        display: 'flex', flexDirection: 'column',
        width: '100%', height: '100%',
        gap: 2, boxSizing: 'border-box', padding: 4,
        background: '#0d1117',
        backgroundImage: `
          radial-gradient(circle at 50% 50%, rgba(59,130,246,0.03) 0%, transparent 60%),
          repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(255,255,255,0.015) 39px, rgba(255,255,255,0.015) 40px),
          repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(255,255,255,0.015) 39px, rgba(255,255,255,0.015) 40px)
        `,
      }}
    >
      {/* Global drag hint bar */}
      {drag.dragState && (
        <DragHintBar
          mode={drag.dragState.mode}
          hasMyriad={drag.dragState.hasMyriad}
          combatActive={game.combat.active}
        />
      )}

      {/* Combat summary — visible whenever combat phases are active */}
      <CombatSummaryBar />

      {/* Top opponents */}
      {topPlayers.length > 0 && (
        <div style={sectionStyle('top')}>
          {topPlayers.map(p => wrapPlayerSlot(p, p.id === localPlayerId, players.length >= 5))}
        </div>
      )}

      {/* Middle row */}
      {(leftPlayers.length > 0 || rightPlayers.length > 0) && (
        <div style={{ display: 'flex', flex: 1, gap: 2, overflow: 'hidden', minHeight: 0 }}>
          {leftPlayers.length > 0 && (
            <div style={sectionStyle('left')}>
              {leftPlayers.map(p => wrapPlayerSlot(p, p.id === localPlayerId, true))}
            </div>
          )}

          {/* Center surface — shows board context */}
          <div style={{
            flex: 1, background: 'rgba(255,255,255,0.01)',
            borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: 4,
          }}>
            <div style={{
              color: '#1e293b', fontSize: 11, fontWeight: 600,
              letterSpacing: '0.2em', textTransform: 'uppercase', userSelect: 'none',
            }}>
              Commander
            </div>
            {/* Turn + phase watermark */}
            <div style={{
              fontSize: 9, color: '#1a2540', fontWeight: 600,
              letterSpacing: '0.08em', textTransform: 'uppercase', userSelect: 'none',
            }}>
              T{game.turn} · {game.phase}
            </div>
          </div>

          {rightPlayers.length > 0 && (
            <div style={sectionStyle('right')}>
              {rightPlayers.map(p => wrapPlayerSlot(p, p.id === localPlayerId, true))}
            </div>
          )}
        </div>
      )}

      {/* Separator */}
      <div style={{
        height: 1,
        background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)',
        margin: '0 20px', flexShrink: 0,
      }} />

      {/* Bottom — local player */}
      <div style={{ ...sectionStyle('bottom'), maxHeight: '42%', flexShrink: 0 }}>
        {bottomPlayers.map(p => wrapPlayerSlot(p, p.id === localPlayerId, false))}
      </div>
    </div>
  );
}

// ── Drag hint bar ─────────────────────────────────────────────────────────────

function DragHintBar({ mode, hasMyriad, combatActive }: {
  mode: 'attack' | 'block' | null;
  hasMyriad: boolean;
  combatActive: boolean;
}) {
  if (!mode) return null;
  return (
    <div style={{
      position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
      zIndex: 20, background: mode === 'attack' ? '#7f1d1d' : '#1e3a5f',
      border: `1px solid ${mode === 'attack' ? '#ef4444' : '#3b82f6'}`,
      borderRadius: 20, padding: '4px 14px',
      color: mode === 'attack' ? '#fca5a5' : '#93c5fd',
      fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
      pointerEvents: 'none',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    }}>
      {mode === 'attack'
        ? hasMyriad
          ? '✦ Myriad — drop on an opponent to attack (and spawn copies)'
          : '⚔ Drop on an opponent\'s zone to attack'
        : '🛡 Drop on an attacking creature to block it'
      }
    </div>
  );
}

// ── Public export — wraps inner table in provider ─────────────────────────────

export function CommanderTable() {
  return (
    <DragCombatProvider>
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        <CommanderTableInner />
        {/* Floating trigger queue — renders as a fixed overlay when triggers are pending */}
        <TriggerQueuePanel />
      </div>
    </DragCombatProvider>
  );
}
