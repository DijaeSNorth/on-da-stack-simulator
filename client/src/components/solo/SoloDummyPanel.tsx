import { useState } from 'react';
import { normalizeDummyOpponentConfig } from '../../engine/dummyOpponentEngine';
import { useGameStore } from '../../store/gameStore';
import type { DummyOpponentConfig, DummyOpponentProfile } from '../../types/game';
import type { SoloDeckLabStartOptions } from './SoloDeckLab';
import { SoloPerformancePanel } from './SoloPerformancePanel';

interface SoloDummyPanelProps {
  startOptions?: SoloDeckLabStartOptions;
}

const profiles: { id: DummyOpponentProfile; label: string }[] = [
  { id: 'training', label: 'Training' },
  { id: 'blocker', label: 'Blocker' },
  { id: 'aggro', label: 'Aggro' },
  { id: 'value', label: 'Value' },
  { id: 'combo_clock', label: 'Combo Clock' },
];

export function SoloDummyPanel({ startOptions }: SoloDummyPanelProps) {
  const store = useGameStore();
  const activeDeck = store.soloDeckLab.draftDeck
    ?? store.decks.find(deck => deck.id === store.soloDeckLab.activeDeckId);
  const [draft, setDraft] = useState<Partial<DummyOpponentConfig>>({
    name: 'Training Dummy',
    profile: 'training',
    startingLife: 40,
    startingBlockers: 0,
    pressurePerTurn: 2,
    comboTurn: 6,
    autoBlock: false,
    autoAttack: false,
    dummyDeckMode: 'none',
    dummyDeckArchetype: 'aggro',
    dummyDeckPower: 'low',
    startingHandSize: 7,
    autoPlayLand: true,
    autoCastCreature: true,
  });
  const [configs, setConfigs] = useState<DummyOpponentConfig[]>([
    normalizeDummyOpponentConfig({ id: 'dummy-training-1', name: 'Training Dummy', profile: 'training', startingLife: 40 }),
  ]);
  const [status, setStatus] = useState('');
  const dummyPlayers = store.game.players.filter(player => player.isDummy);
  const inDummyPractice = store.game.status === 'playing' && store.soloDeckLab.testSession?.mode === 'dummy';

  function update<K extends keyof DummyOpponentConfig>(key: K, value: DummyOpponentConfig[K]) {
    setDraft(current => ({ ...current, [key]: value }));
  }

  function addDummy() {
    const next = normalizeDummyOpponentConfig({ ...draft, id: `dummy-${Date.now()}-${configs.length + 1}` });
    setConfigs(current => [...current, next].slice(0, 5));
    setStatus(`Added ${next.name}.`);
  }

  function removeConfig(id: string) {
    setConfigs(current => current.filter(config => config.id !== id));
  }

  async function startPractice() {
    const started = await store.startSoloDummyPracticeGame(configs, startOptions);
    setStatus(started ? 'Started dummy practice game.' : 'Load a deck and leave multiplayer before starting dummy practice.');
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <section style={panelStyle}>
        <div style={titleStyle}>Practice opponents</div>
        <div style={mutedStyle}>
          Add simple scripted opponents. They use normal player slots, so attacks and combat damage preview work through existing combat logic.
        </div>
        <div style={formGridStyle}>
          <input value={draft.name ?? ''} onChange={event => update('name', event.target.value)} placeholder="Dummy name" style={inputStyle} />
          <select value={draft.profile ?? 'training'} onChange={event => update('profile', event.target.value as DummyOpponentProfile)} style={inputStyle}>
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
          </select>
          <input type="number" min={1} value={draft.startingLife ?? 40} onChange={event => update('startingLife', Number(event.target.value) || 40)} style={inputStyle} />
          <input type="number" min={0} value={draft.startingBlockers ?? 0} onChange={event => update('startingBlockers', Number(event.target.value) || 0)} style={inputStyle} />
          <input type="number" min={0} value={draft.pressurePerTurn ?? 0} onChange={event => update('pressurePerTurn', Number(event.target.value) || 0)} style={inputStyle} />
          <input type="number" min={1} value={draft.comboTurn ?? 6} onChange={event => update('comboTurn', Number(event.target.value) || 6)} style={inputStyle} />
          <select value={draft.dummyDeckMode ?? 'none'} onChange={event => update('dummyDeckMode', event.target.value as DummyOpponentConfig['dummyDeckMode'])} style={inputStyle}>
            <option value="none">Deck: None</option>
            <option value="generated">Deck: Generated</option>
          </select>
          <select value={draft.dummyDeckArchetype ?? 'aggro'} onChange={event => update('dummyDeckArchetype', event.target.value as DummyOpponentConfig['dummyDeckArchetype'])} style={inputStyle}>
            <option value="aggro">Aggro</option>
            <option value="midrange">Midrange</option>
            <option value="control">Control</option>
            <option value="tokens">Tokens</option>
          </select>
          <select value={draft.dummyDeckPower ?? 'low'} onChange={event => update('dummyDeckPower', event.target.value as DummyOpponentConfig['dummyDeckPower'])} style={inputStyle}>
            <option value="low">Low power</option>
            <option value="medium">Medium power</option>
            <option value="high">High power</option>
          </select>
          <input type="number" min={0} value={draft.startingHandSize ?? 7} onChange={event => update('startingHandSize', Number(event.target.value) || 0)} style={inputStyle} />
        </div>
        <div style={buttonRowStyle}>
          <label style={checkStyle}>
            <input type="checkbox" checked={Boolean(draft.autoBlock)} onChange={event => update('autoBlock', event.target.checked)} />
            Auto block
          </label>
          <label style={checkStyle}>
            <input type="checkbox" checked={Boolean(draft.autoAttack)} onChange={event => update('autoAttack', event.target.checked)} />
            Auto attack
          </label>
          <label style={checkStyle}>
            <input type="checkbox" checked={draft.autoPlayLand !== false} onChange={event => update('autoPlayLand', event.target.checked)} />
            Auto play land
          </label>
          <label style={checkStyle}>
            <input type="checkbox" checked={draft.autoCastCreature !== false} onChange={event => update('autoCastCreature', event.target.checked)} />
            Auto cast creature
          </label>
          <button type="button" onClick={addDummy} style={buttonStyle}>Add Dummy</button>
          <button type="button" disabled={!activeDeck || configs.length === 0} onClick={() => void startPractice()} style={buttonStyle}>
            Start Practice Game
          </button>
        </div>
      </section>

      <section style={panelStyle}>
        <div style={titleStyle}>Queued dummies</div>
        {configs.length === 0 && <div style={mutedStyle}>No dummy opponents queued.</div>}
        {configs.map(config => (
          <div key={config.id} style={rowStyle}>
            <div>
              <div style={nameStyle}>{config.name}</div>
              <div style={mutedStyle}>
                {config.profile} | life {config.startingLife} | blockers {config.startingBlockers ?? 0}
                {config.profile === 'combo_clock' ? ` | combo turn ${config.comboTurn}` : ''}
                {config.dummyDeckMode === 'generated' ? ` | ${config.dummyDeckArchetype} ${config.dummyDeckPower} deck` : ''}
              </div>
            </div>
            <button type="button" onClick={() => removeConfig(config.id)} style={smallDangerButtonStyle}>Remove</button>
          </div>
        ))}
      </section>

      <section style={panelStyle}>
        <div style={titleStyle}>Active dummy table</div>
        {!inDummyPractice && <div style={mutedStyle}>Start practice to add dummy player panels to the normal table.</div>}
        {dummyPlayers.map(dummy => (
          <div key={dummy.id} style={rowStyle}>
            <div>
              <div style={nameStyle}>{dummy.name}</div>
              <div style={mutedStyle}>
                {dummy.dummyProfile} dummy | life {dummy.life} | library {dummy.library.length} | hand {dummy.hand.length}
                {' | '}lands {countBattlefieldType(store, dummy.id, 'Land')} | creatures {countBattlefieldType(store, dummy.id, 'Creature')}
                {dummy.dummyConfig?.dummyDeckMode === 'generated' ? ` | ${dummy.dummyConfig.dummyDeckArchetype}` : ''}
              </div>
            </div>
            <div style={buttonRowStyle}>
              <button type="button" disabled={!dummy.dummyConfig?.autoBlock} onClick={() => store.autoBlockForDummy(dummy.id)} style={smallButtonStyle}>Auto Block</button>
              <button type="button" onClick={() => store.advanceDummyTurn(dummy.id)} style={smallButtonStyle}>Dummy Turn</button>
              <button type="button" onClick={() => store.removeDummyOpponent(dummy.id)} style={smallDangerButtonStyle}>Remove</button>
            </div>
          </div>
        ))}
      </section>

      {inDummyPractice && <SoloPerformancePanel sessionType="dummy" />}

      {status && <div style={{ color: '#93c5fd', fontSize: 11 }}>{status}</div>}
    </div>
  );
}

