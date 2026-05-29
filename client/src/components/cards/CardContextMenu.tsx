import { useEffect, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { CardState, Zone } from '../../types/game';

interface MenuAction {
  label: string;
  action: () => void;
  divider?: boolean;
  danger?: boolean;
  disabled?: boolean;
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

  const close = () => store.closeCardContextMenu();

  const actions: MenuAction[] = [];

  // Cast / Play
  if (inHand) {
    if (def.cardTypes.includes('Land')) {
      actions.push({
        label: 'Play Land', action: () => {
          store.playLand(localPlayerId, instanceId);
          close();
        },
      });
    } else {
      actions.push({
        label: `Cast ${def.name}`, action: () => {
          store.castCard(localPlayerId, instanceId);
          close();
        },
      });
    }
  }

  // Battlefield actions
  if (onBattlefield) {
    if (!card.tapped) {
      actions.push({ label: 'Tap', action: () => { store.tapCard(instanceId); close(); } });
    } else {
      actions.push({ label: 'Untap', action: () => { store.untapCard(instanceId); close(); } });
    }

    if (def.cardTypes.includes('Creature') && !card.tapped && !card.summoningSick) {
      actions.push({ label: 'Declare as Attacker →', action: () => {
        // Enter combat mode prompting target selection
        store.enterCombat();
        close();
      }});
    }

    actions.push({ divider: true, label: '', action: () => {} });

    // Counters submenu
    actions.push({ label: 'Add +1/+1 Counter', action: () => { store.addCounterToCard(instanceId, '+1/+1'); close(); } });
    actions.push({ label: 'Add -1/-1 Counter', action: () => { store.addCounterToCard(instanceId, '-1/-1'); close(); } });
    actions.push({ label: 'Add Loyalty Counter', action: () => { store.addCounterToCard(instanceId, 'loyalty'); close(); } });

    if (def.isDoubleFaced) {
      actions.push({ label: card.transformed ? 'Transform Back' : 'Transform', action: () => { store.transformCard(instanceId); close(); } });
    }

    actions.push({ divider: true, label: '', action: () => {} });
  }

  // Move to zone
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

  // Clamp to viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 200;
  const menuH = actions.length * 30;
  const clampedX = Math.min(x, vw - menuW - 8);
  const clampedY = Math.min(y, vh - menuH - 8);

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
      </div>

      {actions.map((action, i) => {
        if (action.divider) {
          return <div key={i} style={{ height: 1, background: '#2d2d4a', margin: '2px 0' }} />;
        }
        return (
          <button
            key={i}
            onClick={action.action}
            disabled={action.disabled}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 14px',
              background: 'none',
              border: 'none',
              cursor: action.disabled ? 'not-allowed' : 'pointer',
              textAlign: 'left',
              fontSize: 12,
              color: action.danger ? '#f87171' : action.disabled ? '#4b5563' : '#e2e8f0',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = '#2d2d4a'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = 'none'; }}
          >
            {action.label}
          </button>
        );
      })}
    </div>
  );
}
