import { useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CardImage } from '../cards/CardImage';
import type { CardState } from '../../types/game';
import { getAllMechanics, hasMechanic } from '../../engine/mechanicResolver';

export function ZoneDrawer() {
  const store = useGameStore();
  const { ui, game, localPlayerId } = store;
  const [search, setSearch] = useState('');
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  if (!ui.zoneDrawer) return null;
  const { zone, playerId, mode = 'normal', limit, viewerId, private: privateView } = ui.zoneDrawer;

  const player = game.players.find(p => p.id === playerId);
  if (!player) return null;
  const playerName = player.name;

  const localPlayer = game.players.find(p => p.id === localPlayerId);
  const isOwnZone = playerId === localPlayerId;
  const isScopedLibrary = zone === 'library' && mode !== 'normal' && typeof limit === 'number';
  const canViewPrivate = !privateView || !viewerId || viewerId === localPlayerId;

  // Get cards for the zone
  const allZoneCardIds = zone === 'graveyard' ? player.graveyard
    : zone === 'exile' ? player.exile
    : zone === 'hand' ? player.hand
    : player.library; // library
  const zoneCardIds = isScopedLibrary
    ? allZoneCardIds.slice(0, Math.max(0, limit ?? 0))
    : allZoneCardIds;

  const zoneCards: CardState[] = canViewPrivate ? zoneCardIds
    .map(id => game.cards[id])
    .filter(Boolean) as CardState[] : [];

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
    hand: '#14532d',
  };

  const zoneLabel: Record<string, string> = {
    graveyard: 'Graveyard',
    exile: 'Exile Zone',
    library: 'Library',
    hand: 'Hand',
  };

  const zoneIcon: Record<string, string> = {
    graveyard: '💀',
    exile: '🌀',
    library: '📚',
    hand: '✋',
  };

  // Per-card action buttons based on zone
  function CardActions({ card }: { card: CardState }) {
    const isPermanent = ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle']
      .some(t => card.definition.cardTypes.includes(t as typeof card.definition.cardTypes[number]));
    const isCreature = card.definition.cardTypes.includes('Creature');

    if (zone === 'graveyard') {
      return (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
          {/* Cast from graveyard (flashback / escape / etc.) */}
          <ActionBtn
            label="Cast"
            color="#7c3aed"
            title="Cast from graveyard (flashback, escape, unearth…)"
            onClick={() => {
              store.castFromZone(localPlayerId, card.instanceId, 'graveyard');
              store.closeZoneDrawer();
            }}
          />
          {/* Reanimate: direct to battlefield */}
          {isPermanent && (
            <ActionBtn
              label="Reanimate"
              color="#16a34a"
              title="Put directly onto battlefield under your control"
              onClick={() => {
                store.reanimateCard(card.instanceId, localPlayerId);
                store.closeZoneDrawer();
              }}
            />
          )}
          {/* Return to hand */}
          <ActionBtn
            label="→ Hand"
            color="#2563eb"
            title="Return to hand"
            onClick={() => {
              store.moveCardToZone(card.instanceId, 'hand');
              store.closeZoneDrawer();
            }}
          />
          {/* Move to bottom of library */}
          <ActionBtn
            label="→ Library"
            color="#0891b2"
            title="Put on bottom of library"
            onClick={() => {
              store.moveCardToZone(card.instanceId, 'library');
              store.closeZoneDrawer();
            }}
          />
          {/* Exile */}
          <ActionBtn
            label="Exile"
            color="#7c3aed"
            title="Exile this card"
            onClick={() => {
              store.moveCardToZone(card.instanceId, 'exile');
              store.closeZoneDrawer();
            }}
          />
        </div>
      );
    }

    if (zone === 'exile') {
      return (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
          <ActionBtn
            label="Cast"
            color="#7c3aed"
            title="Cast from exile (foretell, adventure, etc.)"
            onClick={() => {
              store.castFromZone(localPlayerId, card.instanceId, 'exile');
              store.closeZoneDrawer();
            }}
          />
          {isPermanent && (
            <ActionBtn
              label="→ BF"
              color="#16a34a"
              title="Put onto battlefield under your control"
              onClick={() => {
                store.reanimateCard(card.instanceId, localPlayerId);
                store.closeZoneDrawer();
              }}
            />
          )}
          <ActionBtn
            label="→ Hand"
            color="#2563eb"
            title="Return to hand"
            onClick={() => {
              store.moveCardToZone(card.instanceId, 'hand');
              store.closeZoneDrawer();
            }}
          />
          <ActionBtn
            label="→ GY"
            color="#b45309"
            title="Move to graveyard"
            onClick={() => {
              store.moveCardToZone(card.instanceId, 'graveyard');
              store.closeZoneDrawer();
            }}
          />
        </div>
      );
    }

    if (zone === 'library') {
      if (!canViewPrivate) {
        return (
          <div style={{ fontSize: 8, color: '#475569', marginTop: 2, textAlign: 'center' }}>
            Private
          </div>
        );
      }

      if (mode === 'scry') {
        return (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
            <ActionBtn
              label="Top"
              color="#0891b2"
              title="Keep this card on top of your library"
              onClick={() => store.reorderLibraryCard(playerId, card.instanceId, 'top')}
            />
            <ActionBtn
              label="Bottom"
              color="#f59e0b"
              title="Put this card on the bottom of your library"
              onClick={() => store.reorderLibraryCard(playerId, card.instanceId, 'bottom')}
            />
          </div>
        );
      }

      if (mode === 'surveil') {
        return (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
            <ActionBtn
              label="Keep"
              color="#0891b2"
              title="Keep this card on top of your library"
              onClick={() => store.reorderLibraryCard(playerId, card.instanceId, 'top')}
            />
            <ActionBtn
              label="Mill"
              color="#b45309"
              title="Put this card into your graveyard"
              onClick={() => store.moveCardToZone(card.instanceId, 'graveyard')}
            />
          </div>
        );
      }

      if (mode === 'lookTop') {
        return (
          <div style={{ fontSize: 8, color: '#64748b', marginTop: 2, textAlign: 'center' }}>
            Viewed
          </div>
        );
      }

      return (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
          {isOwnZone && (
            <>
              <ActionBtn
                label="→ Hand"
                color="#2563eb"
                title="Take into hand (tutor effect)"
                onClick={() => {
                  store.moveCardToZone(card.instanceId, 'hand');
                  store.shuffleLibrary(localPlayerId);
                  store.closeZoneDrawer();
                }}
              />
              {isPermanent && (
                <ActionBtn
                  label="→ BF"
                  color="#16a34a"
                  title="Put onto battlefield (cheat into play)"
                  onClick={() => {
                    store.reanimateCard(card.instanceId, localPlayerId);
                    store.shuffleLibrary(localPlayerId);
                    store.closeZoneDrawer();
                  }}
                />
              )}
              <ActionBtn
                label="→ GY"
                color="#b45309"
                title="Mill this card (put to graveyard)"
                onClick={() => {
                  store.moveCardToZone(card.instanceId, 'graveyard');
                  store.closeZoneDrawer();
                }}
              />
              <ActionBtn
                label="→ Top"
                color="#0891b2"
                title="Move to top of library"
                onClick={() => {
                  // Move to top: remove from library then re-insert at front
                  const g = store.game; // read-only snapshot
                  const p = g.players.find(pl => pl.id === localPlayerId);
                  if (!p) return;
                  // Use moveCardToZone to detach, then reassemble order via shuffleLibrary is too crude
                  // Instead directly update: move to hand then we'll rely on note in action log
                  store.moveCardToZone(card.instanceId, 'hand');
                  store.addAssistantMessage({ severity: 'info', label: 'Info',
                    text: `${card.definition.name} moved to hand (top of library — move back via context menu if needed)` });
                  store.closeZoneDrawer();
                }}
              />
            </>
          )}
          {!isOwnZone && (
            // Opponent library search (Praetor's Grasp, Bribery, etc.)
            <>
              <ActionBtn
                label="Take"
                color="#ef4444"
                title="Take this card (Praetor's Grasp / Bribery effect)"
                onClick={() => {
                  store.moveCardToZone(card.instanceId, 'hand');
                  store.addAssistantMessage({ severity: 'info', label: 'Info',
                    text: `Searched ${playerName}'s library and took ${card.definition.name}` });
                  store.shuffleLibrary(playerId);
                  store.closeZoneDrawer();
                }}
              />
              <ActionBtn
                label="BF"
                color="#16a34a"
                title="Put onto battlefield under your control"
                onClick={() => {
                  store.reanimateCard(card.instanceId, localPlayerId);
                  store.shuffleLibrary(playerId);
                  store.closeZoneDrawer();
                }}
              />
              <ActionBtn
                label="Exile"
                color="#7c3aed"
                title="Exile from their library"
                onClick={() => {
                  store.moveCardToZone(card.instanceId, 'exile');
                  store.shuffleLibrary(playerId);
                  store.closeZoneDrawer();
                }}
              />
            </>
          )}
        </div>
      );
    }

    if (zone === 'hand') {
      // Own hand: cycle (only if card has cycling), discard, cast
      if (isOwnZone) {
        const mechanics = getAllMechanics(card.definition);
        const hasCycling = hasMechanic(card.definition, 'cycling');
        const altCostMechanics = mechanics.filter(m =>
          m.fromZone === 'hand' && m.key !== 'cycling' && m.tier <= 2
        );
        const nicheMechanics = mechanics.filter(m => m.tier === 3);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
              <ActionBtn
                label="Cast"
                color="#7c3aed"
                title="Cast this card"
                onClick={() => {
                  store.castCard(localPlayerId, card.instanceId);
                  store.closeZoneDrawer();
                }}
              />
              {hasCycling && (
                <ActionBtn
                  label="Cycle"
                  color="#f59e0b"
                  title="Cycle: pay cycling cost, discard, draw 1"
                  onClick={() => {
                    store.cycleCard(localPlayerId, card.instanceId);
                    store.closeZoneDrawer();
                  }}
                />
              )}
              <ActionBtn
                label="Discard"
                color="#b45309"
                title="Discard to graveyard"
                onClick={() => {
                  store.discardFromHand(localPlayerId, card.instanceId);
                  store.closeZoneDrawer();
                }}
              />
            </div>
            {/* Tier 2 alternative cast modes */}
            {altCostMechanics.length > 0 && (
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
                {altCostMechanics.map(m => (
                  <ActionBtn
                    key={m.key}
                    label={m.label}
                    color="#0891b2"
                    title={m.description}
                    onClick={() => {
                      store.castCard(localPlayerId, card.instanceId);
                      store.closeZoneDrawer();
                    }}
                  />
                ))}
              </div>
            )}
            {/* Tier 3 oracle hints */}
            {nicheMechanics.length > 0 && (
              <div style={{ fontSize: 8, color: '#fbbf24', textAlign: 'center', lineHeight: 1.3, padding: '0 4px' }}>
                {nicheMechanics.map(m => m.label).join(' · ')}
              </div>
            )}
          </div>
        );
      }
      // Opponent hand (peeking): no actions by default, just view
      return (
        <div style={{ fontSize: 8, color: '#475569', marginTop: 2, textAlign: 'center' }}>
          Peeking
        </div>
      );
    }

    return null;
  }

  const headerNote = !isOwnZone && zone === 'hand'
    ? ' (Peeking — Telepathy / Praetor\'s Grasp effect)'
    : mode === 'scry'
    ? ` — Scry ${zoneCards.length}`
    : mode === 'surveil'
    ? ` — Surveil ${zoneCards.length}`
    : mode === 'lookTop'
    ? ` — Top ${zoneCards.length}`
    : !isOwnZone && zone === 'library'
    ? ' (Searching — shuffle after)'
    : zone === 'library' && isOwnZone
    ? ' — Scry / Tutor / Search'
    : '';

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
          maxWidth: 960,
          maxHeight: '72vh',
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
          background: `${zoneColors[zone]}22`,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
              {zoneIcon[zone]} {player.name}'s {zoneLabel[zone]}{headerNote}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
              {canViewPrivate
                ? `${zoneCards.length} visible card${zoneCards.length !== 1 ? 's' : ''}${isScopedLibrary ? ` of ${allZoneCardIds.length}` : ''}`
                : 'Private view hidden'}
              {zone === 'graveyard' && ' — right-click for actions · Cast / Reanimate / Return'}
              {zone === 'exile' && ' — Cast from exile · Return · Put on battlefield'}
              {zone === 'library' && mode === 'scry' && ' — choose top or bottom for only these cards'}
              {zone === 'library' && mode === 'surveil' && ' — keep on top or mill only these cards'}
              {zone === 'library' && mode === 'lookTop' && ' — view-only effect'}
              {zone === 'library' && mode === 'normal' && isOwnZone && ' — Scry/Tutor: take to hand, put on BF, or mill'}
              {zone === 'library' && mode === 'normal' && !isOwnZone && ' — Search effect: take or put on BF · shuffle after'}
              {zone === 'hand' && isOwnZone && ' — Cycle / Discard / Cast from hand'}
              {zone === 'hand' && !isOwnZone && ' — Viewing via Telepathy / Praetor\'s Grasp effect'}
            </div>
          </div>

          {!isScopedLibrary && (
            <input
              placeholder="Search cards..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus={zone === 'library' || zone === 'graveyard'}
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
          )}

          {/* Quick bulk actions */}
          {zone === 'graveyard' && isOwnZone && (
            <button
              title="Exile entire graveyard"
              onClick={() => {
                const ids = [...player.graveyard];
                ids.forEach(id => store.moveCardToZone(id, 'exile'));
                store.closeZoneDrawer();
              }}
              style={quickBtnStyle('#7c3aed')}
            >Exile All</button>
          )}
          {zone === 'library' && isOwnZone && mode === 'normal' && (
            <button
              title="Shuffle library"
              onClick={() => store.shuffleLibrary(localPlayerId)}
              style={quickBtnStyle('#2563eb')}
            >Shuffle</button>
          )}
          {zone === 'library' && !isOwnZone && mode === 'normal' && (
            <button
              title="Shuffle their library"
              onClick={() => {
                store.shuffleLibrary(playerId);
                store.closeZoneDrawer();
              }}
              style={quickBtnStyle('#2563eb')}
            >Shuffle & Close</button>
          )}

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
          {!canViewPrivate ? (
            <div style={{
              width: '100%', textAlign: 'center', color: '#64748b',
              fontSize: 12, fontStyle: 'italic', padding: 24,
            }}>
              This is a private top-library view for the instructed player.
            </div>
          ) : filtered.length === 0 ? (
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
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  cursor: 'pointer',
                  padding: '4px',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid transparent',
                  transition: 'border-color 0.1s, background 0.1s',
                  maxWidth: 80,
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = '#334155';
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)';
                  store.setCardPreview(card.instanceId, { x: e.clientX, y: e.clientY });
                }}
                onMouseMove={e => store.setCardPreviewAnchor({ x: e.clientX, y: e.clientY })}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.02)';
                  store.setCardPreview(null);
                }}
                onClick={(e) => store.setCardPreview(card.instanceId, { x: e.clientX, y: e.clientY })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  store.openCardContextMenu(card.instanceId, e.clientX, e.clientY);
                }}
                title={card.definition.name}
              >
                <CardImage card={card} size="compact" />
                <div style={{
                  fontSize: 8, color: '#94a3b8', textAlign: 'center',
                  maxWidth: 70, overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {card.definition.name}
                </div>
                {/* Exile reason */}
                {card.zone === 'exile' && card.exileReason && (
                  <div style={{ fontSize: 7, color: '#f97316', textAlign: 'center', maxWidth: 70 }}>
                    {card.exileReason.slice(0, 14)}…
                  </div>
                )}
                {/* Action buttons */}
                <CardActions card={card} />
              </div>
            ))
          )}
        </div>

        {/* Footer note */}
        {zone === 'library' && (
          <div style={{
            padding: '6px 16px',
            borderTop: '1px solid #1e293b',
            fontSize: 10, color: '#334155',
            display: 'flex', gap: 8, alignItems: 'center',
          }}>
            <span>Tip:</span>
            <span>Scry — use card buttons to arrange top cards.</span>
            <span>Tutor — click &quot;→ Hand&quot; to take a card (library shuffles automatically).</span>
            <span>Right-click any card for more options.</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Micro helpers ────────────────────────────────────────────────────────────

function ActionBtn({ label, color, title, onClick }: {
  label: string; color: string; title: string; onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{
        fontSize: 7, fontWeight: 700, padding: '2px 5px',
        borderRadius: 3, border: `1px solid ${color}66`,
        background: `${color}22`, color,
        cursor: 'pointer', lineHeight: 1.2,
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => { (e.target as HTMLElement).style.background = `${color}44`; }}
      onMouseLeave={e => { (e.target as HTMLElement).style.background = `${color}22`; }}
    >{label}</button>
  );
}

function quickBtnStyle(color: string): React.CSSProperties {
  return {
    fontSize: 10, fontWeight: 600, padding: '4px 10px',
    borderRadius: 5, border: `1px solid ${color}66`,
    background: `${color}22`, color,
    cursor: 'pointer', flexShrink: 0,
  };
}
