import { useMemo, useState, type CSSProperties } from 'react';
import { useGameStore } from '../../store/gameStore';
import { CardImage } from '../cards/CardImage';
import type { CardState } from '../../types/game';
import { getAllMechanics, hasMechanic } from '../../engine/mechanicResolver';
import { canControlPlayer } from '../../engine/playerPermissions';
import {
  buildZoneDrawerView,
  canViewZoneCards,
  getExilePermissionLabels,
  getExilePermissionTitle,
  getZoneCardIds,
  getZonePrivacyLabel,
  type ZoneDrawerZone,
  type ZoneGroupMode,
  type ZoneSortMode,
} from './zoneDrawerModel';

const zoneColors: Record<ZoneDrawerZone, string> = {
  graveyard: '#78350f',
  exile: '#581c87',
  library: '#1e3a5f',
  hand: '#14532d',
  command: '#92400e',
};

const zoneLabel: Record<ZoneDrawerZone, string> = {
  graveyard: 'Graveyard',
  exile: 'Exile Zone',
  library: 'Library',
  hand: 'Hand',
  command: 'Command Zone',
};

const zoneIcon: Record<ZoneDrawerZone, string> = {
  graveyard: 'GY',
  exile: 'EX',
  library: 'LIB',
  hand: 'HAND',
  command: 'CMD',
};

