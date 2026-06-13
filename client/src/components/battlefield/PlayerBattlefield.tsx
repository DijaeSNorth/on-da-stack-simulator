import { useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CardImage } from '../cards/CardImage';
import { useDragCombatContext } from '../../hooks/DragCombatContext';
import { PlayerAvatar } from '../profile/PlayerAvatar';
import { TokenStackAttackModal } from '../combat/TokenStackAttackModal';
import type { CardState, Player } from '../../types/game';
import {
  buildBattlefieldView,
  type BattlefieldDensityMode,
  type BattlefieldFilterChip,
  type BattlefieldSection,
  type BattlefieldSectionKey,
} from './battlefieldUiModel';

interface TokenCloud {
  key: string;
  cards: CardState[];
  name: string;
  power: string;
  toughness: string;
  tappedCount: number;
  counters: { type: string; total: number }[];
}

function groupTokenClouds(cards: CardState[], threshold = 3): { singles: CardState[]; clouds: TokenCloud[] } {
  const tokenGroups = new Map<string, CardState[]>();
  const singles: CardState[] = [];

  for (const card of cards) {
    if (card.token && card.definition.power !== undefined) {
      const key = `${card.definition.name}-${card.definition.power}-${card.definition.toughness}`;
      if (!tokenGroups.has(key)) tokenGroups.set(key, []);
      tokenGroups.get(key)!.push(card);
    } else {
      singles.push(card);
    }
  }

  const clouds: TokenCloud[] = [];
  for (const [key, group] of tokenGroups) {
    if (group.length >= threshold) {
      const def = group[0].definition;
      const tappedCount = group.filter(c => c.tapped).length;
      const counterMap = new Map<string, number>();
      for (const card of group) {
        for (const c of card.counters) {
          counterMap.set(c.type, (counterMap.get(c.type) || 0) + c.count);
        }
      }
      clouds.push({
        key,
        cards: group,
        name: def.name,
        power: def.power || '?',
        toughness: def.toughness || '?',
        tappedCount,
        counters: [...counterMap.entries()].map(([type, total]) => ({ type, total })),
      });
    } else {
      for (const c of group) singles.push(c);
    }
  }

  return { singles, clouds };
}

interface PlayerBattlefieldProps {
  player: Player;
  isLocal?: boolean;
  isActive?: boolean;
  compact?: boolean;
}

type ScaledCardSize = {
  size: 'normal' | 'compact';
  width: number;
  height: number;
  gap: number;
  zoneGap: number;
};

function getBattlefieldCardDensity(cardCount: number, compact: boolean): ScaledCardSize {
  if (compact || cardCount > 28) {
    return {
      size: 'compact',
      width: 33,
      height: 46,
      gap: 2,
      zoneGap: 4,
    };
  }
  if (cardCount > 20) {
    return {
      size: 'compact',
      width: 40,
      height: 55,
      gap: 2,
      zoneGap: 5,
    };
  }
  if (cardCount > 14) {
    return {
      size: 'normal',
      width: 58,
      height: 82,
      gap: 3,
      zoneGap: 6,
    };
  }
  return {
    size: 'normal',
    width: 74,
    height: 103,
    gap: 4,
    zoneGap: 8,
  };
}

