import React from 'react';
import { KEYWORD_ICON_REGISTRY, type KeywordIconCategory } from './keywordIconRegistry';
import { KeywordBadge } from './KeywordBadge';

const CATEGORY_LABELS: Record<KeywordIconCategory, string> = {
  combat: 'Combat',
  evasion: 'Evasion',
  protection: 'Protection',
  speed: 'Speed',
  resource: 'Resource',
  mechanic: 'Set mechanics',
  token: 'Tokens',
  manual: 'Manual',
};

export function KeywordIconLegend() {
  const groups = Object.values(KEYWORD_ICON_REGISTRY).reduce<Record<KeywordIconCategory, typeof KEYWORD_ICON_REGISTRY[keyof typeof KEYWORD_ICON_REGISTRY][]>>((acc, definition) => {
    (acc[definition.category] ??= []).push(definition);
    return acc;
  }, {} as Record<KeywordIconCategory, typeof KEYWORD_ICON_REGISTRY[keyof typeof KEYWORD_ICON_REGISTRY][]>);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {(Object.keys(CATEGORY_LABELS) as KeywordIconCategory[]).map(category => {
        const entries = groups[category] ?? [];
        if (entries.length === 0) return null;
        return (
          <section key={category}>
            <div style={{ fontSize: 10, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>
              {CATEGORY_LABELS[category]}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {entries.map(entry => <KeywordBadge key={entry.id} id={entry.id} labelMode="full" size={14} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
