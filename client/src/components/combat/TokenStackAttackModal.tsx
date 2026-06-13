import { useMemo, useState } from 'react';
import { getLegalAttackTargetsForPlayer } from '../../engine/gameEngine';
import { useGameStore } from '../../store/gameStore';
import type { AttackDefenderTarget, CardState } from '../../types/game';

interface TokenStackAttackModalProps {
  playerId: string;
  sourceGroupId: string;
  cards: CardState[];
  onClose: () => void;
}

interface SplitRow {
  id: string;
  count: number;
  targetKey: string;
}

function targetKey(target: AttackDefenderTarget): string {
  if (target.type === 'player') return `player:${target.playerId}`;
  if (target.type === 'planeswalker') return `planeswalker:${target.permanentId}`;
  return `battle:${target.permanentId}`;
}

function hasKeyword(card: CardState, keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return (
    card.definition.keywords.some(k => k.toLowerCase() === lower) ||
    card.definition.oracleText.toLowerCase().includes(lower)
  );
}

function isEligible(card: CardState, playerId: string): boolean {
  return (
    card.token &&
    card.zone === 'battlefield' &&
    card.controllerId === playerId &&
    card.definition.cardTypes.includes('Creature') &&
    !card.tapped &&
    !hasKeyword(card, 'defender') &&
    (!card.summoningSick || hasKeyword(card, 'haste'))
  );
}

export function TokenStackAttackModal({ playerId, sourceGroupId, cards, onClose }: TokenStackAttackModalProps) {
  const store = useGameStore();
  const { game } = store;
  const targets = useMemo(() => getLegalAttackTargetsForPlayer(game, playerId), [game, playerId]);
  const targetMap = useMemo(() => new Map(targets.map(target => [targetKey(target), target])), [targets]);
  const firstTargetKey = targets[0] ? targetKey(targets[0]) : '';
  const eligibleCards = cards.filter(card => isEligible(card, playerId));
  const tappedCount = cards.filter(card => card.tapped).length;
  const tokenName = cards[0]?.definition.name ?? 'Token';
  const [singleTargetKey, setSingleTargetKey] = useState(firstTargetKey);
  const [someCount, setSomeCount] = useState(Math.min(eligibleCards.length, 1));
  const [splitRows, setSplitRows] = useState<SplitRow[]>([
    { id: 'split-1', count: Math.min(eligibleCards.length, 1), targetKey: firstTargetKey },
  ]);

  const totalSplitCount = splitRows.reduce((sum, row) => sum + Math.max(0, Math.floor(row.count)), 0);
  const splitRemainder = Math.max(0, eligibleCards.length - totalSplitCount);

  function clampCount(value: number, fallback = 1): number {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(1, Math.min(eligibleCards.length, Math.floor(value)));
  }

  function getTarget(key: string): AttackDefenderTarget | undefined {
    return targetMap.get(key);
  }

  function labelForTarget(target: AttackDefenderTarget): string {
    if (target.type === 'player') {
      const player = game.players.find(p => p.id === target.playerId);
      return `${player?.name ?? target.playerId}${player ? ` (${player.life})` : ''}`;
    }
    const card = game.cards[target.permanentId];
    if (target.type === 'planeswalker') {
      const controller = game.players.find(p => p.id === target.controllerId);
      return `${card?.definition.name ?? 'Planeswalker'} - ${controller?.name ?? target.controllerId}`;
    }
    const protector = game.players.find(p => p.id === target.protectorId);
    return `${card?.definition.name ?? 'Battle'} - protected by ${protector?.name ?? target.protectorId}`;
  }

  function submit(assignments: { count: number; attackTarget: AttackDefenderTarget }[]): void {
    const ok = store.declareTokenStackAttack(
      playerId,
      sourceGroupId,
      cards.map(card => card.instanceId),
      assignments,
    );
    if (ok) onClose();
  }

  const canSubmit = eligibleCards.length > 0 && targets.length > 0;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4 rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-slate-100">Token Stack Attack</h2>
            <p className="mt-1 text-xs text-slate-400">
              {tokenName}: {cards.length} total, {eligibleCards.length} eligible, {tappedCount} tapped.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-white">Close</button>
        </div>

        <div className="space-y-4 p-5">
          {targets.length === 0 && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
              No legal attack targets are available.
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Target</span>
            <select
              value={singleTargetKey}
              onChange={(event) => setSingleTargetKey(event.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              {targets.map(target => (
                <option key={targetKey(target)} value={targetKey(target)}>
                  {labelForTarget(target)}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => {
                const target = getTarget(singleTargetKey);
                if (target) submit([{ count: eligibleCards.length, attackTarget: target }]);
              }}
              className="rounded-xl border border-red-700 bg-red-950/50 px-4 py-3 text-sm font-semibold text-red-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Attack All
            </button>

            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-200">Attack Some</span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, eligibleCards.length)}
                  value={someCount}
                  onChange={(event) => setSomeCount(clampCount(Number.parseInt(event.target.value, 10)))}
                  className="ml-auto w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                />
              </div>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => {
                  const target = getTarget(singleTargetKey);
                  if (target) submit([{ count: clampCount(someCount), attackTarget: target }]);
                }}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Confirm Some
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-200">Split Attack</p>
                <p className="text-xs text-slate-500">{splitRemainder} stay back</p>
              </div>
              <button
                type="button"
                disabled={!firstTargetKey}
                onClick={() => setSplitRows(prev => [...prev, { id: `split-${prev.length + 1}-${Date.now()}`, count: 1, targetKey: firstTargetKey }])}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 disabled:opacity-40"
              >
                Add Row
              </button>
            </div>

            <div className="space-y-2">
              {splitRows.map(row => (
                <div key={row.id} className="grid grid-cols-[72px_1fr_auto] items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, eligibleCards.length)}
                    value={row.count}
                    onChange={(event) => {
                      const count = clampCount(Number.parseInt(event.target.value, 10));
                      setSplitRows(prev => prev.map(item => item.id === row.id ? { ...item, count } : item));
                    }}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                  />
                  <select
                    value={row.targetKey}
                    onChange={(event) => setSplitRows(prev => prev.map(item => item.id === row.id ? { ...item, targetKey: event.target.value } : item))}
                    className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                  >
                    {targets.map(target => (
                      <option key={targetKey(target)} value={targetKey(target)}>
                        {labelForTarget(target)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setSplitRows(prev => prev.filter(item => item.id !== row.id))}
                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              disabled={!canSubmit || totalSplitCount > eligibleCards.length || totalSplitCount < 1}
              onClick={() => {
                const nextAssignments = splitRows
                  .map(row => {
                    const target = getTarget(row.targetKey);
                    return target ? { count: clampCount(row.count), attackTarget: target } : null;
                  })
                  .filter(Boolean) as { count: number; attackTarget: AttackDefenderTarget }[];
                submit(nextAssignments);
              }}
              className="mt-3 w-full rounded-lg border border-emerald-700 bg-emerald-950/50 px-3 py-2 text-sm font-semibold text-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Confirm Split
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
