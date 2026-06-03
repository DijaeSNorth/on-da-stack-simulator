import { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { CardState, Zone } from '../../types/game';
import {
  getAllMechanics,
  hasMechanic,
  getTier3Patterns,
  type CardMechanic,
} from '../../engine/mechanicResolver';
import { getTokenEntry, getTokensFromOracleText } from '../../engine/tokenRegistry';

interface MenuAction {
  label: string;
  action: () => void;
  divider?: boolean;
  danger?: boolean;
  disabled?: boolean;
  tier?: 1 | 2 | 3;
  tooltip?: string;
}

export function CardContextMenu() {
  const store = useGameStore();
  const { ui, game, localPlayerId } = store;
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        store.closeCardContextMenu();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!ui.cardContextMenu) return null;

  const { instanceId, x, y } = ui.cardContextMenu;
  const card = game.cards[instanceId];
  if (!card) return null;

  const def = card.definition;
  const isController = card.controllerId === localPlayerId;
  const onBattlefield = card.zone === 'battlefield';
  const inHand = card.zone === 'hand';
  const inGraveyard = card.zone === 'graveyard';
  const inExile = card.zone === 'exile';
  const inLibrary = card.zone === 'library';
  const isPermanent = ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle']
    .some(t => def.cardTypes.includes(t as typeof def.cardTypes[number]));

  const close = () => store.closeCardContextMenu();

  const actions: MenuAction[] = [];

  // ─── Hand actions ───────────────────────────────────────────────────────────
  if (inHand) {
    if (def.cardTypes.includes('Land')) {
      actions.push({
        label: 'Play Land',
        action: () => { store.playLand(localPlayerId, instanceId); close(); },
      });
    } else {
      actions.push({
        label: `Cast ${def.name}`,
        action: () => { store.castCard(localPlayerId, instanceId); close(); },
      });
    }

    // Cycling — tier 1 (popular) or detected from oracle text
    if (hasMechanic(def, 'cycling')) {
      actions.push({
        label: 'Cycle (Discard → Draw 1)',
        tier: 1,
        action: () => { store.cycleCard(localPlayerId, instanceId); close(); },
        tooltip: 'Pay cycling cost, discard, draw a card.',
      });
    }

    // Tier 2 keywords relevant to hand casting (alternative cast modes)
    const t2 = getAllMechanics(def).filter(m =>
      m.tier === 2 && m.fromZone === 'hand' && m.key !== 'cycling'
    );
    if (t2.length > 0) {
      actions.push({ divider: true, label: '', action: () => {} });
      for (const m of t2) {
        actions.push({
          label: m.label,
          tier: 2,
          tooltip: m.description,
          action: () => {
            // Most hand-alternative-cost mechanics still cast the card — just log it
            store.castCard(localPlayerId, instanceId);
            close();
          },
        });
      }
    }
  }

  // ─── Graveyard actions ──────────────────────────────────────────────────────
  if (inGraveyard) {
    actions.push({
      label: 'Cast from Graveyard',
      tier: 1,
      action: () => { store.castFromZone(localPlayerId, instanceId, 'graveyard'); close(); },
      tooltip: 'Flashback, Escape, Unearth, Encore, etc.',
    });
    if (isPermanent) {
      actions.push({
        label: 'Reanimate (onto Battlefield)',
        tier: 1,
        action: () => { store.reanimateCard(instanceId, localPlayerId); close(); },
        tooltip: 'Put this permanent directly onto the battlefield.',
      });
    }

    // Tier 2 keywords: haunt, dredge, jump-start
    const t2gy = getAllMechanics(def).filter(m =>
      m.tier === 2 && (m.fromZone === 'graveyard' || m.key === 'dredge' || m.key === 'jump-start' || m.key === 'haunt')
    );
    for (const m of t2gy) {
      // Don't duplicate generic cast-from-gy
      if (m.action === 'CAST_FROM_GY') continue;
      actions.push({
        label: m.label,
        tier: 2,
        tooltip: m.description,
        action: () => { store.castFromZone(localPlayerId, instanceId, 'graveyard'); close(); },
      });
    }
  }

  // ─── Exile actions ──────────────────────────────────────────────────────────
  if (inExile) {
    actions.push({
      label: 'Cast from Exile',
      tier: 1,
      action: () => { store.castFromZone(localPlayerId, instanceId, 'exile'); close(); },
      tooltip: 'Foretell, Adventure, Suspend, Rebound, etc.',
    });
    if (isPermanent) {
      actions.push({
        label: 'Put onto Battlefield',
        tier: 1,
        action: () => { store.reanimateCard(instanceId, localPlayerId); close(); },
        tooltip: 'Directly move this permanent onto the battlefield.',
      });
    }
  }

  // ─── Battlefield actions ────────────────────────────────────────────────────
  if (onBattlefield) {
    if (!card.tapped) {
      actions.push({ label: 'Tap', action: () => { store.tapCard(instanceId); close(); } });
    } else {
      actions.push({ label: 'Untap', action: () => { store.untapCard(instanceId); close(); } });
    }

    // ── Token shortcuts ──────────────────────────────────────────────────────
    const tokenEntry = getTokenEntry(def.name);
    const oracleTokens = !tokenEntry ? getTokensFromOracleText(def.oracleText || '') : [];
    const allTokens = tokenEntry?.tokens.length ? tokenEntry.tokens : oracleTokens;

    if (allTokens.length > 0) {
      actions.push({ divider: true, label: '', action: () => {} });
      const count = tokenEntry?.defaultCount ?? 1;
      const isVariable = tokenEntry?.variableCount ?? false;
      const hint = tokenEntry?.hint ?? `Create token(s) from ${def.name}'s ability`;
      const seen = new Set<string>();
      for (const tok of allTokens) {
        if (seen.has(tok.name)) continue;
        seen.add(tok.name);
        const countLabel = isVariable ? 'X×' : count > 1 ? `${count}×` : '1×';
        actions.push({
          label: `✨ ${countLabel} ${tok.emoji ?? ''} ${tok.name}`.trim(),
          tier: 1,
          tooltip: hint,
          action: () => {
            const n = isVariable ? 1 : count;
            for (let i = 0; i < n; i++) {
              store.createTokenCard(localPlayerId, {
                id: `token-${tok.name.toLowerCase().replace(/\s+/g, '-')}`,
                name: tok.name,
                power: tok.power,
                toughness: tok.toughness,
                colors: tok.colors,
                cardTypes: tok.cardTypes as typeof def.cardTypes,
                subTypes: tok.subTypes,
                keywords: tok.keywords,
                oracleText: tok.oracleText ?? '',
                typeLine: tok.typeLine,
                isDoubleFaced: false,
                legalities: {},
                colorIdentity: tok.colors,
                cmc: 0,
              });
            }
            close();
          },
        });
      }
      if (isVariable) {
        actions.push({
          label: `  → type "create N ${allTokens[0].subTypes[0]?.toLowerCase() || 'token'}s" for custom count`,
          tooltip: hint,
          action: () => close(),
        });
      }
    }

    if (def.cardTypes.includes('Creature') && !card.tapped && !card.summoningSick) {
      actions.push({
        label: 'Declare as Attacker →',
        action: () => { store.enterCombat(); close(); },
      });
    }

    if (def.isDoubleFaced) {
      actions.push({
        label: card.transformed ? 'Transform Back' : 'Transform',
        action: () => { store.transformCard(instanceId); close(); },
      });
    }

    // Equip / Fortify / Crew / Level Up / Monstrosity from tier 2
    const t2bf = getAllMechanics(def).filter(m =>
      m.tier === 2 && m.fromZone === 'battlefield'
    );
    if (t2bf.length > 0) {
      actions.push({ divider: true, label: '', action: () => {} });
      for (const m of t2bf) {
        actions.push({
          label: m.label,
          tier: 2,
          tooltip: m.description,
          action: () => {
            // Log the intent; actual cost/target selection is manual
            store.logAction && store.logAction(localPlayerId, m.key.toUpperCase(), `${def.name} — ${m.label}`);
            close();
          },
        });
      }
    }

    actions.push({ divider: true, label: '', action: () => {} });
    actions.push({ label: 'Add +1/+1 Counter', action: () => { store.addCounterToCard(instanceId, '+1/+1'); close(); } });
    actions.push({ label: 'Add -1/-1 Counter', action: () => { store.addCounterToCard(instanceId, '-1/-1'); close(); } });
    actions.push({ label: 'Add Loyalty Counter', action: () => { store.addCounterToCard(instanceId, 'loyalty'); close(); } });

    actions.push({ divider: true, label: '', action: () => {} });
  }

  // ─── Tier 3: Oracle-text niche mechanics (flag but don't auto-execute) ──────
  const t3 = getTier3Patterns(def);
  if (t3.length > 0) {
    actions.push({ divider: true, label: '', action: () => {} });
    for (const p of t3) {
      actions.push({
        label: `⚑ ${p.label}`,
        tier: 3,
        tooltip: p.description,
        // Tier 3: log a judge note so players are aware — action must be done manually
        action: () => {
          store.logAction && store.logAction(
            localPlayerId,
            'JUDGE_NOTE',
            `[Niche mechanic] ${def.name} — ${p.label}: ${p.description}`
          );
          close();
        },
      });
    }
  }

  // ─── Move to zone ───────────────────────────────────────────────────────────
  actions.push({ divider: true, label: '', action: () => {} });
  const moveOptions: { label: string; zone: Zone }[] = [
    { label: 'Move to Hand', zone: 'hand' },
    { label: 'Move to Battlefield', zone: 'battlefield' },
    { label: 'Move to Graveyard', zone: 'graveyard' },
    { label: 'Exile', zone: 'exile' },
    { label: 'Move to Library (bottom)', zone: 'library' },
    { label: 'Return to Command Zone', zone: 'command' },
  ];
  for (const opt of moveOptions) {
    if (card.zone !== opt.zone) {
      actions.push({
        label: opt.label,
        action: () => { store.moveCardToZone(instanceId, opt.zone); close(); },
      });
    }
  }

  actions.push({ divider: true, label: '', action: () => {} });
  actions.push({ label: 'Preview Card', action: () => { store.setCardPreview(instanceId); close(); } });

  // ─── Clamp to viewport ──────────────────────────────────────────────────────
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 224;
  const menuH = actions.length * 30;
  const clampedX = Math.min(x, vw - menuW - 8);
  const clampedY = Math.min(y, vh - menuH - 8);

  // Tier badge styles
  const tierBadge = (tier?: 1 | 2 | 3) => {
    if (!tier) return null;
    const colors: Record<number, string> = {
      1: '#22c55e',  // green — popular/evergreen
      2: '#3b82f6',  // blue — keyword
      3: '#f59e0b',  // amber — oracle/niche
    };
    const labels: Record<number, string> = { 1: 'T1', 2: 'T2', 3: 'T3' };
    return (
      <span style={{
        marginLeft: 'auto',
        fontSize: 9,
        fontWeight: 700,
        color: colors[tier],
        border: `1px solid ${colors[tier]}`,
        borderRadius: 3,
        padding: '0 3px',
        opacity: 0.8,
        flexShrink: 0,
      }}>
        {labels[tier]}
      </span>
    );
  };

  return (
    <div
      ref={menuRef}
      data-testid="card-context-menu"
      style={{
        position: 'fixed',
        left: clampedX,
        top: clampedY,
        zIndex: 99999,
        background: '#1e1e32',
        border: '1px solid #3d3d5c',
        borderRadius: 8,
        minWidth: menuW,
        maxHeight: '80vh',
        overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '8px 12px 6px',
        borderBottom: '1px solid #2d2d4a',
        fontSize: 11,
        fontWeight: 700,
        color: '#94a3b8',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
      }}>
        {def.name}
        <span style={{ fontSize: 9, color: '#4b5563', marginLeft: 6, fontWeight: 400 }}>
          {def.keywords.length > 0 ? def.keywords.slice(0, 3).join(' · ') : def.typeLine}
        </span>
      </div>

      {actions.map((action, i) => {
        if (action.divider) {
          return <div key={i} style={{ height: 1, background: '#2d2d4a', margin: '2px 0' }} />;
        }
        return (
          <button
            key={i}
            title={action.tooltip}
            onClick={action.action}
            disabled={action.disabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: '6px 14px',
              background: 'none',
              border: 'none',
              cursor: action.disabled ? 'not-allowed' : 'pointer',
              textAlign: 'left',
              fontSize: 12,
              color: action.danger ? '#f87171'
                : action.tier === 3 ? '#fbbf24'
                : action.disabled ? '#4b5563'
                : '#e2e8f0',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = '#2d2d4a'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = 'none'; }}
          >
            <span style={{ flex: 1 }}>{action.label}</span>
            {tierBadge(action.tier)}
          </button>
        );
      })}
    </div>
  );
}
