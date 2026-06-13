import { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { PlayerBattlefield } from './PlayerBattlefield';
import { DragCombatProvider, useDragCombatContext } from '../../hooks/DragCombatContext';
import { TriggerQueuePanel } from '../triggers/TriggerQueuePanel';
import { CardImage } from '../cards/CardImage';
import type { CardState, GameState, Player, StackObject } from '../../types/game';
import {
  chooseFocusedPlayerId,
  getPlayerBoardSummary,
  getTableViewModeLabel,
  isPlayerCombatRelevant,
  type TableViewMode,
} from './tableViewUiModel';

type CombatArrow = {
  id: string;
  kind: 'attack' | 'block';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
};

function findDataElement(root: HTMLElement, attr: string, value: string): HTMLElement | null {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(`[${attr}]`));
  return nodes.find(node => node.getAttribute(attr) === value) ?? null;
}

function getElementCenter(element: HTMLElement, rootRect: DOMRect): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - rootRect.left + rect.width / 2,
    y: rect.top - rootRect.top + rect.height / 2,
  };
}

function CombatArrowOverlay() {
  const game = useGameStore(s => s.game);
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const [arrows, setArrows] = useState<CombatArrow[]>([]);
  const signature = useMemo(() => {
    const attackers = game.combat.attackers.map(a => `${a.instanceId}:${a.targetPlayerId}`).join('|');
    const blockers = game.combat.blockers.map(b => `${b.instanceId}:${b.blockedAttacker}`).join('|');
    return `${game.phase}:${game.combat.active}:${attackers}:${blockers}`;
  }, [game.combat.active, game.combat.attackers, game.combat.blockers, game.phase]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const svg = overlayRef.current;
      const root = svg?.closest('[data-testid="commander-table"]') as HTMLElement | null;
      if (!svg || !root || game.combat.attackers.length === 0) {
        setArrows([]);
        return;
      }

      const rootRect = root.getBoundingClientRect();
      const next: CombatArrow[] = [];

      for (const attacker of game.combat.attackers) {
        const attackerEl = findDataElement(root, 'data-card-instance', attacker.instanceId);
        const targetEl = findDataElement(root, 'data-player-slot', attacker.targetPlayerId);
        const attackerCard = game.cards[attacker.instanceId];
        const targetPlayer = game.players.find(p => p.id === attacker.targetPlayerId);
        if (attackerEl && targetEl) {
          const from = getElementCenter(attackerEl, rootRect);
          const to = getElementCenter(targetEl, rootRect);
          next.push({
            id: `attack-${attacker.instanceId}-${attacker.targetPlayerId}`,
            kind: 'attack',
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            label: `${attackerCard?.definition.name ?? 'Attacker'} -> ${targetPlayer?.name ?? 'player'}`,
          });
        }
      }

      for (const blocker of game.combat.blockers) {
        const blockerEl = findDataElement(root, 'data-card-instance', blocker.instanceId);
        const attackerEl = findDataElement(root, 'data-card-instance', blocker.blockedAttacker);
        const blockerCard = game.cards[blocker.instanceId];
        const attackerCard = game.cards[blocker.blockedAttacker];
        if (blockerEl && attackerEl) {
          const from = getElementCenter(blockerEl, rootRect);
          const to = getElementCenter(attackerEl, rootRect);
          next.push({
            id: `block-${blocker.instanceId}-${blocker.blockedAttacker}`,
            kind: 'block',
            x1: from.x,
            y1: from.y,
            x2: to.x,
            y2: to.y,
            label: `${blockerCard?.definition.name ?? 'Blocker'} blocks ${attackerCard?.definition.name ?? 'attacker'}`,
          });
        }
      }

      setArrows(next);
    };

    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
    };
  }, [game.cards, game.combat.attackers, game.combat.blockers, game.players, signature]);

  if (game.combat.attackers.length === 0) return null;

  return (
    <svg
      ref={overlayRef}
      data-testid="combat-arrow-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 12,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      aria-hidden="true"
    >
      <defs>
        <marker id="attack-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#ef4444" />
        </marker>
        <marker id="block-arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#60a5fa" />
        </marker>
      </defs>
      {arrows.map(arrow => {
        const attack = arrow.kind === 'attack';
        const midX = (arrow.x1 + arrow.x2) / 2;
        const midY = (arrow.y1 + arrow.y2) / 2;
        return (
          <g key={arrow.id}>
            <line
              x1={arrow.x1}
              y1={arrow.y1}
              x2={arrow.x2}
              y2={arrow.y2}
              stroke={attack ? '#ef4444' : '#60a5fa'}
              strokeWidth={attack ? 3 : 2.5}
              strokeDasharray={attack ? undefined : '7 5'}
              strokeLinecap="round"
              markerEnd={`url(#${attack ? 'attack-arrowhead' : 'block-arrowhead'})`}
              opacity={attack ? 0.82 : 0.9}
            />
            <text
              x={midX}
              y={midY - 6}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={attack ? '#fecaca' : '#bfdbfe'}
              stroke="#020617"
              strokeWidth={3}
              paintOrder="stroke"
              fontSize={9}
              fontWeight={900}
            >
              {attack ? 'ATTACK' : 'BLOCK'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

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
            const blockerCards = combat.blockers
              .filter(b => b.blockedAttacker === atk.instanceId)
              .map(b => game.cards[b.instanceId])
              .filter(Boolean);

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
                {blockerCards.length > 0 ? (
                  <>
                    <span style={{ color: '#3b82f6', fontSize: 11 }}>🛡</span>
                    <span style={{ color: '#93c5fd', fontWeight: 600, fontSize: 10 }}>
                      {blockerCards.map(blockerCard =>
                        `${blockerCard.definition.name}${blockerCard.definition.power !== undefined ? ` ${blockerCard.definition.power}/${blockerCard.definition.toughness}` : ''}`
                      ).join(', ')}
                    </span>
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
function getStackTargetLabels(obj: StackObject, game: GameState): string[] {
  const labels = [...(obj.targetLabels ?? [])];
  for (const id of obj.targets ?? []) {
    const player = game.players.find(p => p.id === id);
    const card = game.cards[id];
    const label = player?.name ?? card?.definition.name;
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

function stackActionButton(background: string, color: string): React.CSSProperties {
  return {
    background,
    color,
    border: `1px solid ${color}55`,
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 9,
    fontWeight: 900,
    cursor: 'pointer',
  };
}

function cardHasKeyword(card: CardState, keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return card.definition.keywords.some(k => k.toLowerCase() === lower)
    || card.definition.oracleText.toLowerCase().includes(lower);
}

function canUseAsAttacker(card: CardState): boolean {
  if (!card.definition.cardTypes.includes('Creature')) return false;
  if (card.tapped || card.combatRole === 'attacker') return false;
  if (card.summoningSick && !cardHasKeyword(card, 'haste')) return false;
  if (cardHasKeyword(card, 'defender')) return false;
  return true;
}

function canUseAsBlocker(card: CardState): boolean {
  if (!card.definition.cardTypes.includes('Creature')) return false;
  if (card.tapped || card.combatRole === 'blocker') return false;
  if (cardHasKeyword(card, "can't block")) return false;
  return true;
}

function cardOptionLabel(card: CardState): string {
  const power = card.definition.power ?? '?';
  const toughness = card.definition.toughness ?? '?';
  return `${card.definition.name} (${power}/${toughness})`;
}

function combatSelectStyle(disabled = false): React.CSSProperties {
  return {
    minWidth: 130,
    maxWidth: 220,
    height: 28,
    background: disabled ? 'rgba(15,23,42,0.55)' : '#0b1220',
    color: disabled ? '#475569' : '#e2e8f0',
    border: '1px solid #334155',
    borderRadius: 4,
    padding: '0 7px',
    fontSize: 10,
    fontWeight: 700,
  };
}

function combatButtonStyle(kind: 'attack' | 'block' | 'phase', disabled = false): React.CSSProperties {
  const colors = {
    attack: { bg: '#7f1d1d', fg: '#fecaca', border: '#ef4444' },
    block: { bg: '#1e3a5f', fg: '#bfdbfe', border: '#60a5fa' },
    phase: { bg: '#1e293b', fg: '#cbd5e1', border: '#64748b' },
  }[kind];
  return {
    height: 28,
    borderRadius: 4,
    border: `1px solid ${colors.border}`,
    background: disabled ? 'rgba(15,23,42,0.55)' : colors.bg,
    color: disabled ? '#475569' : colors.fg,
    padding: '0 9px',
    fontSize: 10,
    fontWeight: 900,
    cursor: disabled ? 'default' : 'pointer',
    whiteSpace: 'nowrap',
  };
}

function CombatDeclarationDock() {
  const store = useGameStore();
  const { game, localPlayerId } = store;
  const activePlayer = game.players.find(player => player.id === game.activePlayerId);
  const localPlayer = game.players.find(player => player.id === localPlayerId);

  const attackOptions = useMemo(() => {
    if (!activePlayer || activePlayer.id !== localPlayerId) return [];
    return activePlayer.battlefield
      .map(id => game.cards[id])
      .filter((card): card is CardState => Boolean(card) && canUseAsAttacker(card));
  }, [activePlayer, game.cards, localPlayerId]);

  const targetOptions = useMemo(() => (
    game.players.filter(player => player.id !== activePlayer?.id)
  ), [activePlayer?.id, game.players]);

  const blockableAttackers = useMemo(() => {
    if (!localPlayer) return [];
    return game.combat.attackers
      .filter(attacker => attacker.targetPlayerId === localPlayer.id)
      .map(attacker => game.cards[attacker.instanceId])
      .filter((card): card is CardState => Boolean(card));
  }, [game.cards, game.combat.attackers, localPlayer]);

  const blockerOptions = useMemo(() => {
    if (!localPlayer) return [];
    return localPlayer.battlefield
      .map(id => game.cards[id])
      .filter((card): card is CardState => Boolean(card) && canUseAsBlocker(card));
  }, [game.cards, localPlayer]);

  const [selectedAttackerId, setSelectedAttackerId] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [selectedBlockerId, setSelectedBlockerId] = useState('');
  const [selectedBlockedAttackerId, setSelectedBlockedAttackerId] = useState('');

  useEffect(() => {
    if (!attackOptions.some(card => card.instanceId === selectedAttackerId)) {
      setSelectedAttackerId(attackOptions[0]?.instanceId ?? '');
    }
  }, [attackOptions, selectedAttackerId]);

  useEffect(() => {
    if (!targetOptions.some(player => player.id === selectedTargetId)) {
      setSelectedTargetId(targetOptions[0]?.id ?? '');
    }
  }, [targetOptions, selectedTargetId]);

  useEffect(() => {
    if (!blockerOptions.some(card => card.instanceId === selectedBlockerId)) {
      setSelectedBlockerId(blockerOptions[0]?.instanceId ?? '');
    }
  }, [blockerOptions, selectedBlockerId]);

  useEffect(() => {
    if (!blockableAttackers.some(card => card.instanceId === selectedBlockedAttackerId)) {
      setSelectedBlockedAttackerId(blockableAttackers[0]?.instanceId ?? '');
    }
  }, [blockableAttackers, selectedBlockedAttackerId]);

  const canDeclareAttack = Boolean(selectedAttackerId && selectedTargetId);
  const canDeclareBlock = Boolean(selectedBlockerId && selectedBlockedAttackerId);
  const showDock = attackOptions.length > 0 || game.combat.attackers.length > 0 || game.phase === 'declareAttackers' || game.phase === 'declareBlockers';

  if (!showDock) return null;

  const declareAttack = () => {
    if (!canDeclareAttack) return;
    if (!game.combat.active) store.enterCombat();
    store.declareAttack(selectedAttackerId, selectedTargetId);
  };

  const declareBlock = () => {
    if (!canDeclareBlock) return;
    store.declareBlock(selectedBlockerId, selectedBlockedAttackerId);
  };

  return (
    <div
      data-testid="combat-declaration-dock"
      style={{
        margin: '2px 4px 0',
        padding: '6px 8px',
        borderRadius: 6,
        border: '1px solid rgba(100,116,139,0.45)',
        background: 'rgba(15,23,42,0.78)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        zIndex: 15,
      }}
    >
      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Declare
      </span>

      <select
        aria-label="Attacker"
        value={selectedAttackerId}
        onChange={event => setSelectedAttackerId(event.target.value)}
        disabled={attackOptions.length === 0}
        style={combatSelectStyle(attackOptions.length === 0)}
      >
        {attackOptions.length === 0 ? (
          <option value="">No attackers</option>
        ) : attackOptions.map(card => (
          <option key={card.instanceId} value={card.instanceId}>{cardOptionLabel(card)}</option>
        ))}
      </select>

      <select
        aria-label="Attack target"
        value={selectedTargetId}
        onChange={event => setSelectedTargetId(event.target.value)}
        disabled={targetOptions.length === 0}
        style={combatSelectStyle(targetOptions.length === 0)}
      >
        {targetOptions.map(player => (
          <option key={player.id} value={player.id}>Attack {player.name}</option>
        ))}
      </select>

      <button
        type="button"
        data-testid="declare-attack-button"
        disabled={!canDeclareAttack}
        onClick={declareAttack}
        style={combatButtonStyle('attack', !canDeclareAttack)}
      >
        Declare Attack
      </button>

      <button
        type="button"
        disabled={game.combat.attackers.length === 0}
        onClick={() => store.goToPhase('declareBlockers')}
        style={combatButtonStyle('phase', game.combat.attackers.length === 0)}
      >
        Blockers Step
      </button>

      <select
        aria-label="Blocker"
        value={selectedBlockerId}
        onChange={event => setSelectedBlockerId(event.target.value)}
        disabled={blockerOptions.length === 0}
        style={combatSelectStyle(blockerOptions.length === 0)}
      >
        {blockerOptions.length === 0 ? (
          <option value="">No blockers</option>
        ) : blockerOptions.map(card => (
          <option key={card.instanceId} value={card.instanceId}>{cardOptionLabel(card)}</option>
        ))}
      </select>

      <select
        aria-label="Blocked attacker"
        value={selectedBlockedAttackerId}
        onChange={event => setSelectedBlockedAttackerId(event.target.value)}
        disabled={blockableAttackers.length === 0}
        style={combatSelectStyle(blockableAttackers.length === 0)}
      >
        {blockableAttackers.length === 0 ? (
          <option value="">No incoming attackers</option>
        ) : blockableAttackers.map(card => (
          <option key={card.instanceId} value={card.instanceId}>Block {cardOptionLabel(card)}</option>
        ))}
      </select>

      <button
        type="button"
        data-testid="declare-block-button"
        disabled={!canDeclareBlock}
        onClick={declareBlock}
        style={combatButtonStyle('block', !canDeclareBlock)}
      >
        Declare Block
      </button>
    </div>
  );
}

function BattlefieldStackShowcase() {
  const store = useGameStore();
  const { game } = store;
  if (game.stack.length === 0) return null;

  return (
    <div
      data-testid="battlefield-stack-showcase"
      style={{
        position: 'absolute',
        top: 46,
        right: 10,
        zIndex: 18,
        width: 'min(380px, calc(100% - 20px))',
        maxHeight: '38%',
        overflow: 'auto',
        pointerEvents: 'auto',
      }}
    >
      <div style={{
        padding: 10,
        borderRadius: 8,
        border: '1px solid rgba(96,165,250,0.65)',
        background: 'linear-gradient(135deg, rgba(15,23,42,0.94), rgba(8,13,17,0.9))',
        boxShadow: '0 16px 38px rgba(15,23,42,0.58), 0 0 18px rgba(59,130,246,0.16)',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        }}>
          <span style={{ color: '#93c5fd', fontSize: 10, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            On the Stack
          </span>
          <span style={{ color: '#64748b', fontSize: 10 }}>
            {game.stack.length} item{game.stack.length === 1 ? '' : 's'}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {game.stack.map((obj, index) => {
            const card = obj.sourceInstanceId ? game.cards[obj.sourceInstanceId] : undefined;
            const controller = game.players.find(p => p.id === obj.controllerId);
            const targets = getStackTargetLabels(obj, game);
            const isTop = index === 0;
            return (
              <div
                key={obj.id}
                data-testid={`battlefield-stack-item-${obj.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: card ? '42px minmax(0, 1fr) auto' : 'minmax(0, 1fr) auto',
                  gap: 8,
                  alignItems: 'center',
                  padding: 7,
                  borderRadius: 7,
                  border: `1px solid ${isTop ? '#60a5fa' : '#334155'}`,
                  background: isTop ? 'rgba(59,130,246,0.16)' : 'rgba(15,23,42,0.72)',
                }}
              >
                {card && (
                  <div style={{ width: 40, transform: isTop ? 'rotate(-2deg)' : 'none' }}>
                    <CardImage card={card} size="compact" />
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    {isTop && (
                      <span style={{ color: '#020617', background: '#60a5fa', borderRadius: 3, padding: '1px 5px', fontSize: 8, fontWeight: 900 }}>
                        TOP
                      </span>
                    )}
                    <span style={{ color: '#f8fafc', fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {obj.sourceName}
                    </span>
                    <span style={{ color: obj.type === 'spell' ? '#93c5fd' : '#a8a29e', fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }}>
                      {obj.type}
                    </span>
                  </div>
                  <div style={{ marginTop: 3, fontSize: 10, color: '#94a3b8' }}>
                    Cast by {controller?.name ?? obj.controllerId}
                  </div>
                  {targets.length > 0 && (
                    <div style={{ marginTop: 3, fontSize: 10, color: '#fbbf24', fontWeight: 800 }}>
                      Target: {targets.join(', ')}
                    </div>
                  )}
                </div>
                {isTop && (
                  <div style={{ display: 'flex', gap: 5, flexDirection: 'column' }}>
                    <button data-testid="battlefield-resolve-stack" onClick={store.resolveStack} style={stackActionButton('#14532d', '#86efac')}>
                      Resolve
                    </button>
                    <button data-testid="battlefield-counter-stack" onClick={() => store.counterSpell(obj.id)} style={stackActionButton('#7f1d1d', '#fca5a5')}>
                      Counter
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function getPlayerLayout(playerCount: number): {
  top?: number[]; left?: number[]; right?: number[]; bottom: number[];
} {
  switch (playerCount) {
    case 2: return { top: [1], bottom: [0] };
    case 3: return { top: [1, 2], bottom: [0] };
    case 4: return { top: [2, 3], bottom: [0, 1] };
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
  const hasSidePlayers = leftPlayers.length > 0 || rightPlayers.length > 0;
  const tableViewMode = ui.tableViewMode;
  const focusedPlayerId = chooseFocusedPlayerId(game, ui.focusedPlayerId, localPlayerId);
  const showCompactGrid = tableViewMode === 'compact';
  const showCombatFocus = tableViewMode === 'combat' && (game.combat.active || game.combat.attackers.length > 0);

  const sectionStyle = (side: 'top' | 'bottom' | 'left' | 'right'): React.CSSProperties => {
    const base: React.CSSProperties = { display: 'flex', gap: 2, flex: 1, overflow: 'hidden', minHeight: 0, minWidth: 0 };
    return (side === 'top' || side === 'bottom')
      ? { ...base, flexDirection: 'row' }
      : { ...base, flexDirection: 'column', maxWidth: '18%', minWidth: 120 };
  };

  const centerSurfaceStyle: React.CSSProperties = {
    flex: 1,
    background: 'rgba(255,255,255,0.01)',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.04)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 10,
  };

  function wrapPlayerSlot(player: Player, isLocal: boolean, compact: boolean) {
    const isDropTarget = drag.dropTarget?.id === player.id && drag.dropTarget?.type === 'player';
    const isDraggingAttack = drag.dragState?.mode === 'attack';
    const isFocused = tableViewMode === 'focused' && player.id === focusedPlayerId;
    const combatRelevant = showCombatFocus && isPlayerCombatRelevant(game, player.id);
    const collapsedByFocus = tableViewMode === 'focused' && !isFocused;
    const collapsedByCombat = showCombatFocus && !combatRelevant;
    const effectiveCompact = compact || collapsedByFocus || collapsedByCombat;
    // Opponent zones glow green when a valid attack drag is in progress
    const showDropGlow = isDraggingAttack && !isLocal;

    // Player zone is a drop target for attack drags
    const dropHandlers = !isLocal ? drag.playerDropHandlers(player.id) : {};

    return (
      <div
        key={player.id}
        data-player-slot={player.id}
        style={{
          flex: isFocused ? 2.2 : combatRelevant ? 1.6 : collapsedByFocus || collapsedByCombat ? 0.48 : 1,
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
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          maxWidth: '100%',
          minHeight: effectiveCompact ? 76 : isFocused ? 190 : 120,
          maxHeight: '100%',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow: isDropTarget
            ? `0 0 20px 4px #22c55e44, inset 0 0 20px 2px #22c55e22`
            : 'none',
          cursor: isDraggingAttack && !isLocal ? 'copy' : undefined,
        }}
        onClick={() => {
          if (!drag.dragState) {
            store.setFocusedPlayer(player.id);
            if (tableViewMode === 'table') store.setTableViewMode('focused');
          }
        }}
        {...dropHandlers}
      >
        <PlayerBattlefield
          player={player}
          isLocal={isLocal}
          isActive={isActive(player)}
          compact={effectiveCompact}
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
        position: 'relative',
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
      <TableViewToolbar
        mode={tableViewMode}
        playerCount={players.length}
        combatActive={game.combat.active || game.combat.attackers.length > 0}
        label={getTableViewModeLabel(tableViewMode)}
        onModeChange={(mode) => store.setTableViewMode(mode)}
      />

      <CombatSummaryBar />
      <CombatDeclarationDock />
      <CombatArrowOverlay />

      <BattlefieldStackShowcase />

      {showCompactGrid ? (
        <div
          data-testid="compact-board-grid"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: `repeat(${players.length >= 4 ? 2 : 1}, minmax(0, 1fr))`,
            gap: 8,
            padding: 8,
            overflow: 'auto',
          }}
        >
          {players.map(player => (
            <PlayerBoardSummaryCard
              key={player.id}
              player={player}
              summary={getPlayerBoardSummary(game, player)}
              focused={player.id === focusedPlayerId}
              onFocus={() => {
                store.setFocusedPlayer(player.id);
                store.setTableViewMode('focused');
              }}
            />
          ))}
        </div>
      ) : (
        <>

      {/* Top opponents */}
      {topPlayers.length > 0 && (
        <div style={sectionStyle('top')}>
          {topPlayers.map(p => wrapPlayerSlot(p, p.id === localPlayerId, players.length >= 5))}
        </div>
      )}

      {!hasSidePlayers && (
        <div style={{ ...centerSurfaceStyle, flex: 0.7, minHeight: 150 }} />
      )}

      {/* Middle row */}
      {hasSidePlayers && (
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

      {/* Bottom - local player */}
      <div style={{ ...sectionStyle('bottom'), maxHeight: '42%', flexShrink: 0 }}>
        {bottomPlayers.map(p => wrapPlayerSlot(p, p.id === localPlayerId, false))}
      </div>
        </>
      )}
    </div>
  );
}

// ── Drag hint bar ─────────────────────────────────────────────────────────────

function TableViewToolbar({
  mode,
  playerCount,
  combatActive,
  label,
  onModeChange,
}: {
  mode: TableViewMode;
  playerCount: number;
  combatActive: boolean;
  label: string;
  onModeChange: (mode: TableViewMode) => void;
}) {
  const modes: Array<{ mode: TableViewMode; label: string; disabled?: boolean }> = [
    { mode: 'table', label: 'Table' },
    { mode: 'focused', label: 'Focus' },
    { mode: 'combat', label: 'Combat', disabled: !combatActive },
    { mode: 'compact', label: 'Grid', disabled: playerCount < 3 },
  ];
  return (
    <div
      data-testid="table-view-toolbar"
      title={label}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 19,
        display: 'flex',
        gap: 4,
        padding: 4,
        borderRadius: 999,
        border: '1px solid rgba(71,85,105,0.55)',
        background: 'rgba(15,23,42,0.78)',
        boxShadow: '0 10px 28px rgba(0,0,0,0.28)',
      }}
    >
      {modes.map(item => (
        <button
          key={item.mode}
          type="button"
          data-testid={`table-view-mode-${item.mode}`}
          disabled={item.disabled}
          onClick={() => onModeChange(item.mode)}
          style={{
            border: `1px solid ${mode === item.mode ? '#60a5fa' : 'rgba(100,116,139,0.45)'}`,
            background: mode === item.mode ? 'rgba(37,99,235,0.34)' : 'rgba(15,23,42,0.62)',
            color: item.disabled ? '#475569' : mode === item.mode ? '#dbeafe' : '#94a3b8',
            borderRadius: 999,
            padding: '3px 8px',
            fontSize: 9,
            fontWeight: 900,
            cursor: item.disabled ? 'default' : 'pointer',
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function PlayerBoardSummaryCard({
  player,
  summary,
  focused,
  onFocus,
}: {
  player: Player;
  summary: ReturnType<typeof getPlayerBoardSummary>;
  focused: boolean;
  onFocus: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`compact-player-summary-${player.id}`}
      onClick={onFocus}
      style={{
        textAlign: 'left',
        border: `1px solid ${focused ? '#60a5fa' : `${player.color}55`}`,
        borderRadius: 12,
        background: focused ? 'rgba(37,99,235,0.18)' : 'rgba(15,23,42,0.72)',
        padding: 12,
        color: '#cbd5e1',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 132,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#f8fafc', fontSize: 13, fontWeight: 900, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {player.name}
          </div>
          <div style={{ color: summary.connected ? '#86efac' : '#fca5a5', fontSize: 9, fontWeight: 800 }}>
            {summary.connected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
        <div style={{ color: player.color, fontSize: 22, fontWeight: 1000 }}>{player.life}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        <SummaryStat label="Hand" value={summary.handCount} />
        <SummaryStat label="Library" value={summary.libraryCount} />
        <SummaryStat label="Perms" value={summary.permanents} />
        <SummaryStat label="Creatures" value={summary.creatures} />
        <SummaryStat label="Tokens" value={summary.tokens} />
        <SummaryStat label="Blockers" value={summary.untappedBlockers} />
        <SummaryStat label="A/E" value={summary.artifactsEnchantments} />
        <SummaryStat label="Lands" value={summary.lands} />
        <SummaryStat label="Walkers" value={summary.planeswalkers} />
      </div>
      {(summary.isAttackingPlayer || summary.isDefendingPlayer) && (
        <div style={{ display: 'flex', gap: 6 }}>
          {summary.isAttackingPlayer && <span style={combatTagStyle('#7f1d1d', '#fecaca')}>Attacking</span>}
          {summary.isDefendingPlayer && <span style={combatTagStyle('#1e3a5f', '#bfdbfe')}>Defending</span>}
        </div>
      )}
    </button>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ border: '1px solid rgba(71,85,105,0.4)', borderRadius: 7, padding: '4px 5px', background: 'rgba(2,6,23,0.42)' }}>
      <span style={{ display: 'block', color: '#64748b', fontSize: 8, fontWeight: 900, textTransform: 'uppercase' }}>{label}</span>
      <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 900 }}>{value}</span>
    </span>
  );
}

function combatTagStyle(background: string, color: string): React.CSSProperties {
  return {
    borderRadius: 999,
    background,
    color,
    padding: '2px 7px',
    fontSize: 9,
    fontWeight: 900,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
  };
}

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


