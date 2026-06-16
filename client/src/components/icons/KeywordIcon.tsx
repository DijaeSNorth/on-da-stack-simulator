import React from 'react';
import type { KeywordIconId } from './keywordIconRegistry';
import { getKeywordIconDefinition } from './keywordIconRegistry';

interface KeywordIconProps {
  id: KeywordIconId;
  size?: number;
  title?: string;
  className?: string;
  muted?: boolean;
  disabled?: boolean;
}

export function KeywordIcon({ id, size = 16, title, className, muted, disabled }: KeywordIconProps) {
  const definition = getKeywordIconDefinition(id);
  const label = title ?? definition.label;
  return (
    <svg
      role="img"
      aria-label={label}
      className={className}
      width={size}
      height={size}
      viewBox={definition.viewBox ?? '0 0 24 24'}
      style={{
        color: disabled ? '#64748b' : muted ? '#94a3b8' : definition.defaultColor ?? 'currentColor',
        display: 'inline-block',
        flexShrink: 0,
      }}
      focusable="false"
    >
      <title>{label}</title>
      <path d={definition.svgPath} fill="currentColor" />
    </svg>
  );
}
