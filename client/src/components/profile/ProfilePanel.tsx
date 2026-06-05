/**
 * ProfilePanel.tsx
 *
 * Combined profile manager + art customization panel.
 * Opens as a modal overlay (same pattern as ReplayPanel, CardSearchPanel).
 *
 * Three views:
 *   1. Profile List  — manage saved profiles (create, select active, delete)
 *   2. Profile Editor — edit profile rendered as a real MTG card frame:
 *        • Name bar, mana cost from color identity
 *        • Art area (avatar initial + color)
 *        • Type line
 *        • Text box with abilities (judge mode, assist verbosity)
 *        • P/T box
 *        • Art Overrides list
 *   3. Art Picker — Scryfall prints search + grid
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useGameStore } from '../../store/gameStore';
import {
  loadProfiles, saveProfile, deleteProfile,
  getActiveProfileId, setActiveProfileId, clearActiveProfile, getActiveProfile,
  createProfile, fetchCardPrints, setArtOverride, removeArtOverride,
  type PlayerProfile, type ScryfallPrint, type ArtOverride,
} from '../../engine/profileStorage';
import { PlayerAvatar } from './PlayerAvatar';
import type { PlayerAvatarImage } from '../../types/game';

const MAX_AVATAR_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_AVATAR_STORED_BYTES = 96 * 1024;
const AVATAR_CANVAS_SIZE = 256;

function dataUrlByteSize(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? '';
  return Math.ceil(base64.length * 0.75);
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image.'));
    img.src = dataUrl;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

async function compressAvatarImage(file: File): Promise<PlayerAvatarImage> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > MAX_AVATAR_SOURCE_BYTES) throw new Error('Image must be 2 MB or smaller before upload.');

  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_CANVAS_SIZE;
  canvas.height = AVATAR_CANVAS_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not resize the image.');

  const sourceSize = Math.min(img.naturalWidth, img.naturalHeight);
  const sourceX = (img.naturalWidth - sourceSize) / 2;
  const sourceY = (img.naturalHeight - sourceSize) / 2;
  ctx.drawImage(img, sourceX, sourceY, sourceSize, sourceSize, 0, 0, AVATAR_CANVAS_SIZE, AVATAR_CANVAS_SIZE);

  for (const quality of [0.82, 0.72, 0.62, 0.52]) {
    const url = canvas.toDataURL('image/webp', quality);
    const byteSize = dataUrlByteSize(url);
    if (byteSize <= MAX_AVATAR_STORED_BYTES) {
      return { source: 'upload', url, byteSize, label: `Uploaded image (${Math.round(byteSize / 1024)} KB)` };
    }
  }

  const fallback = canvas.toDataURL('image/jpeg', 0.58);
  const byteSize = dataUrlByteSize(fallback);
  if (byteSize > MAX_AVATAR_STORED_BYTES) {
    throw new Error('Could not compress image under 96 KB. Try a simpler or smaller picture.');
  }
  return { source: 'upload', url: fallback, byteSize, label: `Uploaded image (${Math.round(byteSize / 1024)} KB)` };
}

// ─── MTG Color Identity mapping ──────────────────────────────────────────────

// Maps a hex color to a rough MTG color identity for mana symbols + frame gradient
function colorToManaSymbols(hex: string): { symbols: string[]; frame: string; textColor: string } {
  const h = parseInt(hex.slice(1), 16);
  const r = (h >> 16) & 0xff;
  const g = (h >> 8) & 0xff;
  const b = h & 0xff;

  // Determine dominant channel
  const max = Math.max(r, g, b);
  const isNeutral = max < 80;
  const isWhite = r > 200 && g > 200 && b > 200;

  if (isNeutral) return { symbols: ['{C}'], frame: 'linear-gradient(180deg, #9e9e9e 0%, #c8c8c8 40%, #a0a0a0 100%)', textColor: '#222' };
  if (isWhite) return { symbols: ['{W}'], frame: 'linear-gradient(180deg, #f9f4dc 0%, #fdfbf0 40%, #e8ddb5 100%)', textColor: '#222' };
  if (r === max && r > g + 40 && r > b + 40) return { symbols: ['{R}'], frame: 'linear-gradient(180deg, #c0392b 0%, #e74c3c 40%, #922b21 100%)', textColor: '#fff' };
  if (g === max && g > r + 40 && g > b + 40) return { symbols: ['{G}'], frame: 'linear-gradient(180deg, #1e8449 0%, #27ae60 40%, #145a32 100%)', textColor: '#fff' };
  if (b === max && b > r + 40 && b > g + 40) return { symbols: ['{U}'], frame: 'linear-gradient(180deg, #1565c0 0%, #2196f3 40%, #0d3c7a 100%)', textColor: '#fff' };
  if (r === max && b > g) return { symbols: ['{B}'], frame: 'linear-gradient(180deg, #1a1a2e 0%, #2c2c54 40%, #0d0d1a 100%)', textColor: '#e8e8e8' };

  // Multi-color (gold)
  return { symbols: ['{W}', '{U}'], frame: 'linear-gradient(180deg, #c8a800 0%, #f5d020 40%, #b8860b 100%)', textColor: '#222' };
}

const MANA_SYMBOL_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  W: { bg: '#f9f6ee', color: '#78716c', border: '#ccc' },
  U: { bg: '#1565c0', color: '#fff', border: '#0d3c7a' },
  B: { bg: '#1a1a2e', color: '#e8e8e8', border: '#555' },
  R: { bg: '#c0392b', color: '#fff', border: '#7b241c' },
  G: { bg: '#1e8449', color: '#fff', border: '#145a32' },
  C: { bg: '#9e9e9e', color: '#fff', border: '#666' },
};

function ManaSymbol({ sym }: { sym: string }) {
  const clean = sym.replace(/[{}]/g, '');
  const s = MANA_SYMBOL_STYLES[clean] ?? { bg: '#666', color: '#fff', border: '#333' };
  return (
    <div style={{
      width: 16, height: 16, borderRadius: '50%',
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      fontSize: 9, fontWeight: 800,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'serif', flexShrink: 0,
    }}>{clean}</div>
  );
}

// ─── MTG Card Frame ───────────────────────────────────────────────────────────

function MtgCardFrame({ profile, onChange }: {
  profile: PlayerProfile;
  onChange: (p: PlayerProfile) => void;
}) {
  const { frame, symbols, textColor } = colorToManaSymbols(profile.color);

  // Derive creature stats from profile settings
  const power = profile.assistantMode === 'ON' ? '5' : profile.assistantMode === 'LIMITED' ? '3' : '1';
  const toughness = profile.assistantVerbosity === 'verbose' ? '6' : profile.assistantVerbosity === 'normal' ? '4' : '2';

  // Abilities text box
  const abilities: string[] = [];
  if (profile.assistantMode === 'ON') abilities.push('Judge Vision — Whenever a player takes an illegal action, draw a card.');
  if (profile.assistantMode === 'LIMITED') abilities.push('Observe — {T}: Look at the top card of target player\'s action log.');
  if (profile.showTriggerReminders) abilities.push('Trigger Memory — Triggered abilities you control can\'t be missed.');
  if (profile.assistantVerbosity === 'verbose') abilities.push('Flavor Text: "Every card tells a story. Every game writes a legend."');

  const isEditing = true; // always inline editing mode

  return (
    <div style={{
      width: 240,
      borderRadius: 12,
      overflow: 'hidden',
      border: '2px solid #8b7536',
      boxShadow: '0 8px 32px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.1)',
      background: frame,
      flexShrink: 0,
      fontFamily: '"Palatino Linotype", "Book Antiqua", Palatino, serif',
      position: 'relative',
    }}>
      {/* Outer card border inner glow */}
      <div style={{
        position: 'absolute', inset: 4, borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.15)',
        pointerEvents: 'none', zIndex: 10,
      }} />

      {/* ── Name bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '5px 8px 4px',
        background: 'rgba(0,0,0,0.3)',
        gap: 6,
      }}>
        <input
          data-testid="profile-name-input"
          value={profile.displayName}
          onChange={e => onChange({ ...profile, displayName: e.target.value })}
          maxLength={28}
          placeholder="Card Name"
          style={{
            background: 'transparent',
            border: 'none',
            outline: 'none',
            flex: 1,
            fontSize: 12,
            fontWeight: 800,
            color: textColor === '#fff' ? '#f5f5f0' : '#1a1208',
            fontFamily: '"Palatino Linotype", serif',
            textShadow: textColor === '#fff' ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
            minWidth: 0,
          }}
        />
        {/* Mana symbols */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {symbols.map((s, i) => <ManaSymbol key={i} sym={s} />)}
        </div>
      </div>

      {/* ── Art area ── */}
      <div style={{
        margin: '0 6px',
        height: 130,
        borderRadius: 4,
        overflow: 'hidden',
        border: '1px solid rgba(0,0,0,0.4)',
        position: 'relative',
        background: profile.avatarStyle === 'gradient'
          ? `radial-gradient(ellipse at 30% 40%, ${profile.color}cc, ${profile.color}44 60%, #0a0a1a)`
          : `radial-gradient(ellipse at center, ${profile.color}88, #0a0a1a)`,
      }}>
        {profile.avatarImage?.url && (
          <img
            src={profile.avatarImage.url}
            alt={`${profile.displayName} avatar art`}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: '50% 35%',
            }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        {/* Large avatar initial */}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 6,
          background: profile.avatarImage?.url ? 'linear-gradient(180deg, rgba(0,0,0,0.1), rgba(0,0,0,0.34))' : 'transparent',
        }}>
          {!profile.avatarImage?.url && (
            <div style={{
              fontSize: 52, lineHeight: 1,
              textShadow: '0 2px 12px rgba(0,0,0,0.7)',
              filter: 'drop-shadow(0 0 12px ' + profile.color + '88)',
            }}>
              {profile.avatarInitial || '?'}
            </div>
          )}
          {/* Color pick dots overlay */}
          <div style={{ display: 'flex', gap: 3, position: profile.avatarImage?.url ? 'absolute' : 'static', bottom: 8 }}>
            {COLOR_PRESETS.slice(0, 8).map(c => (
              <button key={c} onClick={() => onChange({ ...profile, color: c })} style={{
                width: 10, height: 10, borderRadius: '50%', cursor: 'pointer',
                background: c, border: 'none', padding: 0,
                outline: profile.color === c ? `2px solid #fff` : 'none',
                outlineOffset: 1,
                opacity: 0.85,
              }} title={c} />
            ))}
          </div>
        </div>
        {/* Set symbol area — top right */}
        <div style={{
          position: 'absolute', top: 6, right: 8,
          fontSize: 9, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic',
        }}>Commander</div>
      </div>

      {/* ── Type line ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '3px 8px',
        background: 'rgba(0,0,0,0.25)',
        fontSize: 9,
        color: textColor === '#fff' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)',
        fontWeight: 600,
        letterSpacing: '0.03em',
      }}>
        <span>Legendary Creature — Human Judge</span>
        <div style={{
          width: 14, height: 14, borderRadius: '50%',
          background: 'linear-gradient(135deg, #c8a800, #f5d020, #8b6914)',
          border: '1px solid #8b6914',
          fontSize: 7, display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#3d2b00', fontWeight: 800,
        }}>R</div>
      </div>

      {/* ── Text box ── */}
      <div style={{
        margin: '0 6px 4px',
        minHeight: 90,
        borderRadius: 4,
        background: 'rgba(255,252,240,0.92)',
        border: '1px solid rgba(0,0,0,0.3)',
        padding: '6px 7px',
        fontSize: 9,
        color: '#1a1208',
        lineHeight: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {abilities.length === 0 ? (
          <span style={{ color: '#888', fontStyle: 'italic', fontSize: 9 }}>
            Turn on Judge Assistant or Trigger Reminders to gain abilities.
          </span>
        ) : (
          abilities.map((ab, i) => {
            const isFlavor = ab.startsWith('Flavor Text:');
            return (
              <p key={i} style={{
                margin: 0,
                fontStyle: isFlavor ? 'italic' : 'normal',
                color: isFlavor ? '#555' : '#1a1208',
                borderTop: isFlavor && i > 0 ? '1px solid #ccc' : 'none',
                paddingTop: isFlavor && i > 0 ? 4 : 0,
                fontSize: isFlavor ? 8 : 9,
              }}>{ab}</p>
            );
          })
        )}
      </div>

      {/* ── Bottom bar: artist / P/T ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        padding: '2px 8px 6px',
      }}>
        {/* Artist / avatar initial editor */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.4)' }}>Illus.</span>
          <input
            data-testid="profile-initial-input"
            value={profile.avatarInitial}
            onChange={e => {
              const val = e.target.value;
              const trimmed = [...val].slice(0, 2).join('');
              onChange({ ...profile, avatarInitial: trimmed });
            }}
            maxLength={4}
            placeholder="?"
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              width: 28, fontSize: 8,
              color: 'rgba(255,255,255,0.55)',
              fontFamily: 'monospace',
            }}
          />
          {/* Custom hex */}
          <input
            data-testid="profile-color-input"
            value={profile.color}
            onChange={e => {
              const v = e.target.value;
              if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange({ ...profile, color: v });
            }}
            maxLength={7}
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              width: 50, fontSize: 7,
              color: 'rgba(255,255,255,0.4)',
              fontFamily: 'monospace',
            }}
          />
        </div>

        {/* P/T box */}
        <div style={{
          background: frame,
          border: '1px solid rgba(0,0,0,0.4)',
          borderRadius: 3,
          padding: '1px 6px',
          fontSize: 10, fontWeight: 800,
          color: textColor === '#fff' ? '#f5f5f0' : '#1a1208',
          fontFamily: '"Palatino Linotype", serif',
          textShadow: textColor === '#fff' ? '0 1px 2px rgba(0,0,0,0.5)' : 'none',
          minWidth: 28, textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
        }}>
          {power}/{toughness}
        </div>
      </div>
    </div>
  );
}

