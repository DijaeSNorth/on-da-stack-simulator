import type { TopLevelNavMode } from './navigationFlowModel';
import { TOP_LEVEL_NAV_ITEMS } from './navigationFlowModel';

interface TopLevelNavigationProps {
  active: TopLevelNavMode;
  onSelect: (mode: TopLevelNavMode) => void;
}

export function TopLevelNavigation({ active, onSelect }: TopLevelNavigationProps) {
  return (
    <nav
      aria-label="Top-level navigation"
      data-testid="top-level-navigation"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, marginBottom: 12 }}
    >
      {TOP_LEVEL_NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={active === item.id ? 'page' : undefined}
          data-testid={`lobby-nav-${item.id}`}
          onClick={() => onSelect(item.id)}
          style={{
            padding: '8px 8px',
            borderRadius: 7,
            border: `1px solid ${active === item.id ? '#22d3ee' : '#34414a'}`,
            background: active === item.id ? '#123642' : '#182127',
            color: active === item.id ? '#cffafe' : '#94a3b8',
            fontSize: 11,
            fontWeight: 900,
            cursor: 'pointer',
          }}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
