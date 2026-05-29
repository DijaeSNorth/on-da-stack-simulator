import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CardImage } from '../cards/CardImage';
import type { CardState } from '../../types/game';

export function ZoneDrawer() {
  const store = useGameStore();
  const { ui, game } = store;
  const [search, setSearch] = useState('');

  if (!ui.zoneDrawer) return null;
  const { zone, playerId } = ui.zoneDrawer;

  const player = game.players.find(p => p.id === playerId);
  if (!player) return null;

  const zoneCards: CardState[] = (zone === 'graveyard'
    ? player.graveyard
    : zone === 'exile'
    ? player.exile
    : player.library
  ).map(id => game.cards[id]).filter(Boolean) as CardState[];

  const filtered = search
    ? zoneCards.filter(c =>
        c.definition.name.toLowerCase().includes(search.toLowerCase()) ||
        c.definition.typeLine.toLowerCase().includes(search.toLowerCase())
      )
    : zoneCards;

  const zoneColors: Record<string, string> = {
    graveyard: '#78350f',
    exile: '#581c87',
    library: '#1e3a5f',
  };

  const zoneLabel: Record<string, string> = {
    graveyard: 'Graveyard',
    exile: 'Exile Zone',
    library: 'Library',
  };

  return (
    <div
      data-testid="zone-drawer"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.8)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
      onClick={store.closeZoneDrawer}
    >
      <div
        style={{
          background: '#111827',
          border: `1px solid ${zoneColors[zone]}`,
          borderBottom: 'none',
          borderRadius: '12px 12px 0 0',
          width: '100%',
          maxWidth: 900,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
              {player.name}'s {zoneLabel[zone]}
            </div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {zoneCards.length} card{zoneCards.length !== 1 ? 's' : ''}
            </div>
          </div>

          <input
            placeholder="Search cards..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              flex: 1,
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 12,
              color: '#e2e8f0',
              outline: 'none',
            }}
          />

          <button
            onClick={store.closeZoneDrawer}
            style={{
              background: 'none', border: 'none',
              color: '#64748b', cursor: 'pointer', fontSize: 20,
              lineHeight: 1, padding: '0 4px',
            }}
          >×</button>
        </div>

        {/* Cards grid */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: 12,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignContent: 'flex-start',
        }}>
          {filtered.length === 0 ? (
            <div style={{
              width: '100%', textAlign: 'center', color: '#334155',
              fontSize: 12, fontStyle: 'italic', padding: 24,
            }}>
              {search ? 'No cards match your search' : 'Zone is empty'}
            </div>
          ) : (
            filtered.map((card: CardState) => (
              <div
                key={card.instanceId}
                data-testid={`zone-card-${card.instanceId}`}
                style={{
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                }}
                onClick={() => store.setCardPreview(card.instanceId)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  store.openCardContextMenu(card.instanceId, e.clientX, e.clientY);
                }}
                title={card.definition.name}
              >
                <CardImage card={card} size="compact" />
                <div style={{ fontSize: 8, color: '#64748b', textAlign: 'center', maxWidth: 46, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {card.definition.name}
                </div>
                {/* Exile reason */}
                {card.zone === 'exile' && card.exileReason && (
                  <div style={{ fontSize: 7, color: '#f97316', textAlign: 'center', maxWidth: 46 }}>
                    {card.exileReason.slice(0, 12)}…
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