// ─── Seat color presets ───────────────────────────────────────────────────────

const COLOR_PRESETS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b',
  '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
  '#a3e635', '#e879f9', '#94a3b8', '#fbbf24',
];

// ─── Avatar bubble (used in list view) ───────────────────────────────────────

function AvatarBubble({
  profile, size = 36,
}: { profile: Pick<PlayerProfile, 'displayName' | 'avatarInitial' | 'avatarStyle' | 'avatarImage' | 'color'>; size?: number }) {
  return (
    <PlayerAvatar
      name={profile.displayName}
      color={profile.color}
      initial={profile.avatarInitial}
      styleMode={profile.avatarStyle}
      image={profile.avatarImage}
      size={size}
    />
  );
}

// ─── Main ProfilePanel ────────────────────────────────────────────────────────

export function ProfilePanel() {
  const store = useGameStore();
  const { ui } = store;

  const [view, setView] = useState<'list' | 'editor' | 'art'>('list');
  const [profiles, setProfiles] = useState<PlayerProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState<PlayerProfile | null>(null);
  const [artCardName, setArtCardName] = useState('');

  const refresh = useCallback(() => {
    setProfiles(loadProfiles());
    setActiveId(getActiveProfileId());
  }, []);

  useEffect(() => {
    if (ui.profileOpen) refresh();
  }, [ui.profileOpen, refresh]);

  if (!ui.profileOpen) return null;

  function close() {
    store.setProfileOpen(false);
    setView('list');
    setEditingProfile(null);
  }

  function handleNew() {
    const p = createProfile({ displayName: 'New Planeswalker', avatarInitial: '?' });
    setEditingProfile(p);
    setView('editor');
  }

  function handleEdit(p: PlayerProfile) {
    setEditingProfile({ ...p });
    setView('editor');
  }

  function handleSave(p: PlayerProfile) {
    saveProfile(p);
    refresh();
    setView('list');
    setEditingProfile(null);
  }

  function handleDelete(id: string) {
    deleteProfile(id);
    refresh();
  }

  function handleSetActive(id: string) {
    if (activeId === id) {
      clearActiveProfile();
    } else {
      setActiveProfileId(id);
    }
    refresh();
  }

  function openArtPicker(p: PlayerProfile, cardName = '') {
    setEditingProfile({ ...p });
    setArtCardName(cardName);
    setView('art');
  }

  // Panel size adapts to view
  const panelWidth = view === 'art' ? 800 : view === 'editor' ? 640 : 560;
  const panelHeight = view === 'art' ? 600 : view === 'editor' ? 580 : 520;

  return (
    <>
      {/* Backdrop */}
      <div
        data-testid="profile-backdrop"
        onClick={close}
        style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(3px)' }}
      />

      {/* Panel */}
      <div
        data-testid="profile-panel"
        style={{
          position: 'fixed', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 10001,
          width: panelWidth, maxWidth: 'calc(100vw - 32px)',
          height: panelHeight, maxHeight: 'calc(100vh - 80px)',
          background: '#0a0f1a',
          border: '1px solid #334155',
          borderRadius: 12,
          boxShadow: '0 40px 120px rgba(0,0,0,0.9)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1), height 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px', borderBottom: '1px solid #1e293b', flexShrink: 0,
          background: 'linear-gradient(180deg, #0f172a, #0a0f1a)',
        }}>
          {view !== 'list' && (
            <button
              data-testid="profile-back-btn"
              onClick={() => { setView('list'); setEditingProfile(null); }}
              style={iconBtnStyle}
            >←</button>
          )}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>
              {view === 'list' ? '👤 Player Profiles'
                : view === 'editor' ? '🃏 ' + (editingProfile?.id && profiles.some(p => p.id === editingProfile.id) ? 'Edit Your Card' : 'Create Your Card')
                : `🖼 Art Variants — ${artCardName || 'Pick a card'}`}
            </span>
            {view === 'editor' && (
              <span style={{ fontSize: 9, color: '#475569' }}>
                Your profile appears as a legendary creature card
              </span>
            )}
          </div>
          <button data-testid="profile-close-btn" onClick={close} style={iconBtnStyle}>×</button>
        </div>

        {/* Body */}
        {view === 'list' && (
          <ProfileListView
            profiles={profiles}
            activeId={activeId}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onSetActive={handleSetActive}
            onNew={handleNew}
          />
        )}
        {view === 'editor' && editingProfile && (
          <ProfileEditorView
            profile={editingProfile}
            allProfiles={profiles}
            onChange={setEditingProfile}
            onSave={handleSave}
            onOpenArt={(cardName) => openArtPicker(editingProfile, cardName)}
            onRemoveArt={(cardName) => {
              const updated = removeArtOverride(editingProfile, cardName);
              setEditingProfile(updated);
            }}
          />
        )}
        {view === 'art' && editingProfile && (
          <ArtPickerView
            profile={editingProfile}
            initialCardName={artCardName}
            onSelect={(override) => {
              const updated = setArtOverride(editingProfile, override);
              setEditingProfile(updated);
              setView('editor');
            }}
          />
        )}
      </div>
    </>
  );
}