export function ZoneDrawer() {
  const store = useGameStore();
  const { ui, game, localPlayerId } = store;
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<ZoneSortMode>('order');
  const [groupMode, setGroupMode] = useState<ZoneGroupMode>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  if (!ui.zoneDrawer) return null;
  const { zone: rawZone, playerId, mode = 'normal', limit, viewerId, private: privateView } = ui.zoneDrawer;
  const zone = rawZone as ZoneDrawerZone;

  const player = game.players.find(p => p.id === playerId);
  if (!player) return null;
  const playerName = player.name;

  const isOwnZone = playerId === localPlayerId;
  const multiplayerStatus = store.multiplayer.isSpectator ? 'spectator' : store.multiplayer.status;
  const canControlZone = canControlPlayer(localPlayerId, playerId, multiplayerStatus, ui.judgeMode);
  const isScopedLibrary = zone === 'library' && mode !== 'normal' && typeof limit === 'number';
  const canViewCards = canViewZoneCards({
    zone,
    playerId,
    localPlayerId,
    multiplayerStatus,
    judgeMode: ui.judgeMode,
    privateView,
    viewerId,
  });

  const allZoneCardIds = getZoneCardIds(player, zone);
  const zoneCardIds = isScopedLibrary ? allZoneCardIds.slice(0, Math.max(0, limit ?? 0)) : allZoneCardIds;
  const zoneCards: CardState[] = canViewCards
    ? zoneCardIds.map(id => game.cards[id]).filter(Boolean) as CardState[]
    : [];

  const view = useMemo(() => buildZoneDrawerView(zoneCards, {
    search,
    sortMode,
    groupMode,
    canViewCards,
    totalCount: zoneCardIds.length,
  }), [zoneCards, search, sortMode, groupMode, canViewCards, zoneCardIds.length]);

  const privacyLabel = getZonePrivacyLabel(zone, allZoneCardIds.length, canViewCards);
  const headerNote = getHeaderNote(zone, mode, isOwnZone, zoneCards.length);
  const showControls = canViewCards && zoneCards.length > 0;

  function CardActions({ card }: { card: CardState }) {
    const isPermanent = ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle']
      .some(t => card.definition.cardTypes.includes(t as typeof card.definition.cardTypes[number]));

    if (!canControlZone) return <ActionStatus label="View only" />;

    if (zone === 'graveyard') {
      return (
        <ActionRow>
          <ActionBtn label="Cast" color="#7c3aed" title="Cast from graveyard" onClick={() => { store.castFromZone(localPlayerId, card.instanceId, 'graveyard'); store.closeZoneDrawer(); }} />
          {isPermanent && <ActionBtn label="Reanimate" color="#16a34a" title="Put directly onto battlefield under your control" onClick={() => { store.reanimateCard(card.instanceId, localPlayerId); store.closeZoneDrawer(); }} />}
          <ActionBtn label="To Hand" color="#2563eb" title="Return to hand" onClick={() => { store.moveCardToZone(card.instanceId, 'hand'); store.closeZoneDrawer(); }} />
          <ActionBtn label="To Library" color="#0891b2" title="Put on bottom of library" onClick={() => { store.moveCardToZone(card.instanceId, 'library'); store.closeZoneDrawer(); }} />
          <ActionBtn label="Exile" color="#7c3aed" title="Exile this card" onClick={() => { store.moveCardToZone(card.instanceId, 'exile'); store.closeZoneDrawer(); }} />
        </ActionRow>
      );
    }

    if (zone === 'exile') {
      const labels = getExilePermissionLabels(card);
      const permission = card.exilePermission;
      const canUsePermission = Boolean(permission && (permission.ownerId === localPlayerId || ui.judgeMode));
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center', marginTop: 2 }}>
          {labels.length > 0 && (
            <div style={badgeStyle} title={getExilePermissionTitle(card)}>
              {labels.slice(0, 2).join(' / ')}
            </div>
          )}
          <ActionRow>
            <ActionBtn
              label={permission?.alternativeCost ? `Cast ${permission.alternativeCost}` : 'Cast'}
              color="#7c3aed"
              title={labels.length ? getExilePermissionTitle(card) : 'Cast from exile'}
              onClick={() => {
                if (permission && canUsePermission) store.castExiledWithPermission(localPlayerId, card.instanceId);
                else store.castFromZone(localPlayerId, card.instanceId, 'exile');
                store.closeZoneDrawer();
              }}
            />
            {isPermanent && <ActionBtn label="To BF" color="#16a34a" title="Put onto battlefield under your control" onClick={() => { store.reanimateCard(card.instanceId, localPlayerId); store.closeZoneDrawer(); }} />}
            <ActionBtn label="To Hand" color="#2563eb" title="Return to hand" onClick={() => { store.moveCardToZone(card.instanceId, 'hand'); store.closeZoneDrawer(); }} />
            <ActionBtn label="To GY" color="#b45309" title="Move to graveyard" onClick={() => { store.moveCardToZone(card.instanceId, 'graveyard'); store.closeZoneDrawer(); }} />
          </ActionRow>
        </div>
      );
    }

    if (zone === 'library') {
      if (!canViewCards) return <ActionStatus label="Private" />;
      if (mode === 'scry') {
        return <ActionRow><ActionBtn label="Top" color="#0891b2" title="Keep this card on top" onClick={() => store.reorderLibraryCard(playerId, card.instanceId, 'top')} /><ActionBtn label="Bottom" color="#f59e0b" title="Put this card on bottom" onClick={() => store.reorderLibraryCard(playerId, card.instanceId, 'bottom')} /></ActionRow>;
      }
      if (mode === 'surveil') {
        return <ActionRow><ActionBtn label="Keep" color="#0891b2" title="Keep this card on top" onClick={() => store.reorderLibraryCard(playerId, card.instanceId, 'top')} /><ActionBtn label="Mill" color="#b45309" title="Put into graveyard" onClick={() => store.moveCardToZone(card.instanceId, 'graveyard')} /></ActionRow>;
      }
      if (mode === 'lookTop') return <ActionStatus label="Viewed" />;
      return (
        <ActionRow>
          {isOwnZone && <>
            <ActionBtn label="To Hand" color="#2563eb" title="Take into hand" onClick={() => { store.moveCardToZone(card.instanceId, 'hand'); store.shuffleLibrary(localPlayerId); store.closeZoneDrawer(); }} />
            {isPermanent && <ActionBtn label="To BF" color="#16a34a" title="Put onto battlefield" onClick={() => { store.reanimateCard(card.instanceId, localPlayerId); store.shuffleLibrary(localPlayerId); store.closeZoneDrawer(); }} />}
            <ActionBtn label="To GY" color="#b45309" title="Mill this card" onClick={() => { store.moveCardToZone(card.instanceId, 'graveyard'); store.closeZoneDrawer(); }} />
          </>}
          {canControlZone && !isOwnZone && <>
            <ActionBtn label="Take" color="#ef4444" title="Take this card" onClick={() => { store.moveCardToZone(card.instanceId, 'hand'); store.addAssistantMessage({ severity: 'info', label: 'Info', text: `Searched ${playerName}'s library and took ${card.definition.name}` }); store.shuffleLibrary(playerId); store.closeZoneDrawer(); }} />
            {isPermanent && <ActionBtn label="BF" color="#16a34a" title="Put onto battlefield under your control" onClick={() => { store.reanimateCard(card.instanceId, localPlayerId); store.shuffleLibrary(playerId); store.closeZoneDrawer(); }} />}
            <ActionBtn label="Exile" color="#7c3aed" title="Exile from their library" onClick={() => { store.moveCardToZone(card.instanceId, 'exile'); store.shuffleLibrary(playerId); store.closeZoneDrawer(); }} />
          </>}
        </ActionRow>
      );
    }

    if (zone === 'hand') {
      if (isOwnZone) {
        const mechanics = getAllMechanics(card.definition);
        const hasCycling = hasMechanic(card.definition, 'cycling');
        const altCostMechanics = mechanics.filter(m => m.fromZone === 'hand' && m.key !== 'cycling' && m.tier <= 2);
        const nicheMechanics = mechanics.filter(m => m.tier === 3);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
            <ActionRow>
              <ActionBtn label="Cast" color="#7c3aed" title="Cast this card" onClick={() => { store.castCard(localPlayerId, card.instanceId); store.closeZoneDrawer(); }} />
              {hasCycling && <ActionBtn label="Cycle" color="#f59e0b" title="Cycle this card" onClick={() => { store.cycleCard(localPlayerId, card.instanceId); store.closeZoneDrawer(); }} />}
              <ActionBtn label="Discard" color="#b45309" title="Discard to graveyard" onClick={() => { store.discardFromHand(localPlayerId, card.instanceId); store.closeZoneDrawer(); }} />
            </ActionRow>
            {altCostMechanics.length > 0 && <ActionRow>{altCostMechanics.map(m => <ActionBtn key={m.key} label={m.label} color="#0891b2" title={m.description} onClick={() => { store.castCard(localPlayerId, card.instanceId); store.closeZoneDrawer(); }} />)}</ActionRow>}
            {nicheMechanics.length > 0 && <div style={{ fontSize: 8, color: '#fbbf24', textAlign: 'center', lineHeight: 1.3, padding: '0 4px' }}>{nicheMechanics.map(m => m.label).join(' / ')}</div>}
          </div>
        );
      }
      return <ActionStatus label="Peeking" />;
    }

    if (zone === 'command') {
      return (
        <ActionRow>
          <ActionBtn label="Cast" color="#7c3aed" title="Cast from command zone" onClick={() => { store.castFromZone(localPlayerId, card.instanceId, 'command'); store.closeZoneDrawer(); }} />
          {isPermanent && <ActionBtn label="To BF" color="#16a34a" title="Put onto battlefield" onClick={() => { store.reanimateCard(card.instanceId, localPlayerId); store.closeZoneDrawer(); }} />}
        </ActionRow>
      );
    }

    return null;
  }

  function toggleGroup(key: string) {
    setCollapsedGroups(previous => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div data-testid="zone-drawer" style={overlayStyle} onClick={store.closeZoneDrawer}>
      <div style={{ ...drawerStyle, borderColor: zoneColors[zone] }} onClick={e => e.stopPropagation()}>
        <div style={{ ...headerStyle, background: `${zoneColors[zone]}22` }}>
          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
              <span style={zoneMarkStyle}>{zoneIcon[zone]}</span> {player.name}'s {zoneLabel[zone]}{headerNote}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
              {canViewCards
                ? `${view.filteredCount} shown of ${zoneCards.length} visible${isScopedLibrary ? `, ${allZoneCardIds.length} total` : ''}`
                : privacyLabel}
              {view.displayMode === 'compact' && canViewCards ? ' - compact large-zone view' : ''}
            </div>
          </div>

          {showControls && (
            <div style={controlsStyle}>
              <input
                placeholder="Search name, type, rules, mechanic..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                autoFocus={zone === 'library' || zone === 'graveyard'}
                style={inputStyle}
              />
              <select value={sortMode} onChange={e => setSortMode(e.target.value as ZoneSortMode)} style={selectStyle} title="Sort cards">
                <option value="order">Zone order</option>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="name">Name</option>
                <option value="manaValue">Mana value</option>
                <option value="cardType">Type</option>
                <option value="color">Color</option>
              </select>
              <select value={groupMode} onChange={e => setGroupMode(e.target.value as ZoneGroupMode)} style={selectStyle} title="Group cards">
                <option value="none">No groups</option>
                <option value="cardType">Type</option>
                <option value="manaValue">Mana value</option>
                <option value="color">Color</option>
                <option value="owner">Owner</option>
                <option value="controller">Controller</option>
              </select>
            </div>
          )}

          {zone === 'graveyard' && isOwnZone && (
            <button title="Exile entire graveyard" onClick={() => { [...player.graveyard].forEach(id => store.moveCardToZone(id, 'exile')); store.closeZoneDrawer(); }} style={quickBtnStyle('#7c3aed')}>Exile All</button>
          )}
          {zone === 'library' && isOwnZone && mode === 'normal' && (
            <button title="Shuffle library" onClick={() => store.shuffleLibrary(localPlayerId)} style={quickBtnStyle('#2563eb')}>Shuffle</button>
          )}
          {zone === 'library' && !isOwnZone && mode === 'normal' && canControlZone && (
            <button title="Shuffle their library" onClick={() => { store.shuffleLibrary(playerId); store.closeZoneDrawer(); }} style={quickBtnStyle('#2563eb')}>Shuffle & Close</button>
          )}

          <button onClick={store.closeZoneDrawer} style={closeStyle}>x</button>
        </div>

        <div style={bodyStyle}>
          {!canViewCards ? (
            <div style={emptyStyle}>{privacyLabel}</div>
          ) : view.visibleCards.length === 0 ? (
            <div style={emptyStyle}>{search ? 'No cards match your search' : 'Zone is empty'}</div>
          ) : (
            view.groups.map(group => {
              const collapsed = collapsedGroups.has(group.key);
              return (
                <section key={group.key} style={groupSectionStyle}>
                  {groupMode !== 'none' && (
                    <button type="button" onClick={() => toggleGroup(group.key)} style={groupHeaderStyle}>
                      <span>{collapsed ? '+' : '-'} {group.label}</span>
                      <span>{group.cards.length}</span>
                    </button>
                  )}
                  {!collapsed && (
                    <div style={view.displayMode === 'compact' ? compactListStyle : gridStyle}>
                      {group.cards.map(card => view.displayMode === 'compact'
                        ? <CompactZoneCard key={card.instanceId} card={card} actions={<CardActions card={card} />} />
                        : <GridZoneCard key={card.instanceId} card={card} actions={<CardActions card={card} />} />)}
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>

        {zone === 'library' && (
          <div style={footerStyle}>
            <span>Tip:</span>
            <span>Scry and surveil use card buttons on only the visible cards.</span>
            <span>Tutor/search actions shuffle where required.</span>
            <span>Right-click any visible card for more options.</span>
          </div>
        )}
      </div>
    </div>
  );

  function GridZoneCard({ card, actions }: { card: CardState; actions: React.ReactNode }) {
    return (
      <div data-testid={`zone-card-${card.instanceId}`} style={gridCardStyle} onMouseEnter={e => handleCardEnter(e, card)} onMouseMove={e => store.setCardPreviewAnchor({ x: e.clientX, y: e.clientY })} onMouseLeave={handleCardLeave} onClick={e => store.setCardPreview(card.instanceId, { x: e.clientX, y: e.clientY })} onContextMenu={e => { e.preventDefault(); store.openCardContextMenu(card.instanceId, e.clientX, e.clientY); }} title={card.definition.name}>
        <CardImage card={card} size="compact" />
        <div style={cardNameStyle}>{card.definition.name}</div>
        {card.zone === 'exile' && card.exileReason && <div style={exileReasonStyle}>{card.exileReason.slice(0, 18)}</div>}
        {actions}
      </div>
    );
  }

  function CompactZoneCard({ card, actions }: { card: CardState; actions: React.ReactNode }) {
    return (
      <div data-testid={`zone-card-${card.instanceId}`} style={compactCardStyle} onMouseEnter={e => handleCardEnter(e, card)} onMouseMove={e => store.setCardPreviewAnchor({ x: e.clientX, y: e.clientY })} onMouseLeave={handleCardLeave} onClick={e => store.setCardPreview(card.instanceId, { x: e.clientX, y: e.clientY })} onContextMenu={e => { e.preventDefault(); store.openCardContextMenu(card.instanceId, e.clientX, e.clientY); }} title={card.definition.name}>
        <CardImage card={card} size="tiny" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.definition.name}</div>
          <div style={{ fontSize: 9, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.definition.typeLine}</div>
        </div>
        <div style={{ flexShrink: 0 }}>{actions}</div>
      </div>
    );
  }

  function handleCardEnter(e: React.MouseEvent<HTMLElement>, card: CardState) {
    e.currentTarget.style.borderColor = '#334155';
    e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
    store.setCardPreview(card.instanceId, { x: e.clientX, y: e.clientY });
  }

  function handleCardLeave(e: React.MouseEvent<HTMLElement>) {
    e.currentTarget.style.borderColor = 'transparent';
    e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
    store.setCardPreview(null);
  }
}

function getHeaderNote(zone: ZoneDrawerZone, mode: string, isOwnZone: boolean, visibleCount: number): string {
  if (mode === 'scry') return ` - Scry ${visibleCount}`;
  if (mode === 'surveil') return ` - Surveil ${visibleCount}`;
  if (mode === 'lookTop') return ` - Top ${visibleCount}`;
  if (zone === 'library' && isOwnZone) return ' - Scry / Tutor / Search';
  if ((zone === 'library' || zone === 'hand') && !isOwnZone) return ' (Private)';
  return '';
}

function ActionRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>{children}</div>;
}

function ActionStatus({ label }: { label: string }) {
  return <div style={{ fontSize: 8, color: '#64748b', marginTop: 2, textAlign: 'center' }}>{label}</div>;
}

function ActionBtn({ label, color, title, onClick }: { label: string; color: string; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={e => { e.stopPropagation(); onClick(); }} style={{ fontSize: 7, fontWeight: 700, padding: '2px 5px', borderRadius: 3, border: `1px solid ${color}66`, background: `${color}22`, color, cursor: 'pointer', lineHeight: 1.2 }}>
      {label}
    </button>
  );
}

function quickBtnStyle(color: string): CSSProperties {
  return { fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: `1px solid ${color}66`, background: `${color}22`, color, cursor: 'pointer', flexShrink: 0 };
}

const overlayStyle: CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 10000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' };
const drawerStyle: CSSProperties = { background: '#111827', border: '1px solid', borderBottom: 'none', borderRadius: '12px 12px 0 0', width: '100%', maxWidth: 1040, maxHeight: '74vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
const headerStyle: CSSProperties = { padding: '12px 16px', borderBottom: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 12 };
const zoneMarkStyle: CSSProperties = { display: 'inline-flex', minWidth: 34, justifyContent: 'center', borderRadius: 999, padding: '1px 6px', background: 'rgba(255,255,255,0.08)', color: '#cbd5e1', fontSize: 10 };
const controlsStyle: CSSProperties = { flex: 1, display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) 124px 124px', gap: 8, alignItems: 'center' };
const inputStyle: CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#e2e8f0', outline: 'none', minWidth: 0 };
const selectStyle: CSSProperties = { background: '#172033', border: '1px solid #334155', borderRadius: 6, padding: '6px 8px', fontSize: 11, color: '#cbd5e1', outline: 'none' };
const closeStyle: CSSProperties = { background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 4px' };
const bodyStyle: CSSProperties = { flex: 1, overflowY: 'auto', padding: 12 };
const gridStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' };
const compactListStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6 };
const groupSectionStyle: CSSProperties = { marginBottom: 10 };
const groupHeaderStyle: CSSProperties = { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, padding: '6px 8px', background: 'rgba(15,23,42,0.84)', border: '1px solid #1e293b', borderRadius: 7, color: '#cbd5e1', fontSize: 11, fontWeight: 700, cursor: 'pointer' };
const gridCardStyle: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, cursor: 'pointer', padding: 4, borderRadius: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid transparent', transition: 'border-color 0.1s, background 0.1s', maxWidth: 84 };
const compactCardStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '5px 7px', borderRadius: 7, background: 'rgba(255,255,255,0.02)', border: '1px solid transparent', minWidth: 0 };
const cardNameStyle: CSSProperties = { fontSize: 8, color: '#94a3b8', textAlign: 'center', maxWidth: 74, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const exileReasonStyle: CSSProperties = { fontSize: 7, color: '#f97316', textAlign: 'center', maxWidth: 74, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const badgeStyle: CSSProperties = { fontSize: 8, color: '#c4b5fd', textAlign: 'center', maxWidth: 118, lineHeight: 1.25, border: '1px solid rgba(196,181,253,0.25)', borderRadius: 999, padding: '1px 5px', background: 'rgba(124,58,237,0.15)' };
const emptyStyle: CSSProperties = { width: '100%', textAlign: 'center', color: '#64748b', fontSize: 12, fontStyle: 'italic', padding: 24 };
const footerStyle: CSSProperties = { padding: '6px 16px', borderTop: '1px solid #1e293b', fontSize: 10, color: '#64748b', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' };