function countBattlefieldType(
  store: {
    game: {
      players: { id: string; battlefield: string[] }[];
      cards: Record<string, { definition: { cardTypes: string[] } } | undefined>;
    };
  },
  playerId: string,
  cardType: string,
): number {
  const player = store.game.players.find(current => current.id === playerId);
  return player?.battlefield.filter(id => store.game.cards[id]?.definition.cardTypes.includes(cardType)).length ?? 0;
}

const panelStyle: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  background: '#0f172a',
  border: '1px solid #1e293b',
  borderRadius: 8,
  padding: 10,
};

const titleStyle: React.CSSProperties = {
  color: '#e2e8f0',
  fontSize: 11,
  fontWeight: 900,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
};

const mutedStyle: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 11,
};

const formGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 7,
};

const inputStyle: React.CSSProperties = {
  minWidth: 0,
  background: '#111827',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  padding: '7px 9px',
  fontSize: 11,
  boxSizing: 'border-box',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 7,
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'flex-end',
};

const rowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 8,
  alignItems: 'center',
  padding: '8px 9px',
  borderRadius: 7,
  border: '1px solid #26323a',
  background: '#0b0f12',
};

const nameStyle: React.CSSProperties = {
  color: '#f8fafc',
  fontSize: 12,
  fontWeight: 900,
};

const checkStyle: React.CSSProperties = {
  color: '#cbd5e1',
  fontSize: 11,
  display: 'flex',
  gap: 5,
  alignItems: 'center',
};

const buttonStyle: React.CSSProperties = {
  background: '#1e3a5f',
  color: '#bfdbfe',
  border: '1px solid #60a5fa55',
  borderRadius: 6,
  padding: '7px 10px',
  fontSize: 10,
  fontWeight: 900,
  cursor: 'pointer',
  textTransform: 'uppercase',
};

const smallButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: '#182127',
  color: '#cbd5e1',
  border: '1px solid #334155',
};

const smallDangerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: '1px solid #7f1d1d',
  color: '#fca5a5',
};
