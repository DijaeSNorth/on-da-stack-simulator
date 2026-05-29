// ─── CombatPanel ──────────────────────────────────────────────────────────────
// Shown when a MULTI_ATTACK or ENTER_COMBAT command populates the combat queue.
// Flow:
//   1. ASSIGN TARGETS — attacker picks which player each creature attacks
//   2. RESPONSE WINDOW — all non-attacking players may cast spells / abilities
//   3. DECLARE BLOCKERS — each defending player assigns blockers per attacker
//   4. RESOLVE — combat damage is applied, panel closes
//
// This is a non-blocking overlay: the judge assistant observes but never
// prevents actions. Players can skip any step.
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { CardState, Player } from '../../types/game';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingAttacker {
  instanceId: string;
  card: CardState;
  /** Resolved player ID this creature is attacking. undefined = not yet assigned */
  targetPlayerId?: string;
}

interface PendingBlocker {
  blockerInstanceId: string;
  attackerInstanceId: string;
}

type CombatStep = 'assign_targets' | 'response_window' | 'declare_blockers' | 'resolving';

interface CombatPanelProps {
  /** Attacker instance IDs from the parsed MULTI_ATTACK intent */
  attackerIds: string[];
  /** Pre-assigned targets from the command (e.g. "Goblin Guide (player 2)"). instanceId → playerId */
  preAssignments?: Record<string, string>;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CombatPanel({ attackerIds, preAssignments = {}, onClose }: CombatPanelProps) {
  const store = useGameStore();
  const { game, localPlayerId } = store;

  // Build initial attacker list from ids
  const initialAttackers: PendingAttacker[] = attackerIds
    .map(id => game.cards[id])
    .filter(Boolean)
    .map(card => ({
      instanceId: card.instanceId,
      card,
      targetPlayerId: preAssignments[card.instanceId],
    }));

  const [step, setStep] = useState<CombatStep>(
    // If all targets are pre-assigned, skip straight to response window
    initialAttackers.every(a => a.targetPlayerId) ? 'response_window' : 'assign_targets'
  );
  const [attackers, setAttackers] = useState<PendingAttacker[]>(initialAttackers);
  const [pendingBlockers, setPendingBlockers] = useState<PendingBlocker[]>([]);
  const [responseNote, setResponseNote] = useState('');

  // Defending players = everyone except the attacker
  const attackingPlayerId = game.activePlayerId;
  const defendingPlayers = game.players.filter(p => p.id !== attackingPlayerId);

  // ── Assign Targets ──────────────────────────────────────────────────────────

  const assignTarget = useCallback((instanceId: string, targetPlayerId: string) => {
    setAttackers(prev => prev.map(a =>
      a.instanceId === instanceId ? { ...a, targetPlayerId } : a
    ));
  }, []);

  const confirmTargets = useCallback(() => {
    // Commit all declared attackers to the game store
    for (const a of attackers) {
      if (a.targetPlayerId) {
        store.declareAttack(a.instanceId, a.targetPlayerId);
      }
    }
    store.goToPhase('declareAttackers');
    setStep('response_window');
  }, [attackers, store]);

  // ── Blockers ────────────────────────────────────────────────────────────────

  const declareBlocker = useCallback((blockerInstanceId: string, attackerInstanceId: string) => {
    setPendingBlockers(prev => {
      // Remove existing assignment for this blocker then add new one
      const filtered = prev.filter(b => b.blockerInstanceId !== blockerInstanceId);
      return [...filtered, { blockerInstanceId, attackerInstanceId }];
    });
  }, []);

  const removeBlocker = useCallback((blockerInstanceId: string) => {
    setPendingBlockers(prev => prev.filter(b => b.blockerInstanceId !== blockerInstanceId));
  }, []);

  const confirmBlockers = useCallback(() => {
    for (const b of pendingBlockers) {
      store.declareBlock(b.blockerInstanceId, b.attackerInstanceId);
    }
    setStep('resolving');
    setTimeout(() => {
      store.resolveCombatDamage();
      store.endCombat();
      onClose();
    }, 800);
  }, [pendingBlockers, store, onClose]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const getPlayerName = (id: string) => game.players.find(p => p.id === id)?.name ?? id;
  const getPlayerColor = (id: string) => game.players.find(p => p.id === id)?.color ?? '#888';

  // Battlefield creatures the local player controls (for blocking)
  const localPlayer = game.players.find(p => p.id === localPlayerId);
  const myBattlefieldCreatures = (localPlayer?.battlefield ?? [])
    .map(id => game.cards[id])
    .filter(c => c && c.definition.cardTypes.includes('Creature') && !c.tapped && !c.summoningSick);

  const isLocalPlayerAttacking = localPlayerId === attackingPlayerId;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl mx-4 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800">
          <div>
            <h2 className="text-white font-bold text-lg">
              {step === 'assign_targets' && '⚔️ Assign Attack Targets'}
              {step === 'response_window' && '⚡ Response Window'}
              {step === 'declare_blockers' && '🛡 Declare Blockers'}
              {step === 'resolving' && '💥 Resolving Combat…'}
            </h2>
            <p className="text-gray-400 text-sm mt-0.5">
              {step === 'assign_targets' && `${getPlayerName(attackingPlayerId)} is attacking — assign targets for each creature`}
              {step === 'response_window' && 'All players may cast instants or activate abilities before blockers are declared'}
              {step === 'declare_blockers' && 'Defending players assign blockers to each attacker'}
              {step === 'resolving' && 'Applying combat damage…'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none px-2"
            title="Close panel (combat still tracked in log)"
          >
            ✕
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} />

        {/* Body */}
        <div className="p-6 max-h-[60vh] overflow-y-auto">

          {/* ── ASSIGN TARGETS ── */}
          {step === 'assign_targets' && (
            <div className="space-y-3">
              {attackers.map(a => (
                <AttackerRow
                  key={a.instanceId}
                  attacker={a}
                  defendingPlayers={defendingPlayers}
                  getPlayerColor={getPlayerColor}
                  onAssign={(playerId) => assignTarget(a.instanceId, playerId)}
                />
              ))}
              <div className="flex gap-3 pt-3 border-t border-gray-700 mt-4">
                <button
                  onClick={confirmTargets}
                  disabled={attackers.some(a => !a.targetPlayerId)}
                  className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                >
                  Declare Attackers
                </button>
                <button
                  onClick={() => {
                    // Allow skipping — advance without assigning unset targets
                    confirmTargets();
                  }}
                  className="px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors"
                >
                  Skip / Open Response
                </button>
              </div>
            </div>
          )}

          {/* ── RESPONSE WINDOW ── */}
          {step === 'response_window' && (
            <div className="space-y-4">
              {/* Attacker summary */}
              <div className="bg-gray-800 rounded-xl p-4">
                <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Attacking</p>
                <div className="flex flex-wrap gap-2">
                  {attackers.map(a => (
                    <AttackerChip
                      key={a.instanceId}
                      attacker={a}
                      getPlayerName={getPlayerName}
                      getPlayerColor={getPlayerColor}
                    />
                  ))}
                </div>
              </div>

              {/* Response note (any player can type) */}
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wider block mb-1">
                  Log a response (optional)
                </label>
                <div className="flex gap-2">
                  <input
                    value={responseNote}
                    onChange={e => setResponseNote(e.target.value)}
                    placeholder={`e.g. "Cast Lightning Bolt targeting Goblin Guide"`}
                    className="flex-1 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={() => {
                      if (responseNote.trim()) {
                        store.addAssistantMessage({
                          severity: 'info',
                          label: 'Info',
                          text: `Response: ${responseNote.trim()}`,
                        });
                        setResponseNote('');
                      }
                    }}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors"
                  >
                    Log
                  </button>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep('declare_blockers')}
                  className="flex-1 py-2.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white font-semibold transition-colors"
                >
                  Proceed to Declare Blockers
                </button>
                <button
                  onClick={confirmBlockers}
                  className="px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors"
                >
                  No Blocks / Resolve
                </button>
              </div>
            </div>
          )}

          {/* ── DECLARE BLOCKERS ── */}
          {step === 'declare_blockers' && (
            <div className="space-y-4">
              {/* Show each attacker and allow assigning blockers */}
              {attackers.filter(a => a.targetPlayerId === localPlayerId || !isLocalPlayerAttacking).map(a => (
                <BlockerAssignRow
                  key={a.instanceId}
                  attacker={a}
                  myCreatures={myBattlefieldCreatures}
                  pendingBlockers={pendingBlockers}
                  onDeclareBlocker={declareBlocker}
                  onRemoveBlocker={removeBlocker}
                  game={game}
                />
              ))}

              {myBattlefieldCreatures.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-4">
                  No untapped creatures available to block.
                </p>
              )}

              <div className="flex gap-3 pt-3 border-t border-gray-700">
                <button
                  onClick={confirmBlockers}
                  className="flex-1 py-2.5 rounded-lg bg-green-700 hover:bg-green-600 text-white font-semibold transition-colors"
                >
                  Confirm Blockers & Resolve Combat
                </button>
                <button
                  onClick={() => setStep('response_window')}
                  className="px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors"
                >
                  ← Back
                </button>
              </div>
            </div>
          )}

          {/* ── RESOLVING ── */}
          {step === 'resolving' && (
            <div className="flex flex-col items-center justify-center py-10 gap-4">
              <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400">Applying combat damage…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: CombatStep }) {
  const steps: { key: CombatStep; label: string }[] = [
    { key: 'assign_targets', label: 'Targets' },
    { key: 'response_window', label: 'Responses' },
    { key: 'declare_blockers', label: 'Blockers' },
    { key: 'resolving', label: 'Resolve' },
  ];
  const currentIdx = steps.findIndex(s => s.key === current);

  return (
    <div className="flex items-center px-6 py-3 bg-gray-850 border-b border-gray-700 gap-0">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center flex-1">
          <div className={`flex items-center gap-2 ${i <= currentIdx ? 'text-white' : 'text-gray-600'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
              i < currentIdx ? 'bg-green-600 border-green-500 text-white' :
              i === currentIdx ? 'border-red-500 text-red-400' :
              'border-gray-600 text-gray-600'
            }`}>
              {i < currentIdx ? '✓' : i + 1}
            </div>
            <span className="text-xs font-medium hidden sm:block">{s.label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`flex-1 h-0.5 mx-2 ${i < currentIdx ? 'bg-green-600' : 'bg-gray-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

function AttackerRow({
  attacker, defendingPlayers, getPlayerColor, onAssign,
}: {
  attacker: PendingAttacker;
  defendingPlayers: Player[];
  getPlayerColor: (id: string) => string;
  onAssign: (playerId: string) => void;
}) {
  const card = attacker.card;
  const power = card.definition.power ?? '?';
  const toughness = card.definition.toughness ?? '?';

  return (
    <div className="flex items-center gap-4 p-3 bg-gray-800 rounded-xl">
      {/* Card thumbnail */}
      <div className="w-10 h-14 rounded bg-gray-700 flex items-center justify-center text-gray-500 text-xs shrink-0 overflow-hidden">
        {card.definition.imageUrl
          ? <img src={card.definition.imageUrl} alt={card.definition.name} className="w-full h-full object-cover" />
          : <span>🃏</span>
        }
      </div>

      {/* Name + P/T */}
      <div className="flex-1 min-w-0">
        <p className="text-white font-semibold text-sm truncate">{card.definition.name}</p>
        <p className="text-gray-400 text-xs">{power}/{toughness}</p>
      </div>

      {/* Target selector */}
      <div className="flex gap-2 flex-wrap justify-end">
        {defendingPlayers.map(p => (
          <button
            key={p.id}
            onClick={() => onAssign(p.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
              attacker.targetPlayerId === p.id
                ? 'text-white border-current'
                : 'text-gray-400 border-gray-600 hover:border-gray-400'
            }`}
            style={attacker.targetPlayerId === p.id
              ? { borderColor: getPlayerColor(p.id), backgroundColor: getPlayerColor(p.id) + '33', color: getPlayerColor(p.id) }
              : {}
            }
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function AttackerChip({
  attacker, getPlayerName, getPlayerColor,
}: {
  attacker: PendingAttacker;
  getPlayerName: (id: string) => string;
  getPlayerColor: (id: string) => string;
}) {
  return (
    <div className="flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-1.5">
      <span className="text-white text-sm font-medium">{attacker.card.definition.name}</span>
      {attacker.targetPlayerId && (
        <>
          <span className="text-gray-500 text-xs">→</span>
          <span
            className="text-xs font-semibold"
            style={{ color: getPlayerColor(attacker.targetPlayerId) }}
          >
            {getPlayerName(attacker.targetPlayerId)}
          </span>
        </>
      )}
    </div>
  );
}

function BlockerAssignRow({
  attacker, myCreatures, pendingBlockers, onDeclareBlocker, onRemoveBlocker, game,
}: {
  attacker: PendingAttacker;
  myCreatures: CardState[];
  pendingBlockers: PendingBlocker[];
  onDeclareBlocker: (blockerInstanceId: string, attackerInstanceId: string) => void;
  onRemoveBlocker: (blockerInstanceId: string) => void;
  game: import('../../types/game').GameState;
}) {
  const assignedBlockers = pendingBlockers
    .filter(b => b.attackerInstanceId === attacker.instanceId)
    .map(b => game.cards[b.blockerInstanceId])
    .filter(Boolean);

  const power = attacker.card.definition.power ?? '?';
  const toughness = attacker.card.definition.toughness ?? '?';

  return (
    <div className="p-4 bg-gray-800 rounded-xl space-y-3">
      {/* Attacker label */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-11 rounded bg-gray-700 overflow-hidden shrink-0">
          {attacker.card.definition.imageUrl
            ? <img src={attacker.card.definition.imageUrl} alt="" className="w-full h-full object-cover" />
            : <span className="text-gray-500 text-xs flex items-center justify-center h-full">🃏</span>
          }
        </div>
        <div>
          <p className="text-red-400 text-xs uppercase tracking-wider font-semibold">Attacking</p>
          <p className="text-white font-bold text-sm">{attacker.card.definition.name} <span className="text-gray-400 font-normal">({power}/{toughness})</span></p>
        </div>
      </div>

      {/* Assigned blockers */}
      {assignedBlockers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {assignedBlockers.map(blocker => (
            <div key={blocker!.instanceId} className="flex items-center gap-1.5 bg-blue-900/50 border border-blue-700 rounded-lg px-2.5 py-1">
              <span className="text-blue-300 text-xs font-medium">{blocker!.definition.name}</span>
              <button
                onClick={() => onRemoveBlocker(blocker!.instanceId)}
                className="text-blue-500 hover:text-red-400 transition-colors text-xs"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Blocker picker */}
      {myCreatures.length > 0 && (
        <div>
          <p className="text-gray-500 text-xs mb-2">Assign a blocker:</p>
          <div className="flex flex-wrap gap-2">
            {myCreatures.map(c => {
              const alreadyBlockingThis = pendingBlockers.some(
                b => b.blockerInstanceId === c.instanceId && b.attackerInstanceId === attacker.instanceId
              );
              const blockedElsewhere = pendingBlockers.some(
                b => b.blockerInstanceId === c.instanceId && b.attackerInstanceId !== attacker.instanceId
              );
              return (
                <button
                  key={c.instanceId}
                  onClick={() => alreadyBlockingThis
                    ? onRemoveBlocker(c.instanceId)
                    : onDeclareBlocker(c.instanceId, attacker.instanceId)
                  }
                  disabled={blockedElsewhere}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                    alreadyBlockingThis
                      ? 'bg-blue-700 border-blue-500 text-white'
                      : blockedElsewhere
                        ? 'opacity-30 cursor-not-allowed border-gray-700 text-gray-500'
                        : 'border-gray-600 text-gray-300 hover:border-blue-500 hover:text-blue-300'
                  }`}
                >
                  {c.definition.name} ({c.definition.power}/{c.definition.toughness})
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
