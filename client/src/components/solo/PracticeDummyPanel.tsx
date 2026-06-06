import { useGameStore } from '../../store/gameStore';

const DUMMY_PREFIX = 'practice-dummy-';
const MAX_DUMMIES = 3;

export function PracticeDummyPanel() {
  const store = useGameStore();
  const { game } = store;
  if (game.config.playerCount !== 1 || game.status === 'lobby') return null;

  const dummies = game.players.filter(player => player.id.startsWith(DUMMY_PREFIX));
  return (
    <div
      data-testid="practice-dummy-panel"
      style={{
        position: 'absolute',
        right: 10,
        bottom: 10,
        zIndex: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 7px',
        borderRadius: 8,
        border: '1px solid rgba(245,158,11,0.42)',
        background: 'rgba(8,13,17,0.9)',
        boxShadow: '0 10px 30px rgba(0,0,0,0.34)',
      }}
    >
      <span style={{ color: '#fbbf24', fontSize: 10, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        Dummies
      </span>
      <button
        type="button"
        data-testid="btn-add-practice-dummy"
        data-help-title="Add Practice Dummy"
        data-help-body="Adds a solo-test opponent with two simple creature permanents so you can practice attacks, blockers, targeting, and combat arrows."
        data-help-placement="left"
        title="Add a practice dummy with two creature cards"
        disabled={dummies.length >= MAX_DUMMIES}
        onClick={store.addPracticeDummy}
        style={buttonStyle(dummies.length >= MAX_DUMMIES)}
      >
        Add +2
      </button>
      {dummies.map(dummy => (
        <button
          key={dummy.id}
          type="button"
          data-testid={`btn-remove-practice-dummy-${dummy.id}`}
          data-help-title="Remove Practice Dummy"
          data-help-body="Removes this dummy player and its practice creatures from the solo test table."
          data-help-placement="left"
          title={`Remove ${dummy.name}`}
          onClick={() => store.removePracticeDummy(dummy.id)}
          style={{
            ...buttonStyle(false),
            minWidth: 28,
            color: '#fecaca',
            borderColor: '#7f1d1d',
            background: '#450a0a66',
          }}
        >
          {dummy.name.replace('Practice Dummy ', 'D')} ({dummy.battlefield.length})
        </button>
      ))}
    </div>
  );
}

function buttonStyle(disabled: boolean): React.CSSProperties {
  return {
    minHeight: 28,
    padding: '4px 8px',
    borderRadius: 6,
    border: '1px solid #92400e',
    background: disabled ? '#1c1917' : '#451a03',
    color: disabled ? '#57534e' : '#fed7aa',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 10,
    fontWeight: 900,
    touchAction: 'manipulation',
  };
}
