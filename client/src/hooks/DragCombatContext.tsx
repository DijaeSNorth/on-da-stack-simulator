// ─── DragCombatContext ────────────────────────────────────────────────────────
// Provides drag-combat state + handlers to the entire battlefield tree.
// Wrap <CommanderTable> in <DragCombatProvider> in App.tsx.
// ──────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, ReactNode } from 'react';
import { useDragCombat, DragState, DropTarget } from './useDragCombat';

interface DragCombatContextValue {
  dragState: DragState | null;
  dropTarget: DropTarget | null;
  cardDragHandlers: (instanceId: string) => {
    draggable: true;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
  };
  playerDropHandlers: (targetPlayerId: string) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  attackerDropHandlers: (attackerInstanceId: string) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
}

const DragCombatContext = createContext<DragCombatContextValue | null>(null);

export function DragCombatProvider({ children }: { children: ReactNode }) {
  const value = useDragCombat();
  return (
    <DragCombatContext.Provider value={value}>
      {children}
    </DragCombatContext.Provider>
  );
}

export function useDragCombatContext(): DragCombatContextValue {
  const ctx = useContext(DragCombatContext);
  if (!ctx) throw new Error('useDragCombatContext must be used inside <DragCombatProvider>');
  return ctx;
}
