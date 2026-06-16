import React from 'react';
import type { KeywordIconId } from './keywordIconRegistry';
import { getKeywordIconDefinition } from './keywordIconRegistry';
import { KeywordIcon } from './KeywordIcon';

interface KeywordBadgeProps {
  id: KeywordIconId;
  labelMode?: 'icon' | 'short' | 'full';
  tooltip?: string;
  size?: number;
  emphasis?: 'normal' | 'muted' | 'strong';
}

export function KeywordBadge({ id, labelMode = 'icon', tooltip, size = 14, emphasis = 'normal' }: KeywordBadgeProps) {
  const definition = getKeywordIconDefinition(id);
  const label = labelMode === 'full' ? definition.label : definition.shortLabel;
  const title = tooltip ?? `${definition.label}: ${definition.description}`;
  const showText = labelMode !== 'icon';
  const isMuted = emphasis === 'muted';
  const borderColor = emphasis === 'strong' ? `${definition.defaultColor ?? '#94a3b8'}88` : 'rgba(148, 163, 184, 0.22)';
  return (
    <span
      aria-label={title}
      title={title}
      data-keyword-icon={id}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: showText ? 3 : 0,
        minWidth: showText ? undefined : size + 6,
        height: size + 6,
        borderRadius: 999,
        padding: showText ? `1px ${Math.max(5, Math.floor(size / 2))}px 1px 4px` : '1px 3px',
        border: `1px solid ${borderColor}`,
        background: emphasis === 'strong' ? 'rgba(15,23,42,0.86)' : 'rgba(15,23,42,0.62)',
        color: isMuted ? '#94a3b8' : definition.defaultColor ?? '#cbd5e1',
        fontSize: Math.max(8, size - 5),
        fontWeight: 800,
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      <KeywordIcon id={id} size={size} title={definition.label} muted={isMuted} />
      {showText && <span>{label}</span>}
    </span>
  );
}