export function PlayerBattlefield({ player, isLocal, isActive, compact }: PlayerBattlefieldProps) {
  const store = useGameStore();
  const { game, ui, localPlayerId } = store;
  const readOnly = ui.screen === 'replay';
  const drag = useDragCombatContext();
  const [expandedClouds, setExpandedClouds] = useState<Set<string>>(new Set());
  const [cloudSplits, setCloudSplits] = useState<Record<string, number>>({});
  const [cloudAttackCounts, setCloudAttackCounts] = useState<Record<string, number>>({});
  const [cloudAttackTargets, setCloudAttackTargets] = useState<Record<string, string>>({});
  const [cloudSplitDrafts, setCloudSplitDrafts] = useState<Record<string, number>>({});
  const [tokenStackModal, setTokenStackModal] = useState<{ sourceGroupId: string; cards: CardState[] } | null>(null);
  const [battlefieldSearch, setBattlefieldSearch] = useState('');
  const [activeFilters, setActiveFilters] = useState<Set<BattlefieldFilterChip>>(() => new Set());
  const [densityMode, setDensityMode] = useState<BattlefieldDensityMode | 'auto'>('auto');
  const [collapsedSections, setCollapsedSections] = useState<Set<BattlefieldSectionKey>>(() => new Set([
    ...(ui.settings.collapseLandsByDefault ? ['lands' as BattlefieldSectionKey] : []),
    ...(ui.settings.collapseTokensByDefault ? ['tokens' as BattlefieldSectionKey] : []),
  ]));
  const lastTouchTapRef = useRef<{ id: string; time: number; x: number; y: number } | null>(null);

  const cards = player.battlefield.map(id => game.cards[id]).filter(Boolean) as CardState[];
  const battlefieldView = useMemo(() => buildBattlefieldView(cards, {
    search: battlefieldSearch,
    filters: activeFilters,
    forcedDensity: densityMode,
    compact,
    combatActive: game.combat.active,
  }), [activeFilters, battlefieldSearch, cards, compact, densityMode, game.combat.active]);

  const visibleCards = battlefieldView.filteredCards;
  const tokens = visibleCards.filter(c => c.token);
  const { singles: tokenSingles, clouds: tokenClouds } = groupTokenClouds(tokens, ui.settings.tokenStackThreshold);

  const scaledCard = getBattlefieldCardDensity(cards.length, !!compact || battlefieldView.density !== 'normal');
  const cardSize = scaledCard.size;
  const gap = scaledCard.gap;
  const zoneGap = scaledCard.zoneGap;
  const hasWideBoard = cards.length > (compact ? 8 : 12);
  const cardImageStyle: React.CSSProperties = {
    width: scaledCard.width,
    height: scaledCard.height,
  };

  // ── Drag-combat visual state ───────────────────────────────────────────────
  // During an attack drag, own creatures that are valid attackers should glow
  // During a block drag, opponent's attacking creatures should show drop targets
  const isDraggingAttack = drag.dragState?.mode === 'attack';
  const isDraggingBlock  = drag.dragState?.mode === 'block';
  const combatActive     = game.combat.active;

  function handleCardClick(e: React.MouseEvent, instanceId: string) {
    e.preventDefault();
    if (e.type === 'contextmenu') {
      store.openCardContextMenu(instanceId, e.clientX, e.clientY);
    } else {
      store.setSelectedCard(instanceId);
      store.setCardPreview(instanceId, { x: e.clientX, y: e.clientY });
    }
  }

  function toggleTapped(card: CardState) {
    if (readOnly) return;
    if (!isLocal || card.zone !== 'battlefield') return;
    if (card.tapped) store.untapCard(card.instanceId);
    else store.tapCard(card.instanceId);
  }

  function getCountersLabel(card: CardState): string {
    const activeCounters = (card.counters ?? []).filter(counter => counter.count > 0);
    if (activeCounters.length === 0) return '';
    return activeCounters.map(counter => `${counter.type}:${counter.count}`).join(' ');
  }

  function getStatLabel(card: CardState): string {
    if (card.definition.power !== undefined || card.definition.toughness !== undefined) {
      const override = card.powerToughnessOverride;
      return `${override?.power ?? card.definition.power ?? '?'}/${override?.toughness ?? card.definition.toughness ?? '?'}`;
    }
    if (card.definition.loyalty !== undefined) return `[${card.definition.loyalty}]`;
    return '';
  }

  function UltraCompactPermanent({ card }: { card: CardState }) {
    const stat = getStatLabel(card);
    const counters = getCountersLabel(card);
    return (
      <div style={{
        width: 116,
        minHeight: 34,
        borderRadius: 5,
        border: `1px solid ${card.tapped ? '#f59e0b66' : '#334155'}`,
        background: card.tapped ? 'rgba(120,53,15,0.32)' : 'rgba(15,23,42,0.88)',
        color: '#e2e8f0',
        padding: '4px 6px',
        boxSizing: 'border-box',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 4,
        alignItems: 'center',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.definition.name}
          </div>
          <div style={{ fontSize: 8, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {card.tapped ? 'Tapped' : 'Ready'}{card.token ? ' / Token' : ''}{counters ? ` / ${counters}` : ''}
          </div>
        </div>
        {stat && (
          <div style={{
            fontSize: 9,
            fontWeight: 900,
            color: card.powerToughnessOverride ? '#fed7aa' : '#cbd5e1',
            border: '1px solid rgba(148,163,184,0.22)',
            borderRadius: 4,
            padding: '1px 4px',
            background: card.powerToughnessOverride ? 'rgba(146,64,14,0.36)' : 'rgba(255,255,255,0.05)',
          }}>
            {stat}
          </div>
        )}
      </div>
    );
  }

  function handleCardPointerUp(e: React.PointerEvent<HTMLDivElement>, card: CardState) {
    if (e.pointerType === 'mouse') return;
    const now = Date.now();
    const previous = lastTouchTapRef.current;
    const isSameCard = previous?.id === card.instanceId;
    const closeEnough = previous ? Math.hypot(e.clientX - previous.x, e.clientY - previous.y) < 24 : false;
    if (isSameCard && closeEnough && now - previous.time < 340) {
      e.preventDefault();
      e.stopPropagation();
      lastTouchTapRef.current = null;
      toggleTapped(card);
      return;
    }
    lastTouchTapRef.current = { id: card.instanceId, time: now, x: e.clientX, y: e.clientY };
  }

  function renderCard(card: CardState) {
    const isSelected = ui.selectedCardId === card.instanceId;
    const isBeingDragged = drag.dragState?.instanceId === card.instanceId;
    const isDropTarget   = drag.dropTarget?.id === card.instanceId && drag.dropTarget?.type === 'attacker';

    // Determine if this card is a valid attacker to glow during drag
    const def = card.definition;
    const isValidAttacker = !readOnly && isLocal && isDraggingAttack
      && def.cardTypes.includes('Creature')
      && !card.tapped
      && !def.keywords.includes('Defender')
      && !(card.summoningSick && !def.keywords.includes('Haste') && !def.oracleText.toLowerCase().includes('haste'));

    // Determine if this card is an active attacker (valid block target during block drag)
    const isActiveAttacker = isDraggingBlock && combatActive
      && game.combat.attackers.some(a => a.instanceId === card.instanceId);

    // Drag handlers for own cards
    const dragHandlers = !readOnly && isLocal ? drag.cardDragHandlers(card.instanceId) : {};
    // Block drop handlers for opponent's active attackers
    const blockDropHandlers = isActiveAttacker ? drag.attackerDropHandlers(card.instanceId) : {};

    // Outline logic
    let outlineColor: string | undefined;
    let outlineWidth = 2;
    if (isDropTarget)          { outlineColor = '#22c55e'; outlineWidth = 3; }
    else if (isSelected)       { outlineColor = '#60a5fa'; }
    else if (isValidAttacker)  { outlineColor = '#ef4444'; }
    else if (isActiveAttacker) { outlineColor = '#f97316'; }

    return (
      <div
        key={card.instanceId}
        data-testid={`card-battlefield-${card.instanceId}`}
        data-card-instance={card.instanceId}
        style={{
          position: 'relative',
          cursor: !readOnly && isLocal ? 'grab' : isActiveAttacker ? 'crosshair' : 'pointer',
          outline: outlineColor ? `${outlineWidth}px solid ${outlineColor}` : 'none',
          outlineOffset: isDropTarget ? 3 : 0,
          borderRadius: 4,
          transition: 'transform 0.1s, outline 0.1s, opacity 0.1s',
          opacity: isBeingDragged ? 0.35 : 1,
          // Pulse glow for valid drag targets
          boxShadow: isDropTarget
            ? `0 0 12px 4px #22c55e88`
            : isValidAttacker && isDraggingAttack
              ? `0 0 8px 2px #ef444466`
              : isActiveAttacker
                ? `0 0 8px 2px #f9731666`
                : 'none',
        }}
        onClick={(e) => handleCardClick(e, card.instanceId)}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleTapped(card);
        }}
        onPointerUp={(e) => handleCardPointerUp(e, card)}
        onContextMenu={(e) => { e.preventDefault(); handleCardClick(e, card.instanceId); }}
        onMouseEnter={(e) => {
          store.setHoveredCard(card.instanceId);
          store.setCardPreview(card.instanceId, { x: e.clientX, y: e.clientY });
        }}
        onMouseMove={(e) => store.setCardPreviewAnchor({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => {
          store.setHoveredCard(null);
          store.setCardPreview(null);
        }}
        title={
          isValidAttacker  ? `Drag to attack — ${card.definition.name}` :
          isActiveAttacker ? `Drop a creature here to block ${card.definition.name}` :
          card.definition.name
        }
        {...dragHandlers}
        {...blockDropHandlers}
      >
        {battlefieldView.density === 'ultraCompact'
          ? <UltraCompactPermanent card={card} />
          : <CardImage card={card} size={cardSize} style={cardImageStyle} />}

        {/* Combat role badge */}
        {card.combatRole === 'attacker' && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ef4444', borderRadius: '50%',
            width: 14, height: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: '#fff', fontWeight: 700,
            boxShadow: '0 0 6px #ef4444',
          }}>⚔</div>
        )}
        {card.combatRole === 'blocker' && (
          <div style={{
            position: 'absolute', top: -4, right: -4,
            background: '#3b82f6', borderRadius: '50%',
            width: 14, height: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, color: '#fff', fontWeight: 700,
            boxShadow: '0 0 6px #3b82f6',
          }}>🛡</div>
        )}

        {/* Drag hint tooltip (only shows when actively dragging own card) */}
        {isBeingDragged && (
          <div style={{
            position: 'absolute', bottom: '110%', left: '50%',
            transform: 'translateX(-50%)',
            background: '#0f172a', color: '#e2e8f0',
            fontSize: 9, padding: '3px 7px', borderRadius: 4,
            border: '1px solid #334155', whiteSpace: 'nowrap',
            pointerEvents: 'none', zIndex: 100,
          }}>
            Drop on opponent to attack
          </div>
        )}
      </div>
    );
  }

  function normalizeDraftCount(raw: number | undefined, fallback = 0, max?: number): number {
    if (raw === undefined || !Number.isFinite(raw)) return fallback;
    const normalized = Math.max(1, Math.floor(raw));
    if (typeof max === 'number') return Math.min(normalized, max);
    return normalized;
  }

  function clearCloudSplitTree(prefix: string, currentSplits: Record<string, number>): Record<string, number> {
    const next: Record<string, number> = {};
    for (const [key, value] of Object.entries(currentSplits)) {
      if (key === prefix || key.startsWith(`${prefix}.`)) continue;
      next[key] = value;
    }
    return next;
  }

  function setCloudAttackTarget(cloudKey: string, targetId: string): void {
    setCloudAttackTargets(prev => ({ ...prev, [cloudKey]: targetId }));
  }

  function setCloudAttackCount(cloudKey: string, rawCount: number): void {
    setCloudAttackCounts(prev => ({ ...prev, [cloudKey]: rawCount }));
  }

  function setCloudSplitDraft(cloudKey: string, rawCount: number): void {
    setCloudSplitDrafts(prev => ({ ...prev, [cloudKey]: rawCount }));
  }

  const opponentPlayers = game.players.filter(opponent => opponent.id !== player.id);

  function toggleFilter(filter: BattlefieldFilterChip) {
    setActiveFilters(prev => {
      const next = new Set(prev);
      if (next.has(filter)) next.delete(filter);
      else next.add(filter);
      return next;
    });
  }

  function toggleSection(section: BattlefieldSectionKey) {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  function collapseLands() {
    setCollapsedSections(prev => new Set([...prev, 'lands']));
  }

  function collapseTokens() {
    setCollapsedSections(prev => new Set([...prev, 'tokens']));
  }

  function collapseNoncombatPermanents() {
    setCollapsedSections(prev => new Set([...prev, 'lands', 'artifacts', 'enchantments', 'planeswalkers', 'battles', 'other']));
  }

  function expandAllSections() {
    setCollapsedSections(new Set());
  }

  function resolveAttackTarget(cloudKey: string): string | undefined {
    const preferred = cloudAttackTargets[cloudKey];
    if (preferred && opponentPlayers.some(opponent => opponent.id === preferred)) return preferred;
    return opponentPlayers[0]?.id;
  }

  function summarizeCounters(cards: CardState[]): { type: string; total: number }[] {
    const counterMap = new Map<string, number>();
    for (const card of cards) {
      for (const c of card.counters) {
        counterMap.set(c.type, (counterMap.get(c.type) || 0) + c.count);
      }
    }
    return [...counterMap.entries()].map(([type, total]) => ({ type, total }));
  }

  function attackTokenBatch(cards: CardState[], clusterKey: string) {
    if (readOnly) return;
    if (!isLocal) return;
    const untapped = cards.filter(card => !card.tapped);
    if (untapped.length === 0) return;
    const targetPlayerId = resolveAttackTarget(clusterKey);
    if (!targetPlayerId) return;
    const requestedCount = normalizeDraftCount(cloudAttackCounts[clusterKey], 1, untapped.length);
    if (requestedCount < 1 || requestedCount > untapped.length) return;
    if (!game.combat.active) store.enterCombat();
    for (const attacker of untapped.slice(0, requestedCount)) {
      store.declareAttack(attacker.instanceId, targetPlayerId);
    }
  }

  function splitTokenCloud(cloudKey: string, cloud: TokenCloud, raw: number) {
    const requested = normalizeDraftCount(raw, 1, cloud.cards.length - 1);
    if (requested <= 0 || requested >= cloud.cards.length) {
      setCloudSplits(prev => {
        const next = clearCloudSplitTree(cloudKey, prev);
        return next;
      });
      setCloudSplitDrafts(prev => {
        const next = { ...prev };
        delete next[cloudKey];
        return next;
      });
      return;
    }
    setCloudSplits(prev => ({ ...prev, [cloudKey]: requested }));
  }

  function renderTokenCloudCluster(cloud: TokenCloud, label: string, cards: CardState[], clusterKey: string) {
    const untappedIds = cards.filter(card => !card.tapped).map(card => card.instanceId);
    const tappedIds = cards.filter(card => card.tapped).map(card => card.instanceId);
    const counters = summarizeCounters(cards);
    const iconLabel = cards.length === cloud.cards.length ? '' : ` (${label})`;
    const opponentCount = opponentPlayers.length;
    const draftAttackCount = normalizeDraftCount(cloudAttackCounts[clusterKey], untappedIds.length ? 1 : 0, Math.max(1, untappedIds.length));
    const splitDraftDefault = Math.max(1, Math.floor(cards.length / 2));
    const splitDraft = normalizeDraftCount(
      cloudSplitDrafts[clusterKey],
      splitDraftDefault,
      Math.max(1, cards.length - 1),
    );
    const targetPlayerId = resolveAttackTarget(clusterKey);
    return (
      <div
        key={`${cloud.key}-${label}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          minWidth: 54,
          padding: '4px 6px',
          borderRadius: 6,
          border: '1px solid rgba(255,255,255,0.1)',
          background: 'rgba(255,255,255,0.04)',
        }}
      >
        <div style={{ fontSize: 18, lineHeight: 1 }}>ðŸª™</div>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>
          ×{cards.length}{iconLabel}
        </div>
        <div style={{ fontSize: 9, color: '#94a3b8' }}>{cloud.name}</div>
        <div style={{ fontSize: 9, color: '#94a3b8' }}>{cloud.power}/{cloud.toughness}</div>
        {tappedIds.length > 0 && <div style={{ fontSize: 9, color: '#f59e0b' }}>â†»{tappedIds.length}</div>}
        {counters.map(counter => (
          <div key={counter.type} style={{ fontSize: 8, color: '#6ee7b7' }}>{counter.type}:{counter.total}</div>
        ))}
        {isLocal && !readOnly && (
          <div style={{ display: 'flex', gap: 3, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 8, color: '#94a3b8' }}>
              <span style={{ opacity: 0.85 }}>atk:</span>
              <input
                type="number"
                min={1}
                max={Math.max(1, untappedIds.length)}
                value={draftAttackCount}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.preventDefault();
                  const parsed = Number.parseInt(e.target.value, 10);
                  setCloudAttackCount(clusterKey, normalizeDraftCount(parsed, 0, Math.max(1, untappedIds.length)));
                }}
                style={{
                  width: 34,
                  fontSize: 8,
                  padding: '2px',
                  borderRadius: 3,
                  border: '1px solid #334155',
                  background: '#0b1220',
                  color: '#e2e8f0',
                }}
              />
            </span>
            <select
              value={targetPlayerId ?? ''}
              onChange={(e) => {
                e.preventDefault();
                setCloudAttackTarget(clusterKey, e.target.value);
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              style={{
                fontSize: 8,
                background: '#0b1220',
                color: '#e2e8f0',
                border: '1px solid #334155',
                borderRadius: 3,
              }}
            >
              {opponentPlayers.map((opponent) => (
                <option key={opponent.id} value={opponent.id}>
                  {opponent.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={untappedIds.length === 0 || opponentCount === 0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                attackTokenBatch(cards, clusterKey);
              }}
              title={`Attack ${draftAttackCount} of ${untappedIds.length} ${cloud.name} token${iconLabel ? ` (${iconLabel.trim()})` : ''}`}
              style={{
                fontSize: 8,
                padding: '2px 5px',
                borderRadius: 3,
                border: '1px solid #334155',
                background: untappedIds.length === 0 || opponentCount === 0 ? 'rgba(15,23,42,0.5)' : '#1e293b',
                color: untappedIds.length === 0 || opponentCount === 0 ? '#334155' : '#cbd5e1',
                cursor: untappedIds.length === 0 || opponentCount === 0 ? 'default' : 'pointer',
              }}
            >
              Attack
            </button>
            <button
              type="button"
              disabled={untappedIds.length === 0 || opponentCount === 0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setTokenStackModal({ sourceGroupId: clusterKey, cards });
              }}
              title={`Attack all, some, or split ${cloud.name} tokens across targets`}
              style={{
                fontSize: 8,
                padding: '2px 5px',
                borderRadius: 3,
                border: '1px solid #7f1d1d',
                background: untappedIds.length === 0 || opponentCount === 0 ? 'rgba(15,23,42,0.5)' : '#7f1d1d',
                color: untappedIds.length === 0 || opponentCount === 0 ? '#334155' : '#fee2e2',
                cursor: untappedIds.length === 0 || opponentCount === 0 ? 'default' : 'pointer',
              }}
            >
              Attack Stack
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const raw = window.prompt(
                  `Set base P/T for ${cards.length} ${cloud.name} token${cards.length === 1 ? '' : 's'} as power/toughness. Counters still apply.`,
                  `${cloud.power}/${cloud.toughness}`,
                );
                if (!raw) return;
                const [power = '', toughness = ''] = raw.split('/').map(part => part.trim());
                if (!power && !toughness) return;
                store.setPowerToughnessOverride(
                  cards.map(card => card.instanceId),
                  power,
                  toughness,
                  'manual',
                  'Token stack manual P/T',
                );
              }}
              title={`Set manual base P/T for this ${cloud.name} stack`}
              style={{
                fontSize: 8,
                padding: '2px 5px',
                borderRadius: 3,
                border: '1px solid #92400e',
                background: '#78350f',
                color: '#fed7aa',
                cursor: 'pointer',
              }}
            >
              Set Stack P/T
            </button>
            <button
              type="button"
              disabled={untappedIds.length === 0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                store.tapCards(untappedIds);
              }}
              title={`Tap all untapped ${cloud.name} tokens`}
              style={{
                fontSize: 8,
                padding: '2px 5px',
                borderRadius: 3,
                border: '1px solid #334155',
                background: untappedIds.length === 0 ? 'rgba(15,23,42,0.5)' : '#1e293b',
                color: untappedIds.length === 0 ? '#334155' : '#cbd5e1',
                cursor: untappedIds.length === 0 ? 'default' : 'pointer',
              }}
            >
              Tap
            </button>
            <button
              type="button"
              disabled={tappedIds.length === 0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                store.untapCards(tappedIds);
              }}
              title={`Untap all tapped ${cloud.name} tokens`}
              style={{
                fontSize: 8,
                padding: '2px 5px',
                borderRadius: 3,
                border: '1px solid #334155',
                background: tappedIds.length === 0 ? 'rgba(15,23,42,0.5)' : '#1e293b',
                color: tappedIds.length === 0 ? '#334155' : '#cbd5e1',
                cursor: tappedIds.length === 0 ? 'default' : 'pointer',
              }}
            >
              Untap
            </button>
            <button
              type="button"
              disabled={cards.length < 2}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                splitTokenCloud(clusterKey, cloud, splitDraft);
              }}
              title={`Split ${cloud.name} stack into two groups`}
              style={{
                fontSize: 8,
                padding: '2px 5px',
                borderRadius: 3,
                border: '1px solid #334155',
                background: cards.length < 2 ? 'rgba(15,23,42,0.5)' : '#1e293b',
                color: cards.length < 2 ? '#334155' : '#cbd5e1',
                cursor: cards.length < 2 ? 'default' : 'pointer',
              }}
            >
              Apply
            </button>
            <span style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 8, color: '#94a3b8' }}>
              <span style={{ opacity: 0.85 }}>split:</span>
              <input
                type="number"
                min={1}
                max={Math.max(1, cards.length - 1)}
                value={splitDraft}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  e.preventDefault();
                  const parsed = Number.parseInt(e.target.value, 10);
                  setCloudSplitDraft(clusterKey, normalizeDraftCount(parsed, splitDraftDefault, cards.length - 1));
                }}
                style={{
                  width: 34,
                  fontSize: 8,
                  padding: '2px',
                  borderRadius: 3,
                  border: '1px solid #334155',
                  background: '#0b1220',
                  color: '#e2e8f0',
                }}
              />
            </span>
          </div>
        )}
      </div>
    );
  }

  function renderTokenCloud(cloud: TokenCloud) {
    return renderTokenCloudSegment(cloud, cloud.cards, cloud.key, cloud.name);
  }

  function renderTokenCloudSegment(
    cloud: TokenCloud,
    cards: CardState[],
    segmentKey: string,
    label = '',
  ) {
    const splitAt = cloudSplits[segmentKey];
    const safeSplit = splitAt && splitAt > 0 && splitAt < cards.length ? splitAt : null;

    if (safeSplit) {
      const firstGroup = cards.slice(0, safeSplit);
      const secondGroup = cards.slice(safeSplit);
      return (
        <div
          key={segmentKey}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6,
            padding: '4px 6px',
            minWidth: 54,
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {renderTokenCloudSegment(cloud, firstGroup, `${segmentKey}.L`, `Left ${firstGroup.length}`)}
            {renderTokenCloudSegment(cloud, secondGroup, `${segmentKey}.R`, `Right ${secondGroup.length}`)}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setCloudSplits(prev => clearCloudSplitTree(segmentKey, prev));
              }}
              style={{
                fontSize: 8,
                padding: '2px 5px',
                borderRadius: 3,
                border: '1px solid #334155',
                background: '#1e293b',
                color: '#cbd5e1',
              }}
              title={`Reset ${cloud.name} stack split`}
            >
              Unsplit
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        key={segmentKey}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          cursor: 'pointer',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 6,
          padding: '4px 6px',
          minWidth: 54,
          transition: 'background 0.15s',
        }}
        onClick={() => setExpandedClouds(prev => {
          const next = new Set(prev);
          if (next.has(segmentKey)) next.delete(segmentKey);
          else next.add(segmentKey);
          return next;
        })}
        title={`${cloud.cards.length}x ${cloud.name} - click to expand`}
      >
        {renderTokenCloudCluster(cloud, label, cards, segmentKey)}
      </div>
    );
  }

  function renderBattlefieldSection(section: BattlefieldSection) {
    const collapsed = collapsedSections.has(section.key);
    const isTokenSection = section.key === 'tokens';
    return (
      <div key={section.key} data-testid={`battlefield-section-${section.key}`} style={{ flexShrink: 0 }}>
        {!compact && (
          <button
            type="button"
            onClick={() => toggleSection(section.key)}
            style={{
              ...labelStyle,
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: 'rgba(15,23,42,0.62)',
              border: '1px solid rgba(71,85,105,0.35)',
              borderRadius: 5,
              padding: '3px 6px',
              cursor: 'pointer',
            }}
          >
            <span>{collapsed ? '+' : '-'} {section.label} ({section.cards.length})</span>
            <span>{battlefieldView.density === 'ultraCompact' ? 'ultra' : battlefieldView.density}</span>
          </button>
        )}
        {!collapsed && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap, alignItems: isTokenSection ? 'flex-end' : 'flex-start' }}>
            {isTokenSection ? (
              <>
                {tokenClouds.map(renderTokenCloud)}
                {tokenClouds.filter(c => expandedClouds.has(c.key)).flatMap(c => c.cards.map(renderCard))}
                {tokenSingles.map(renderCard)}
              </>
            ) : (
              section.cards.map(renderCard)
            )}
          </div>
        )}
      </div>
    );
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 9, color: '#475569', textTransform: 'uppercase',
    letterSpacing: '0.08em', marginBottom: 3, fontWeight: 600,
  };
  const filterChips: Array<{ key: BattlefieldFilterChip; label: string }> = [
    { key: 'tapped', label: 'Tapped' },
    { key: 'untapped', label: 'Untapped' },
    { key: 'creatures', label: 'Creatures' },
    { key: 'tokens', label: 'Tokens' },
    { key: 'canAttack', label: 'Can Attack' },
    { key: 'canBlock', label: 'Can Block' },
    { key: 'hasCounters', label: 'Counters' },
    { key: 'hasPowerToughnessOverride', label: 'P/T Override' },
    { key: 'hasMechanicBadge', label: 'Mechanic' },
  ];

  return (
    <div
      data-testid={`battlefield-${player.id}`}
      style={{
        display: 'flex', flexDirection: 'column',
        gap: compact ? 4 : 6,
        padding: compact ? '4px 6px' : '6px 10px',
        width: '100%',
        height: '100%',
        minHeight: compact ? 80 : 120,
        minWidth: 0,
        overflow: 'hidden',
        position: 'relative', boxSizing: 'border-box',
      }}
    >
      {/* Player name strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6,
        borderBottom: `1px solid ${player.color}44`,
        paddingBottom: compact ? 2 : 4,
        marginBottom: compact ? 2 : 4,
        flexShrink: 0,
      }}>
        <PlayerAvatar
          name={player.name}
          color={player.color}
          initial={player.avatarInitial ?? player.name.slice(0, 1)}
          styleMode={player.avatarStyle}
          image={player.avatarImage}
          size={compact ? 18 : 24}
        />
        <span style={{
          fontSize: compact ? 9 : 11, fontWeight: 600,
          color: isActive ? '#e2e8f0' : '#94a3b8', letterSpacing: '0.03em',
        }}>
          {player.name}
        </span>
        {isActive && !compact && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: '#22c55e',
            background: '#14532d44', borderRadius: 3, padding: '1px 5px',
          }}>ACTIVE</span>
        )}
        {player.isDummy && !compact && (
          <span
            title={`Dummy profile: ${player.dummyProfile ?? 'training'}`}
            style={{
              fontSize: 9,
              fontWeight: 800,
              color: '#fde68a',
              background: '#713f123f',
              border: '1px solid #92400e88',
              borderRadius: 3,
              padding: '1px 5px',
              textTransform: 'uppercase',
            }}
          >
            {player.dummyProfile ?? 'dummy'}
          </span>
        )}
        {!compact && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#64748b' }}>
            {cards.length} permanent{cards.length !== 1 ? 's' : ''}
          </span>
        )}

        {/* Opponent hand count — always visible so you can track what they're holding */}
        {!isLocal && (
          <span style={{
            marginLeft: compact ? undefined : 'auto',
            fontSize: 9,
            color: player.hand.length > 7
              ? '#f59e0b'
              : player.hand.length === 0
                ? '#334155'
                : '#475569',
            fontWeight: 600,
            flexShrink: 0,
          }}
          title={`${player.name} has ${player.hand.length} card${player.hand.length !== 1 ? 's' : ''} in hand`}
          >
            ✋ {player.hand.length}
          </span>
        )}

        {/* Drag hint — show when dragging an attack toward this player */}
        {isDraggingAttack && !isLocal && (
          <span style={{
            marginLeft: 'auto', fontSize: 9, color: '#ef4444',
            animation: 'pulse 1s infinite',
            fontWeight: 700,
          }}>
            Drop to attack →
          </span>
        )}
      </div>

      {!compact && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          padding: '4px 6px',
          border: '1px solid rgba(71,85,105,0.28)',
          borderRadius: 7,
          background: 'rgba(2,6,23,0.34)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              Board
            </span>
            <SummaryPill label="Creatures" value={battlefieldView.summary.totalCreatures} />
            <SummaryPill label="Blockers" value={battlefieldView.summary.untappedBlockers} />
            <SummaryPill label="Atk Power" value={battlefieldView.summary.attackingPower} />
            <SummaryPill label="Tokens" value={battlefieldView.summary.tokenCount} />
            <SummaryPill label="Walkers" value={battlefieldView.summary.planeswalkerCount} />
            <span style={{ marginLeft: 'auto', fontSize: 9, color: '#64748b' }}>
              {visibleCards.length}/{cards.length} shown
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 1fr) 112px auto', gap: 6, alignItems: 'center' }}>
            <input
              value={battlefieldSearch}
              onChange={e => setBattlefieldSearch(e.target.value)}
              placeholder="Search battlefield..."
              style={{
                minWidth: 0,
                background: '#0b1220',
                border: '1px solid #334155',
                borderRadius: 5,
                color: '#e2e8f0',
                fontSize: 10,
                padding: '4px 7px',
                outline: 'none',
              }}
            />
            <select
              value={densityMode}
              onChange={e => setDensityMode(e.target.value as BattlefieldDensityMode | 'auto')}
              title="Battlefield density"
              style={{
                background: '#0b1220',
                border: '1px solid #334155',
                borderRadius: 5,
                color: '#cbd5e1',
                fontSize: 10,
                padding: '4px 6px',
              }}
            >
              <option value="auto">Auto density</option>
              <option value="normal">Normal</option>
              <option value="compact">Compact</option>
              <option value="ultraCompact">Ultra compact</option>
            </select>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" data-testid={`collapse-lands-${player.id}`} onClick={collapseLands} style={miniControlStyle}>Collapse Lands</button>
              <button type="button" data-testid={`collapse-tokens-${player.id}`} onClick={collapseTokens} style={miniControlStyle}>Collapse Tokens</button>
              <button type="button" onClick={collapseNoncombatPermanents} style={miniControlStyle}>Noncombat</button>
              <button type="button" onClick={expandAllSections} style={miniControlStyle}>Expand All</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {filterChips.map(chip => {
              const active = activeFilters.has(chip.key);
              return (
                <button
                  key={chip.key}
                  type="button"
                  data-testid={`battlefield-filter-${chip.key}-${player.id}`}
                  onClick={() => toggleFilter(chip.key)}
                  style={{
                    fontSize: 9,
                    fontWeight: 800,
                    borderRadius: 999,
                    border: `1px solid ${active ? '#60a5fa' : '#334155'}`,
                    background: active ? 'rgba(37,99,235,0.28)' : 'rgba(15,23,42,0.72)',
                    color: active ? '#bfdbfe' : '#94a3b8',
                    padding: '2px 7px',
                    cursor: 'pointer',
                  }}
                >
                  {chip.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div
        data-testid={`battlefield-scroll-${player.id}`}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
          scrollbarGutter: 'stable',
          paddingRight: hasWideBoard ? 4 : 0,
          display: 'flex',
          flexDirection: 'column',
          gap: zoneGap,
        }}
      >
      {battlefieldView.sections.map(section => renderBattlefieldSection(section))}

      {/* Empty state */}
      {visibleCards.length === 0 && !compact && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          flex: 1, gap: 4,
        }}>
          {isDraggingAttack && !isLocal ? (
            <span style={{ color: '#ef444466', fontSize: 12, fontStyle: 'italic' }}>Drop here to attack {player.name}</span>
          ) : (
            <span style={{ color: '#1e293b', fontSize: 11, fontStyle: 'italic' }}>
              {cards.length === 0 ? 'No permanents' : 'No permanents match filters'}
            </span>
          )}
          {/* Show library / graveyard counts as context */}
          {isLocal && (
            <span style={{ fontSize: 9, color: '#1e293b' }}>
              Library: {player.library.length} · GY: {player.graveyard.length}
            </span>
          )}
        </div>
      )}
      </div>
      {!readOnly && tokenStackModal && (
        <TokenStackAttackModal
          playerId={player.id}
          sourceGroupId={tokenStackModal.sourceGroupId}
          cards={tokenStackModal.cards}
          onClose={() => setTokenStackModal(null)}
        />
      )}
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 3,
      fontSize: 9,
      color: '#94a3b8',
      border: '1px solid rgba(71,85,105,0.35)',
      background: 'rgba(15,23,42,0.55)',
      borderRadius: 999,
      padding: '1px 6px',
      whiteSpace: 'nowrap',
    }}>
      <span>{label}</span>
      <strong style={{ color: '#e2e8f0' }}>{value}</strong>
    </span>
  );
}

const miniControlStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 800,
  borderRadius: 5,
  border: '1px solid #334155',
  background: 'rgba(15,23,42,0.78)',
  color: '#94a3b8',
  padding: '3px 6px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