// ─── Profile List View ────────────────────────────────────────────────────────

function ProfileListView({
  profiles, activeId, onEdit, onDelete, onSetActive, onNew,
}: {
  profiles: PlayerProfile[];
  activeId: string | null;
  onEdit: (p: PlayerProfile) => void;
  onDelete: (id: string) => void;
  onSetActive: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          data-testid="profile-new-btn"
          onClick={onNew}
          style={pillBtnStyle('#1e3a5f', '#60a5fa')}
        >
          + New Profile Card
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#334155' }}>
          {profiles.length} profile{profiles.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {profiles.length === 0 ? (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: '#334155', fontSize: 13 }}>
            No profiles yet.
            <br />
            <span style={{ fontSize: 11, marginTop: 6, display: 'block', color: '#1e293b' }}>
              Create a profile card to save your name, color identity, and card art preferences.
            </span>
          </div>
        ) : profiles.map(p => {
          const isActive = p.id === activeId;
          const artCount = Object.keys(p.artOverrides).length;
          const { symbols } = colorToManaSymbols(p.color);
          return (
            <div
              key={p.id}
              data-testid={`profile-item-${p.id}`}
              style={{
                padding: '10px 12px', borderRadius: 8,
                border: `1px solid ${isActive ? p.color + '66' : '#1e293b'}`,
                background: isActive ? `${p.color}0a` : '#0a0f1a',
                marginBottom: 6, display: 'flex', alignItems: 'center', gap: 12,
                transition: 'background 0.15s',
              }}
            >
              <AvatarBubble profile={p} size={38} />

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>
                    {p.displayName}
                  </span>
                  {/* Mana symbols */}
                  <div style={{ display: 'flex', gap: 2 }}>
                    {symbols.map((s, i) => <ManaSymbol key={i} sym={s} />)}
                  </div>
                  {isActive && (
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: '1px 5px',
                      background: '#14532d', color: '#86efac', borderRadius: 3,
                    }}>ACTIVE</span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>
                  Legendary Creature · {artCount > 0 ? `${artCount} art override${artCount !== 1 ? 's' : ''}` : 'No art overrides'}
                  {' · '}Judge: {p.assistantMode}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                <button
                  data-testid={`profile-activate-${p.id}`}
                  onClick={() => onSetActive(p.id)}
                  title={isActive ? 'Deactivate' : 'Set as active profile'}
                  style={{
                    ...iconBtnStyle,
                    color: isActive ? '#22c55e' : '#475569',
                    borderColor: isActive ? '#22c55e44' : '#1e293b',
                  }}
                >
                  {isActive ? '✓' : '○'}
                </button>
                <button
                  data-testid={`profile-edit-${p.id}`}
                  onClick={() => onEdit(p)}
                  title="Edit profile card"
                  style={{ ...iconBtnStyle, fontSize: 11 }}
                >✎</button>
                <button
                  data-testid={`profile-delete-${p.id}`}
                  onClick={() => onDelete(p.id)}
                  title="Delete profile"
                  style={{ ...iconBtnStyle, color: '#f87171', fontSize: 11 }}
                >✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Profile Editor View ──────────────────────────────────────────────────────

function ProfileEditorView({
  profile, allProfiles, onChange, onSave, onOpenArt, onRemoveArt,
}: {
  profile: PlayerProfile;
  allProfiles: PlayerProfile[];
  onChange: (p: PlayerProfile) => void;
  onSave: (p: PlayerProfile) => void;
  onOpenArt: (cardName: string) => void;
  onRemoveArt: (cardName: string) => void;
}) {
  const artEntries = Object.values(profile.artOverrides);
  const [avatarError, setAvatarError] = useState('');
  const [avatarCardQuery, setAvatarCardQuery] = useState('');
  const [avatarPrints, setAvatarPrints] = useState<ScryfallPrint[]>([]);
  const [avatarLoading, setAvatarLoading] = useState(false);

  async function handleAvatarUpload(file: File | undefined) {
    if (!file) return;
    setAvatarError('');
    try {
      const avatarImage = await compressAvatarImage(file);
      onChange({ ...profile, avatarImage });
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Could not use that image.');
    }
  }

  async function searchAvatarCardArt() {
    const query = avatarCardQuery.trim();
    if (!query) return;
    setAvatarError('');
    setAvatarLoading(true);
    try {
      const results = await fetchCardPrints(query);
      const artPrints = results.filter(print => print.artCropUrl);
      setAvatarPrints(artPrints);
      if (artPrints.length === 0) setAvatarError(`No card art found for "${query}".`);
    } finally {
      setAvatarLoading(false);
    }
  }

  function useCardArt(print: ScryfallPrint) {
    onChange({
      ...profile,
      avatarImage: {
        source: 'card',
        url: print.artCropUrl || print.imageUrl,
        label: `${print.name} - ${print.setName}`,
      },
    });
  }

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Left: MTG card preview */}
      <div style={{
        width: 260, flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 16, borderRight: '1px solid #1e293b',
        background: 'radial-gradient(ellipse at center, #0f172a, #0a0a14)',
        gap: 10,
      }}>
        <MtgCardFrame profile={profile} onChange={onChange} />
        <div style={{ fontSize: 9, color: '#334155', textAlign: 'center', maxWidth: 220 }}>
          Card updates live as you edit. Avatar uploads are compressed under 96 KB.
        </div>
      </div>

      {/* Right: editor controls */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Avatar style ── */}
          <section>
            <SectionLabel>Art Background Style</SectionLabel>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['solid', 'gradient', 'outline'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => onChange({ ...profile, avatarStyle: s })}
                  style={{
                    fontSize: 10, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                    background: profile.avatarStyle === s ? profile.color + '33' : 'transparent',
                    border: `1px solid ${profile.avatarStyle === s ? profile.color : '#1e293b'}`,
                    color: profile.avatarStyle === s ? profile.color : '#475569',
                    fontWeight: 600, transition: 'all 0.1s',
                  }}
                >{s}</button>
              ))}
            </div>
          </section>

          <section>
            <SectionLabel>Player Picture</SectionLabel>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <PlayerAvatar
                name={profile.displayName}
                color={profile.color}
                initial={profile.avatarInitial}
                styleMode={profile.avatarStyle}
                image={profile.avatarImage}
                size={46}
                square
              />
              <label style={pillBtnStyle('#1e293b', '#93c5fd')}>
                Upload Image
                <input
                  data-testid="profile-avatar-upload"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={e => handleAvatarUpload(e.target.files?.[0])}
                  style={{ display: 'none' }}
                />
              </label>
              {profile.avatarImage && (
                <button
                  data-testid="profile-avatar-clear"
                  onClick={() => onChange({ ...profile, avatarImage: undefined })}
                  style={pillBtnStyle('#1e293b', '#fca5a5')}
                >
                  Use Initials
                </button>
              )}
              <span style={{ fontSize: 10, color: '#475569' }}>
                Max input 2 MB. Stored image cap 96 KB.
              </span>
            </div>
            {profile.avatarImage && (
              <div style={{ marginTop: 6, fontSize: 10, color: '#64748b' }}>
                Current: {profile.avatarImage.label ?? profile.avatarImage.source}
                {profile.avatarImage.byteSize ? ` (${Math.round(profile.avatarImage.byteSize / 1024)} KB)` : ''}
              </div>
            )}
            {avatarError && (
              <div data-testid="profile-avatar-error" style={{ marginTop: 6, fontSize: 10, color: '#fca5a5' }}>
                {avatarError}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input
                data-testid="profile-avatar-card-input"
                value={avatarCardQuery}
                onChange={e => setAvatarCardQuery(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') searchAvatarCardArt(); }}
                placeholder="Pull card art, e.g. Sol Ring"
                style={{ ...inputStyle, flex: 1, fontSize: 11 }}
              />
              <button
                data-testid="profile-avatar-card-search"
                onClick={searchAvatarCardArt}
                disabled={avatarLoading || !avatarCardQuery.trim()}
                style={pillBtnStyle(avatarLoading ? '#111827' : '#1e3a5f', avatarLoading ? '#475569' : '#93c5fd')}
              >
                {avatarLoading ? 'Searching...' : 'Find Art'}
              </button>
            </div>
            {avatarPrints.length > 0 && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingTop: 8 }}>
                {avatarPrints.slice(0, 10).map(print => (
                  <button
                    key={print.id}
                    data-testid={`profile-avatar-print-${print.id}`}
                    onClick={() => useCardArt(print)}
                    title={`${print.name} - ${print.setName}`}
                    style={{
                      width: 74,
                      height: 52,
                      padding: 0,
                      border: profile.avatarImage?.url === print.artCropUrl ? '2px solid #22d3ee' : '1px solid #334155',
                      borderRadius: 5,
                      overflow: 'hidden',
                      background: '#0a0f1a',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    <img
                      src={print.artCropUrl}
                      alt={`${print.name} art`}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* ── Extra color swatches ── */}
          <section>
            <SectionLabel>Color Identity</SectionLabel>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
              {COLOR_PRESETS.map(c => (
                <button
                  key={c}
                  onClick={() => onChange({ ...profile, color: c })}
                  style={{
                    width: 20, height: 20, borderRadius: '50%', cursor: 'pointer',
                    background: c, border: 'none', padding: 0,
                    outline: profile.color === c ? `3px solid ${c}` : 'none',
                    outlineOffset: 2,
                    boxShadow: profile.color === c ? `0 0 8px ${c}88` : 'none',
                    transition: 'outline 0.1s, box-shadow 0.1s',
                  }}
                  title={c}
                />
              ))}
            </div>
          </section>

          {/* ── Judge Assistant (abilities) ── */}
          <section>
            <SectionLabel>Judge Abilities</SectionLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FieldLabel style={{ width: 72, flexShrink: 0 }}>Mode</FieldLabel>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['ON', 'LIMITED', 'OFF'] as const).map(m => (
                    <button
                      key={m}
                      data-testid={`profile-assistant-${m}`}
                      onClick={() => onChange({ ...profile, assistantMode: m })}
                      style={segmentBtnStyle(profile.assistantMode === m,
                        m === 'ON' ? '#22c55e' : m === 'LIMITED' ? '#f59e0b' : '#ef4444')}
                    >{m}</button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FieldLabel style={{ width: 72, flexShrink: 0 }}>Verbosity</FieldLabel>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['minimal', 'normal', 'verbose'] as const).map(v => (
                    <button
                      key={v}
                      onClick={() => onChange({ ...profile, assistantVerbosity: v })}
                      style={segmentBtnStyle(profile.assistantVerbosity === v, '#60a5fa')}
                    >{v}</button>
                  ))}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={profile.showTriggerReminders}
                  onChange={e => onChange({ ...profile, showTriggerReminders: e.target.checked })}
                  style={{ accentColor: '#7c3aed', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Trigger Memory ability</span>
              </label>
            </div>
          </section>

          {/* ── Art overrides ── */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <SectionLabel style={{ margin: 0 }}>Card Art Overrides</SectionLabel>
              <button
                data-testid="profile-add-art-btn"
                onClick={() => onOpenArt('')}
                style={pillBtnStyle('#1e293b', '#a78bfa')}
              >+ Add Override</button>
              <span style={{ marginLeft: 'auto', fontSize: 10, color: '#334155' }}>
                {artEntries.length} override{artEntries.length !== 1 ? 's' : ''}
              </span>
            </div>

            {artEntries.length === 0 ? (
              <div style={{ fontSize: 11, color: '#334155', fontStyle: 'italic', padding: '6px 0' }}>
                No art overrides yet. Pick alternative prints for any card in your deck.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 130, overflowY: 'auto' }}>
                {artEntries.map(art => (
                  <div
                    key={art.cardName}
                    data-testid={`art-override-${art.cardName}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 8px', borderRadius: 6,
                      background: '#0a0f1a', border: '1px solid #1e293b',
                    }}
                  >
                    {art.imageUrl && (
                      <img
                        src={art.imageUrl}
                        alt={art.cardName}
                        style={{
                          width: 34, height: 26, objectFit: 'cover', objectPosition: '50% 15%',
                          borderRadius: 3, border: '1px solid #334155', flexShrink: 0,
                        }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {art.cardName}
                      </div>
                      <div style={{ fontSize: 9, color: '#475569' }}>
                        {art.printLabel} · {art.setCode.toUpperCase()} #{art.collectorNumber}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button onClick={() => onOpenArt(art.cardName)} title="Change art" style={{ ...iconBtnStyle, fontSize: 11 }}>✎</button>
                      <button onClick={() => onRemoveArt(art.cardName)} title="Remove" style={{ ...iconBtnStyle, color: '#f87171', fontSize: 11 }}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Footer save */}
        <div style={{
          padding: '10px 16px', borderTop: '1px solid #1e293b', flexShrink: 0,
          display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center',
        }}>
          <span style={{ flex: 1, fontSize: 9, color: '#334155' }}>
            P/T = {profile.assistantMode === 'ON' ? '5' : profile.assistantMode === 'LIMITED' ? '3' : '1'}
            /{profile.assistantVerbosity === 'verbose' ? '6' : profile.assistantVerbosity === 'normal' ? '4' : '2'}
          </span>
          <button
            data-testid="profile-save-btn"
            onClick={() => onSave(profile)}
            disabled={!profile.displayName.trim()}
            style={{
              padding: '6px 18px', fontSize: 11, fontWeight: 700,
              borderRadius: 6, cursor: profile.displayName.trim() ? 'pointer' : 'not-allowed',
              background: profile.displayName.trim() ? '#1d4ed8' : '#1e293b',
              color: profile.displayName.trim() ? '#fff' : '#334155',
              border: 'none',
            }}
          >
            Save Card
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Art Picker View ──────────────────────────────────────────────────────────

function ArtPickerView({
  profile, initialCardName, onSelect,
}: {
  profile: PlayerProfile;
  initialCardName: string;
  onSelect: (override: ArtOverride) => void;
}) {
  const [cardName, setCardName] = useState(initialCardName);
  const [inputVal, setInputVal] = useState(initialCardName);
  const [prints, setPrints] = useState<ScryfallPrint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ScryfallPrint | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!cardName.trim()) { setPrints([]); return; }
    setLoading(true);
    setError('');
    fetchCardPrints(cardName).then(results => {
      setLoading(false);
      if (results.length === 0) setError(`No prints found for "${cardName}"`);
      setPrints(results);
    });
  }, [cardName]);

  function handleInputChange(val: string) {
    setInputVal(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setCardName(val.trim()), 600);
  }

  function handleConfirm() {
    if (!selected) return;
    onSelect({
      cardName: cardName.trim(),
      imageUrl: selected.imageUrl,
      printLabel: `${selected.setName}`,
      setCode: selected.set,
      collectorNumber: selected.collectorNumber,
    });
  }

  const existingOverride = profile.artOverrides[cardName.trim()];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Search bar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
        <input
          data-testid="art-picker-input"
          value={inputVal}
          onChange={e => handleInputChange(e.target.value)}
          placeholder="Card name (e.g. Lightning Bolt, Teferi, Rhystic Study…)"
          style={{ ...inputStyle, width: '100%', fontSize: 12 }}
          autoFocus
        />
        {loading && <div style={{ fontSize: 10, color: '#475569', marginTop: 4 }}>Fetching prints…</div>}
        {error && <div style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>{error}</div>}
        {existingOverride && !selected && (
          <div style={{ fontSize: 10, color: '#a78bfa', marginTop: 4 }}>
            Current: {existingOverride.printLabel} ({existingOverride.setCode.toUpperCase()} #{existingOverride.collectorNumber})
          </div>
        )}
      </div>

      {/* Print grid */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {prints.length === 0 && !loading && !error && (
          <div style={{ textAlign: 'center', color: '#334155', fontSize: 12, padding: '30px 0' }}>
            Search for a card to see all available prints
          </div>
        )}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
          gap: 8,
        }}>
          {prints.map(print => {
            const isSelected = selected?.id === print.id;
            const isCurrent = existingOverride?.setCode === print.set && existingOverride?.collectorNumber === print.collectorNumber;
            return (
              <div
                key={print.id}
                data-testid={`print-option-${print.id}`}
                onClick={() => setSelected(isSelected ? null : print)}
                style={{
                  borderRadius: 6, overflow: 'hidden',
                  border: isSelected ? '2px solid #7c3aed' : isCurrent ? '2px solid #a78bfa' : '1px solid #1e293b',
                  cursor: 'pointer',
                  transition: 'border-color 0.1s, transform 0.1s',
                  transform: isSelected ? 'scale(1.04)' : 'scale(1)',
                  boxShadow: isSelected ? '0 0 16px #7c3aed66' : 'none',
                }}
              >
                <div style={{ position: 'relative' }}>
                  {print.imageUrl ? (
                    <img
                      src={print.imageUrl}
                      alt={`${print.name} — ${print.setName}`}
                      loading="lazy"
                      style={{ width: '100%', display: 'block' }}
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div style={{ height: 82, background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: 9, color: '#475569' }}>No image</span>
                    </div>
                  )}
                  {isSelected && (
                    <div style={{
                      position: 'absolute', top: 4, right: 4,
                      background: '#7c3aed', color: '#fff',
                      borderRadius: '50%', width: 18, height: 18,
                      fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700,
                    }}>✓</div>
                  )}
                  {isCurrent && !isSelected && (
                    <div style={{
                      position: 'absolute', top: 4, left: 4,
                      background: '#a78bfa', color: '#fff',
                      borderRadius: 3, padding: '1px 4px',
                      fontSize: 8, fontWeight: 700,
                    }}>current</div>
                  )}
                  {print.isPromo && (
                    <div style={{
                      position: 'absolute', bottom: 4, left: 4,
                      background: '#78350f', color: '#fcd34d',
                      borderRadius: 3, padding: '1px 4px',
                      fontSize: 8, fontWeight: 700,
                    }}>PROMO</div>
                  )}
                </div>
                <div style={{ padding: '5px 6px', background: '#0a0f1a' }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {print.setName}
                  </div>
                  <div style={{ fontSize: 8, color: '#334155' }}>
                    {print.set.toUpperCase()} #{print.collectorNumber}
                    {print.finishes.includes('foil') && !print.finishes.includes('nonfoil') && (
                      <span style={{ color: '#fbbf24', marginLeft: 3 }}>✦</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer confirm */}
      {selected && (
        <div style={{
          padding: '10px 16px', borderTop: '1px solid #1e293b', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{ flex: 1, fontSize: 11, color: '#94a3b8' }}>
            <strong style={{ color: '#e2e8f0' }}>{cardName}</strong>
            {' — '}{selected.setName} (#{selected.collectorNumber})
          </div>
          <button
            data-testid="art-picker-confirm-btn"
            onClick={handleConfirm}
            disabled={!cardName.trim()}
            style={{
              padding: '6px 16px', fontSize: 11, fontWeight: 700,
              borderRadius: 6, cursor: 'pointer',
              background: '#7c3aed', color: '#fff', border: 'none',
            }}
          >
            Use This Art
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Micro styles ─────────────────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  width: 26, height: 26, borderRadius: 6,
  border: '1px solid #1e293b', background: 'transparent',
  color: '#64748b', cursor: 'pointer', fontSize: 14,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function pillBtnStyle(bg: string, color: string): React.CSSProperties {
  return {
    padding: '4px 10px', fontSize: 11, fontWeight: 600,
    borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${color}44`,
    background: bg, color,
  };
}

function segmentBtnStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    padding: '3px 9px', fontSize: 10, fontWeight: 600,
    borderRadius: 4, cursor: 'pointer',
    background: active ? `${accent}22` : 'transparent',
    border: `1px solid ${active ? accent + '66' : '#1e293b'}`,
    color: active ? accent : '#475569',
    transition: 'all 0.1s',
  };
}

const inputStyle: React.CSSProperties = {
  background: '#0a0f1a', border: '1px solid #334155',
  borderRadius: 6, color: '#e2e8f0',
  fontSize: 11, padding: '5px 8px',
  outline: 'none', width: '100%', boxSizing: 'border-box',
};

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: '#475569',
      textTransform: 'uppercase', letterSpacing: '0.08em',
      marginBottom: 8, ...style,
    }}>{children}</div>
  );
}

function FieldLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <label style={{
      fontSize: 10, color: '#64748b',
      display: 'block', marginBottom: 4, ...style,
    }}>{children}</label>
  );
}
