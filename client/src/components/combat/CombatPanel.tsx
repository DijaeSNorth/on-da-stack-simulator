// ─── CombatPanel ──────────────────────────────────────────────────────────────
// Flow:
//   0. MYRIAD SETUP  — (only shown if any attacker has Myriad)
//                      Player chooses copies-per-opponent per creature,
//                      previews total attacking stack.
//   1. ASSIGN TARGETS — attacker picks which player each creature attacks
//   2. RESPONSE WINDOW — all non-attacking players may cast spells / abilities
//   3. DECLARE BLOCKERS — each defending player assigns blockers per attacker
//   4. RESOLVE — combat damage is applied, panel closes
//
// Myriad copies are rendered as grouped collapsible sub-rows.
// Large stacks (10+) are paginated by target player.
// ──────────────────────────────────────────────────────────────────────────────

import { useState, useCallback, useMemo } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { AttackDefenderTarget, CardState, Player, GameState } from '../../types/game';
import { getFirebendingAmount, getMechanicHint, getMechanicsForCard } from '../../rules/mechanicsRegistry';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PendingAttacker {
  instanceId: string;
  card: CardState;
  targetPlayerId?: string;
  /** True if this row is a myriad copy (token) */
  isMyriadCopy?: boolean;
  /** Instance ID of the original card that spawned this copy */
  originalInstanceId?: string;
}

interface PendingBlocker {
  blockerInstanceId: string;
  attackerInstanceId: string;
}

/** Per-attacker myriad config chosen in step 0 */
interface MyriadConfig {
  /** How many copies to spawn per opponent */
  copiesPerOpponent: number;
}

type CombatStep = 'myriad_setup' | 'assign_targets' | 'response_window' | 'declare_blockers' | 'damage_preview' | 'resolving';

interface CombatPanelProps {
  attackerIds: string[];
  preAssignments?: Record<string, string>;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasMyriadKeyword(card: CardState): boolean {
  return (
    card.definition.keywords.some(k => k.toLowerCase() === 'myriad') ||
    card.definition.oracleText.toLowerCase().includes('myriad')
  );
}

/** Clamp a number between min and max */
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

// ─── Component ────────────────────────────────────────────────────────────────

export function CombatPanel({ attackerIds, preAssignments = {}, onClose }: CombatPanelProps) {
  const store = useGameStore();
  const { game, localPlayerId } = store;

  // Build initial attacker list
  const initialAttackers: PendingAttacker[] = attackerIds
    .map(id => game.cards[id])
    .filter(Boolean)
    .map(card => ({
      instanceId: card.instanceId,
      card,
      targetPlayerId: preAssignments[card.instanceId],
    }));

  // Determine if any attacker has Myriad
  const myriadAttackers = initialAttackers.filter(a => hasMyriadKeyword(a.card));
  const hasMyriad = myriadAttackers.length > 0;
  const opponentCount = game.players.filter(p => p.id !== game.activePlayerId).length;

  // Initial step: skip myriad_setup if no myriad creatures
  const initialStep: CombatStep = hasMyriad
    ? 'myriad_setup'
    : initialAttackers.every(a => a.targetPlayerId)
      ? 'response_window'
      : 'assign_targets';

  const [step, setStep] = useState<CombatStep>(initialStep);
  const [attackers, setAttackers] = useState<PendingAttacker[]>(initialAttackers);
  const [pendingBlockers, setPendingBlockers] = useState<PendingBlocker[]>([]);
  const [responseNote, setResponseNote] = useState('');

  // ── Myriad config state ─────────────────────────────────────────────────────
  // Map from attacker instanceId → { copiesPerOpponent }
  const [myriadConfigs, setMyriadConfigs] = useState<Record<string, MyriadConfig>>(() => {
    const init: Record<string, MyriadConfig> = {};
    for (const a of myriadAttackers) {
      init[a.instanceId] = { copiesPerOpponent: 1 };
    }
    return init;
  });

  // Live preview: total copies that will be created
  const totalCopiesPreview = useMemo(() => {
    let total = 0;
    for (const a of myriadAttackers) {
      const cfg = myriadConfigs[a.instanceId];
      if (cfg) total += cfg.copiesPerOpponent * Math.max(0, opponentCount - 1);
    }
    return total;
  }, [myriadConfigs, myriadAttackers, opponentCount]);

  // Myriad copies that have been confirmed (added to the attackers list)
  const [myriadCopiesConfirmed, setMyriadCopiesConfirmed] = useState(false);
  // Collapsed state for each myriad original row
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const attackingPlayerId = game.activePlayerId;
  const defendingPlayers = game.players.filter(p => p.id !== attackingPlayerId);
  const combatRedManaTotal = game.players.reduce((sum, player) => sum + (player.combatMana?.R ?? 0), 0);

  // ── Myriad Setup ────────────────────────────────────────────────────────────

  const setCopiesPerOpponent = useCallback((instanceId: string, value: number) => {
    setMyriadConfigs(prev => ({
      ...prev,
      [instanceId]: { copiesPerOpponent: clamp(value, 1, 20) },
    }));
  }, []);

  const confirmMyriad = useCallback(() => {
    // For each myriad attacker, we need a declared target first — move to assign_targets
    // and flag that myriad needs to be triggered after targets are set
    setMyriadCopiesConfirmed(true);
    setStep('assign_targets');
  }, []);

  // ── Assign Targets ──────────────────────────────────────────────────────────

  const assignTarget = useCallback((instanceId: string, targetPlayerId: string) => {
    setAttackers(prev => prev.map(a =>
      a.instanceId === instanceId ? { ...a, targetPlayerId } : a
    ));
  }, []);

  const confirmTargets = useCallback(() => {
    // Commit base attackers to the store
    for (const a of attackers.filter(a => !a.isMyriadCopy)) {
      if (a.targetPlayerId) {
        store.declareAttack(a.instanceId, a.targetPlayerId);
      }
    }
    store.goToPhase('declareAttackers');

    // Fire myriad for each configured attacker now that we know their targets
    const newCopyRows: PendingAttacker[] = [];
    if (myriadCopiesConfirmed) {
      for (const a of attackers.filter(a => !a.isMyriadCopy && hasMyriadKeyword(a.card))) {
        if (!a.targetPlayerId) continue;
        const cfg = myriadConfigs[a.instanceId];
        if (!cfg || cfg.copiesPerOpponent < 1) continue;

        const copies = store.declareMyriadAttack(a.instanceId, a.targetPlayerId, cfg.copiesPerOpponent);
        // Build UI rows for each copy using updated game state
        for (const { copyInstanceId, targetPlayerId } of copies) {
          const copyCard = store.game.cards[copyInstanceId];
          if (copyCard) {
            newCopyRows.push({
              instanceId: copyInstanceId,
              card: copyCard,
              targetPlayerId,
              isMyriadCopy: true,
              originalInstanceId: a.instanceId,
            });
          }
        }
      }
    }

    if (newCopyRows.length > 0) {
      setAttackers(prev => [...prev, ...newCopyRows]);
    }

    setStep('response_window');
  }, [attackers, store, myriadCopiesConfirmed, myriadConfigs]);

  // ── Blockers ────────────────────────────────────────────────────────────────

  const declareBlocker = useCallback((blockerInstanceId: string, attackerInstanceId: string) => {
    setPendingBlockers(prev => {
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
    store.generateCombatPreview();
    setStep('damage_preview');
  }, [pendingBlockers, store]);

  const confirmDamage = useCallback(() => {
    setStep('resolving');
    setTimeout(() => {
      store.confirmCombatDamage();
      store.endCombat();
      onClose();
    }, 800);
  }, [store, onClose]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const getPlayerName = (id: string) => game.players.find(p => p.id === id)?.name ?? id;
  const getPlayerColor = (id: string) => game.players.find(p => p.id === id)?.color ?? '#888';
  const targetLabel = (target: AttackDefenderTarget): string => {
    if (target.type === 'player') return getPlayerName(target.playerId);
    const permanent = game.cards[target.permanentId];
    if (target.type === 'planeswalker') return permanent?.definition.name ?? 'Planeswalker';
    return permanent?.definition.name ?? 'Battle';
  };
  const tokenStackAssignments = (game.combat.attackAssignments ?? []).filter(assignment => assignment.isTokenStack);
  const damagePreview = game.combat.damagePreview;
  const activePlayer = game.players.find(player => player.id === attackingPlayerId);
  const sneakCandidateCount = store.getSneakReturnCandidates(attackingPlayerId).length;
  const sneakHandCount = (activePlayer?.hand ?? [])
    .map(id => game.cards[id])
    .filter(Boolean)
    .filter(card => getMechanicsForCard(card).some(mechanic => mechanic.id === 'sneak'))
    .length;

  const localPlayer = game.players.find(p => p.id === localPlayerId);
  const myBattlefieldCreatures = (localPlayer?.battlefield ?? [])
    .map(id => game.cards[id])
    .filter(c => c && c.definition.cardTypes.includes('Creature') && !c.tapped && !c.summoningSick);

  const isLocalPlayerAttacking = localPlayerId === attackingPlayerId;

  // Group myriad copies by original for the attacker summary / blockers view
  const groupedAttackers = useMemo(() => {
    const originals = attackers.filter(a => !a.isMyriadCopy);
    const copies = attackers.filter(a => a.isMyriadCopy);

    return originals.map(orig => ({
      original: orig,
      copies: copies.filter(c => c.originalInstanceId === orig.instanceId),
    }));
  }, [attackers]);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-3xl mx-4 bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800 shrink-0">
          <div>
            <h2 className="text-white font-bold text-lg">
              {step === 'myriad_setup'    && '✦ Myriad — Configure Copies'}
              {step === 'assign_targets'  && '⚔️ Assign Attack Targets'}
              {step === 'response_window' && '⚡ Response Window'}
              {step === 'declare_blockers'&& '🛡 Declare Blockers'}
              {step === 'resolving'       && '💥 Resolving Combat…'}
            </h2>
            <p className="text-gray-400 text-sm mt-0.5">
              {step === 'myriad_setup'    && `Set how many copies each Myriad creature sends at each opponent`}
              {step === 'assign_targets'  && `${getPlayerName(attackingPlayerId)} is attacking — assign targets for each creature`}
              {step === 'response_window' && 'All players may cast instants or activate abilities before blockers are declared'}
              {step === 'declare_blockers'&& 'Defending players assign blockers to each attacker'}
              {step === 'resolving'       && 'Applying combat damage…'}
            </p>
            {combatRedManaTotal > 0 && (
              <p className="text-orange-300 text-xs mt-1">
                Combat mana: {game.players
                  .filter(player => (player.combatMana?.R ?? 0) > 0)
                  .map(player => `${player.name} ${player.combatMana?.R ?? 0}R`)
                  .join(' / ')}
              </p>
            )}          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none px-2"
            title="Close panel (combat still tracked in log)"
          >
            ✕
          </button>
        </div>

        {/* Step indicator */}
        <StepIndicator current={step} hasMyriad={hasMyriad} />

        {tokenStackAssignments.length > 0 && (
          <div className="border-b border-gray-700 bg-gray-900 px-6 py-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">Token stack attackers</p>
            <div className="flex flex-wrap gap-2">
              {tokenStackAssignments.map(assignment => (
                <span key={assignment.assignmentId} className="rounded-lg border border-red-800 bg-red-950/40 px-2.5 py-1 text-xs text-red-100">
                  {assignment.count} {assignment.sourceName}{assignment.count !== 1 ? 's' : ''} attacking {targetLabel(assignment.attackTarget)}
                </span>
              ))}
            </div>
          </div>
        )}

        {(step === 'declare_blockers' || game.phase === 'declareBlockers') && sneakCandidateCount > 0 && sneakHandCount > 0 && (
          <div className="border-b border-amber-800 bg-amber-950/30 px-6 py-2 text-xs text-amber-100">
            Sneak available: return an unblocked attacker to cast a Sneak spell. {sneakCandidateCount} attacker{sneakCandidateCount !== 1 ? 's' : ''} available.
          </div>
        )}

        {/* Body — scrollable */}
        <div className="p-6 overflow-y-auto flex-1 min-h-0">

          {/* ── STEP 0: MYRIAD SETUP ── */}
          {step === 'myriad_setup' && (
            <div className="space-y-4">
              <p className="text-yellow-400 text-sm">
                {myriadAttackers.length === 1 ? '1 creature has' : `${myriadAttackers.length} creatures have`} Myriad.
                Set how many copies to create per opponent. The copies will attack each player other than the declared defender.
              </p>

              {/* Per-attacker copy count picker */}
              {myriadAttackers.map(a => {
                const cfg = myriadConfigs[a.instanceId] ?? { copiesPerOpponent: 1 };
                const copiesThisCreature = cfg.copiesPerOpponent * Math.max(0, opponentCount - 1);
                return (
                  <MyriadConfigRow
                    key={a.instanceId}
                    attacker={a}
                    opponentCount={opponentCount - 1}  // excluding declared defender
                    copiesPerOpponent={cfg.copiesPerOpponent}
                    totalCopies={copiesThisCreature}
                    onChangeCopies={(v) => setCopiesPerOpponent(a.instanceId, v)}
                  />
                );
              })}

              {/* Non-myriad attackers summary */}
              {initialAttackers.filter(a => !hasMyriadKeyword(a.card)).length > 0 && (
                <div className="bg-gray-800 rounded-xl p-3">
                  <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">Normal attackers (no Myriad)</p>
                  <div className="flex flex-wrap gap-2">
                    {initialAttackers.filter(a => !hasMyriadKeyword(a.card)).map(a => (
                      <span key={a.instanceId} className="bg-gray-700 text-gray-300 text-xs px-2.5 py-1 rounded-lg">
                        {a.card.definition.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Total preview */}
              <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-yellow-300 font-semibold text-sm">Total attacking stack</p>
                  <p className="text-yellow-500 text-xs mt-0.5">
                    {attackerIds.length} original{attackerIds.length !== 1 ? 's' : ''} +{' '}
                    {totalCopiesPreview} Myriad cop{totalCopiesPreview !== 1 ? 'ies' : 'y'} ={' '}
                    <strong className="text-yellow-200">{attackerIds.length + totalCopiesPreview} total attackers</strong>
                  </p>
                </div>
                <div className="text-3xl font-black text-yellow-400 tabular-nums">
                  {attackerIds.length + totalCopiesPreview}
                </div>
              </div>

              <div className="flex gap-3 pt-2 border-t border-gray-700">
                <button
                  onClick={confirmMyriad}
                  className="flex-1 py-2.5 rounded-lg bg-yellow-600 hover:bg-yellow-500 text-white font-semibold transition-colors"
                >
                  Confirm & Assign Targets →
                </button>
                <button
                  onClick={() => { setMyriadCopiesConfirmed(false); setStep('assign_targets'); }}
                  className="px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors"
                  title="Skip Myriad — treat as normal attack"
                >
                  Skip Myriad
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 1: ASSIGN TARGETS ── */}
          {step === 'assign_targets' && (
            <div className="space-y-3">
              {attackers.filter(a => !a.isMyriadCopy).map(a => (
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
                  disabled={attackers.filter(a => !a.isMyriadCopy).some(a => !a.targetPlayerId)}
                  className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                >
                  Declare Attackers {myriadCopiesConfirmed && totalCopiesPreview > 0 ? `& Spawn ${totalCopiesPreview} Myriad Copies` : ''}
                </button>
                <button
                  onClick={confirmTargets}
                  className="px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors"
                >
                  Skip
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2: RESPONSE WINDOW ── */}
          {step === 'response_window' && (
            <div className="space-y-4">
              {/* Attacking summary — grouped by original + copies */}
              <div className="bg-gray-800 rounded-xl p-4">
                <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">
                  Attacking ({attackers.length} total)
                </p>
                <div className="space-y-2">
                  {groupedAttackers.map(({ original, copies }) => (
                    <MyriadGroupSummary
                      key={original.instanceId}
                      original={original}
                      copies={copies}
                      getPlayerName={getPlayerName}
                      getPlayerColor={getPlayerColor}
                      collapsed={!!collapsedGroups[original.instanceId]}
                      onToggle={() => setCollapsedGroups(prev => ({
                        ...prev,
                        [original.instanceId]: !prev[original.instanceId],
                      }))}
                    />
                  ))}
                </div>
              </div>

              {/* Response log */}
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
                        store.addAssistantMessage({ severity: 'info', label: 'Info', text: `Response: ${responseNote.trim()}` });
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

          {/* ── STEP 3: DECLARE BLOCKERS ── */}
          {step === 'declare_blockers' && (
            <div className="space-y-4">
              <BlockerBoard
                groupedAttackers={groupedAttackers}
                myCreatures={myBattlefieldCreatures}
                pendingBlockers={pendingBlockers}
                localPlayerId={localPlayerId}
                isLocalPlayerAttacking={isLocalPlayerAttacking}
                onDeclareBlocker={declareBlocker}
                onRemoveBlocker={removeBlocker}
                getPlayerName={getPlayerName}
                getPlayerColor={getPlayerColor}
                game={game}
              />

              {myBattlefieldCreatures.length === 0 && !isLocalPlayerAttacking && (
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

          {/* ── STEP 4: DAMAGE PREVIEW ── */}
          {step === 'damage_preview' && damagePreview && (
            <div className="space-y-4">
              <div className="bg-gray-800 rounded-xl p-4">
                <p className="text-gray-300 font-semibold text-sm mb-3">Damage Preview</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <DamageSummary title="Players" entries={Object.entries(damagePreview.damageToPlayers).map(([id, damage]) => [getPlayerName(id), damage])} />
                  <DamageSummary title="Planeswalkers" entries={Object.entries(damagePreview.damageToPlaneswalkers).map(([id, damage]) => [game.cards[id]?.definition.name ?? id, damage])} />
                  <DamageSummary title="Battles" entries={Object.entries(damagePreview.damageToBattles).map(([id, damage]) => [game.cards[id]?.definition.name ?? id, damage])} />
                </div>
              </div>

              <div className="space-y-4">
                {[
                  ...(damagePreview.hasFirstStrikeDamageStep
                    ? [{ title: 'First Strike Damage', assignments: damagePreview.firstStrikeAssignments }]
                    : []),
                  { title: 'Normal Damage', assignments: damagePreview.normalDamageAssignments },
                ].map(section => (
                  <div key={section.title} className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{section.title}</p>
                    {section.assignments.length === 0 ? (
                      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-3 text-xs text-gray-500">
                        No combat damage expected in this step.
                      </div>
                    ) : section.assignments.map(assignment => (
                      <div key={`${section.title}-${assignment.attackAssignmentId}`} className="rounded-xl bg-gray-800 border border-gray-700 p-3">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-semibold text-white">{assignment.count} {assignment.attackerName}</span>
                          <span className={assignment.blocked ? 'text-blue-300' : 'text-red-300'}>
                            {assignment.blocked ? 'blocked' : `unblocked for ${assignment.damageToTarget}`}
                          </span>
                          <span className="text-gray-500">→ {targetLabel(assignment.attackTarget)}</span>
                        </div>
                        <div className="mt-1 text-xs text-gray-400">
                          Power: {assignment.powerPerAttacker} each / {assignment.totalPower} total
                          {assignment.blockerIds.length > 0 && ` · blockers: ${assignment.blockerIds.map(id => game.cards[id]?.definition.name ?? id).join(', ')}`}
                        </div>
                        {assignment.notes.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {assignment.notes.map(note => (
                              <p key={note} className="text-xs text-amber-300">{note}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>

              {damagePreview.likelyDestroyedAfterFirstStrike.length > 0 && (
                <div className="rounded-xl border border-orange-800 bg-orange-950/30 p-3">
                  <p className="text-orange-200 text-xs font-semibold uppercase tracking-wider mb-2">Likely destroyed after first strike damage</p>
                  <div className="flex flex-wrap gap-2">
                    {damagePreview.likelyDestroyedAfterFirstStrike.map(id => (
                      <span key={id} className="rounded-lg bg-orange-900/50 px-2 py-1 text-xs text-orange-100">
                        {game.cards[id]?.definition.name ?? id}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {damagePreview.likelyDestroyedCreatures.length > 0 && (
                <div className="rounded-xl border border-red-800 bg-red-950/30 p-3">
                  <p className="text-red-200 text-xs font-semibold uppercase tracking-wider mb-2">Likely destroyed</p>
                  <div className="flex flex-wrap gap-2">
                    {damagePreview.likelyDestroyedCreatures.map(id => (
                      <span key={id} className="rounded-lg bg-red-900/50 px-2 py-1 text-xs text-red-100">
                        {game.cards[id]?.definition.name ?? id}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {damagePreview.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-800 bg-amber-950/30 p-3">
                  <p className="text-amber-200 text-xs font-semibold uppercase tracking-wider mb-2">Manual review warnings</p>
                  <div className="space-y-1">
                    {damagePreview.warnings.map(warning => (
                      <p key={warning} className="text-xs text-amber-100">{warning}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-3 border-t border-gray-700">
                <button
                  onClick={confirmDamage}
                  className="flex-1 py-2.5 rounded-lg bg-green-700 hover:bg-green-600 text-white font-semibold transition-colors"
                >
                  Confirm Damage
                </button>
                <button
                  onClick={() => {
                    store.clearCombatPreview();
                    setStep('declare_blockers');
                  }}
                  className="px-4 py-2.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm transition-colors"
                >
                  ← Back to Blocks
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 4: RESOLVING ── */}
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

// ── Step Indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current, hasMyriad }: { current: CombatStep; hasMyriad: boolean }) {
  type StepDef = { key: CombatStep; label: string };
  const steps: StepDef[] = [
    ...(hasMyriad ? [{ key: 'myriad_setup' as CombatStep, label: 'Myriad' }] : []),
    { key: 'assign_targets', label: 'Targets' },
    { key: 'response_window', label: 'Responses' },
    { key: 'declare_blockers', label: 'Blockers' },
    { key: 'damage_preview', label: 'Preview' },
    { key: 'resolving', label: 'Resolve' },
  ];
  const currentIdx = steps.findIndex(s => s.key === current);

  return (
    <div className="flex items-center px-6 py-3 bg-gray-850 border-b border-gray-700 gap-0 shrink-0">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center flex-1">
          <div className={`flex items-center gap-2 ${i <= currentIdx ? 'text-white' : 'text-gray-600'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
              i < currentIdx  ? 'bg-green-600 border-green-500 text-white' :
              i === currentIdx ? 'border-red-500 text-red-400' :
              'border-gray-600 text-gray-600'
            }`}>
              {i < currentIdx ? '✓' : s.key === 'myriad_setup' ? '✦' : i + 1}
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

// ── Myriad Config Row ─────────────────────────────────────────────────────────

function DamageSummary({ title, entries }: { title: string; entries: [string, number][] }) {
  return (
    <div className="rounded-lg bg-gray-900/70 border border-gray-700 p-3">
      <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">{title}</p>
      {entries.length === 0 ? (
        <p className="text-gray-600 text-xs">No damage</p>
      ) : (
        <div className="space-y-1">
          {entries.map(([label, damage]) => (
            <div key={label} className="flex items-center justify-between text-xs">
              <span className="text-gray-300 truncate">{label}</span>
              <span className="font-bold text-red-300">{damage}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MyriadConfigRow({
  attacker, opponentCount, copiesPerOpponent, totalCopies, onChangeCopies,
}: {
  attacker: { instanceId: string; card: CardState };
  opponentCount: number;
  copiesPerOpponent: number;
  totalCopies: number;
  onChangeCopies: (v: number) => void;
}) {
  const card = attacker.card;
  const power = card.definition.power ?? '?';
  const toughness = card.definition.toughness ?? '?';

  return (
    <div className="bg-gray-800 rounded-xl p-4 space-y-3">
      {/* Card header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-14 rounded bg-gray-700 overflow-hidden shrink-0">
          {card.definition.imageUrl
            ? <img src={card.definition.imageUrl} alt={card.definition.name} className="w-full h-full object-cover" />
            : <span className="text-gray-500 text-xs flex items-center justify-center h-full">🃏</span>
          }
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-white font-semibold text-sm truncate">{card.definition.name}</p>
            <span className="bg-yellow-700 text-yellow-200 text-xs px-1.5 py-0.5 rounded font-semibold shrink-0">MYRIAD</span>
          </div>
          <p className="text-gray-400 text-xs">{power}/{toughness}</p>
        </div>
      </div>

      {/* Copy count control */}
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-gray-400 text-xs uppercase tracking-wider block mb-1">
            Copies per opponent
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onChangeCopies(copiesPerOpponent - 1)}
              disabled={copiesPerOpponent <= 1}
              className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-white font-bold text-lg flex items-center justify-center transition-colors"
            >
              −
            </button>
            <input
              type="number"
              min={1}
              max={20}
              value={copiesPerOpponent}
              onChange={e => onChangeCopies(parseInt(e.target.value) || 1)}
              className="w-16 text-center bg-gray-700 border border-gray-600 rounded-lg px-2 py-1.5 text-white font-bold text-lg focus:outline-none focus:border-yellow-500 tabular-nums"
            />
            <button
              onClick={() => onChangeCopies(copiesPerOpponent + 1)}
              disabled={copiesPerOpponent >= 20}
              className="w-8 h-8 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-white font-bold text-lg flex items-center justify-center transition-colors"
            >
              +
            </button>
          </div>
        </div>

        {/* Per-creature summary */}
        <div className="text-right shrink-0">
          <p className="text-yellow-400 text-xs uppercase tracking-wider">Copies created</p>
          <p className="text-yellow-200 font-black text-2xl tabular-nums">{totalCopies}</p>
          <p className="text-gray-500 text-xs">
            {copiesPerOpponent} × {opponentCount} opponent{opponentCount !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Quick presets for large stacks */}
      <div className="flex gap-2 flex-wrap">
        <p className="text-gray-500 text-xs self-center">Quick:</p>
        {[1, 2, 3, 5, 10].map(n => (
          <button
            key={n}
            onClick={() => onChangeCopies(n)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
              copiesPerOpponent === n
                ? 'bg-yellow-700 border-yellow-500 text-yellow-100'
                : 'border-gray-600 text-gray-400 hover:border-yellow-600 hover:text-yellow-300'
            }`}
          >
            ×{n}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Myriad Group Summary (response window) ────────────────────────────────────

function MyriadGroupSummary({
  original, copies, getPlayerName, getPlayerColor, collapsed, onToggle,
}: {
  original: PendingAttacker;
  copies: PendingAttacker[];
  getPlayerName: (id: string) => string;
  getPlayerColor: (id: string) => string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const hasCopies = copies.length > 0;

  return (
    <div className="space-y-1">
      {/* Original attacker row */}
      <div
        className={`flex items-center gap-2 bg-gray-700 rounded-lg px-3 py-2 ${hasCopies ? 'cursor-pointer hover:bg-gray-600 transition-colors' : ''}`}
        onClick={hasCopies ? onToggle : undefined}
      >
        <span className="text-white text-sm font-medium truncate flex-1">{original.card.definition.name}</span>
        {original.targetPlayerId && (
          <>
            <span className="text-gray-500 text-xs shrink-0">→</span>
            <span className="text-xs font-semibold shrink-0" style={{ color: getPlayerColor(original.targetPlayerId) }}>
              {getPlayerName(original.targetPlayerId)}
            </span>
          </>
        )}
        {hasCopies && (
          <span className="ml-1 bg-yellow-700 text-yellow-200 text-xs px-1.5 py-0.5 rounded font-semibold shrink-0">
            +{copies.length} copies
          </span>
        )}
        {hasCopies && (
          <span className="text-gray-400 text-xs ml-1 shrink-0">{collapsed ? '▶' : '▼'}</span>
        )}
      </div>

      {/* Copy sub-rows */}
      {hasCopies && !collapsed && (
        <div className="ml-4 space-y-1">
          {/* Group copies by target player for readability */}
          {groupByTarget(copies).map(({ targetPlayerId, items }) => (
            <div key={targetPlayerId} className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5">
              <span className="text-yellow-500 text-xs shrink-0">✦</span>
              <span className="text-gray-300 text-xs flex-1">
                {items.length} cop{items.length !== 1 ? 'ies' : 'y'} of {original.card.definition.name}
              </span>
              <span className="text-xs shrink-0">→</span>
              <span className="text-xs font-semibold shrink-0" style={{ color: getPlayerColor(targetPlayerId) }}>
                {getPlayerName(targetPlayerId)}
              </span>
              <span className="text-gray-600 text-xs shrink-0">
                ({(parseInt(original.card.definition.power ?? '0') * items.length)} total power)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Blocker Board (handles large stacks with target-player tabs) ──────────────

const BLOCKERS_PER_PAGE = 8;

function BlockerBoard({
  groupedAttackers, myCreatures, pendingBlockers,
  localPlayerId, isLocalPlayerAttacking,
  onDeclareBlocker, onRemoveBlocker,
  getPlayerName, getPlayerColor, game,
}: {
  groupedAttackers: { original: PendingAttacker; copies: PendingAttacker[] }[];
  myCreatures: CardState[];
  pendingBlockers: PendingBlocker[];
  localPlayerId: string;
  isLocalPlayerAttacking: boolean;
  onDeclareBlocker: (b: string, a: string) => void;
  onRemoveBlocker: (b: string) => void;
  getPlayerName: (id: string) => string;
  getPlayerColor: (id: string) => string;
  game: GameState;
}) {
  const [activePage, setActivePage] = useState(0);

  // Flatten all attackers (originals + copies) in target-player order
  const allAttackers = useMemo(() => {
    const result: PendingAttacker[] = [];
    for (const { original, copies } of groupedAttackers) {
      result.push(original);
      result.push(...copies);
    }
    return result;
  }, [groupedAttackers]);

  // Show only attackers targeting the local player (or all if local is attacking)
  const relevantAttackers = isLocalPlayerAttacking
    ? allAttackers
    : allAttackers.filter(a => a.targetPlayerId === localPlayerId);

  // Pagination for large stacks
  const totalPages = Math.ceil(relevantAttackers.length / BLOCKERS_PER_PAGE);
  const pageAttackers = relevantAttackers.slice(
    activePage * BLOCKERS_PER_PAGE,
    (activePage + 1) * BLOCKERS_PER_PAGE,
  );

  if (relevantAttackers.length === 0) {
    return (
      <p className="text-gray-500 text-sm text-center py-4">
        No attackers targeting you — nothing to block.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* Pagination header for large stacks */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-2">
          <p className="text-gray-400 text-sm">
            Showing {activePage * BLOCKERS_PER_PAGE + 1}–{Math.min((activePage + 1) * BLOCKERS_PER_PAGE, relevantAttackers.length)} of {relevantAttackers.length} attackers
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setActivePage(p => Math.max(0, p - 1))}
              disabled={activePage === 0}
              className="px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-gray-300 text-sm transition-colors"
            >
              ← Prev
            </button>
            <span className="text-gray-400 text-sm self-center">{activePage + 1}/{totalPages}</span>
            <button
              onClick={() => setActivePage(p => Math.min(totalPages - 1, p + 1))}
              disabled={activePage >= totalPages - 1}
              className="px-3 py-1 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-30 text-gray-300 text-sm transition-colors"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {pageAttackers.map(a => (
        <BlockerAssignRow
          key={a.instanceId}
          attacker={a}
          myCreatures={myCreatures}
          pendingBlockers={pendingBlockers}
          onDeclareBlocker={onDeclareBlocker}
          onRemoveBlocker={onRemoveBlocker}
          getPlayerName={getPlayerName}
          game={game}
        />
      ))}
    </div>
  );
}

// ── AttackerRow (assign targets step) ────────────────────────────────────────

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
  const isMyriad = hasMyriadKeyword(card);
  const hasFirebending = getMechanicsForCard(card).some(mechanic => mechanic.id === 'firebending');
  const firebendingAmount = getFirebendingAmount(card);

  return (
    <div className={`flex items-center gap-4 p-3 rounded-xl ${isMyriad ? 'bg-yellow-900/30 border border-yellow-700/40' : 'bg-gray-800'}`}>
      <div className="w-10 h-14 rounded bg-gray-700 flex items-center justify-center text-gray-500 text-xs shrink-0 overflow-hidden">
        {card.definition.imageUrl
          ? <img src={card.definition.imageUrl} alt={card.definition.name} className="w-full h-full object-cover" />
          : <span>🃏</span>
        }
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-white font-semibold text-sm truncate">{card.definition.name}</p>
          {isMyriad && <span className="bg-yellow-700 text-yellow-200 text-xs px-1.5 py-0.5 rounded font-semibold shrink-0">MYRIAD</span>}
        </div>
        <p className="text-gray-400 text-xs">{power}/{toughness}</p>
        {hasFirebending && (
          <p className="text-orange-300 text-xs mt-1" title={getMechanicHint('firebending', 'combat')}>
            Firebending: +{firebendingAmount}R combat mana on attack.
          </p>
        )}
      </div>
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

// ── BlockerAssignRow ──────────────────────────────────────────────────────────

function BlockerAssignRow({
  attacker, myCreatures, pendingBlockers, onDeclareBlocker, onRemoveBlocker, getPlayerName, game,
}: {
  attacker: PendingAttacker;
  myCreatures: CardState[];
  pendingBlockers: PendingBlocker[];
  onDeclareBlocker: (blockerInstanceId: string, attackerInstanceId: string) => void;
  onRemoveBlocker: (blockerInstanceId: string) => void;
  getPlayerName: (id: string) => string;
  game: GameState;
}) {
  const assignedBlockers = pendingBlockers
    .filter(b => b.attackerInstanceId === attacker.instanceId)
    .map(b => game.cards[b.blockerInstanceId])
    .filter(Boolean);

  const power = attacker.card.definition.power ?? '?';
  const toughness = attacker.card.definition.toughness ?? '?';
  const isCopy = attacker.isMyriadCopy;

  return (
    <div className={`p-4 rounded-xl space-y-3 ${isCopy ? 'bg-yellow-900/20 border border-yellow-700/30' : 'bg-gray-800'}`}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-11 rounded bg-gray-700 overflow-hidden shrink-0">
          {attacker.card.definition.imageUrl
            ? <img src={attacker.card.definition.imageUrl} alt="" className="w-full h-full object-cover" />
            : <span className="text-gray-500 text-xs flex items-center justify-center h-full">🃏</span>
          }
        </div>
        <div>
          {isCopy && <p className="text-yellow-500 text-xs uppercase tracking-wider font-semibold">Myriad Copy</p>}
          {!isCopy && <p className="text-red-400 text-xs uppercase tracking-wider font-semibold">Attacking</p>}
          <p className="text-white font-bold text-sm">
            {attacker.card.definition.name.replace(' (Myriad copy)', '')}{' '}
            <span className="text-gray-400 font-normal">({power}/{toughness})</span>
            {attacker.targetPlayerId && (
              <span className="text-gray-500 text-xs font-normal ml-1">→ {getPlayerName(attacker.targetPlayerId)}</span>
            )}
          </p>
        </div>
      </div>

      {assignedBlockers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {assignedBlockers.map(blocker => (
            <div key={blocker!.instanceId} className="flex items-center gap-1.5 bg-blue-900/50 border border-blue-700 rounded-lg px-2.5 py-1">
              <span className="text-blue-300 text-xs font-medium">{blocker!.definition.name}</span>
              <button onClick={() => onRemoveBlocker(blocker!.instanceId)} className="text-blue-500 hover:text-red-400 transition-colors text-xs">✕</button>
            </div>
          ))}
        </div>
      )}

      {myCreatures.length > 0 && (
        <div>
          <p className="text-gray-500 text-xs mb-2">Assign a blocker:</p>
          <div className="flex flex-wrap gap-2">
            {myCreatures.map(c => {
              const alreadyBlockingThis = pendingBlockers.some(b => b.blockerInstanceId === c.instanceId && b.attackerInstanceId === attacker.instanceId);
              const blockedElsewhere = pendingBlockers.some(b => b.blockerInstanceId === c.instanceId && b.attackerInstanceId !== attacker.instanceId);
              return (
                <button
                  key={c.instanceId}
                  onClick={() => alreadyBlockingThis ? onRemoveBlocker(c.instanceId) : onDeclareBlocker(c.instanceId, attacker.instanceId)}
                  disabled={blockedElsewhere}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                    alreadyBlockingThis   ? 'bg-blue-700 border-blue-500 text-white' :
                    blockedElsewhere      ? 'opacity-30 cursor-not-allowed border-gray-700 text-gray-500' :
                    'border-gray-600 text-gray-300 hover:border-blue-500 hover:text-blue-300'
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

// ─── Utilities ────────────────────────────────────────────────────────────────

function groupByTarget(
  attackers: PendingAttacker[],
): { targetPlayerId: string; items: PendingAttacker[] }[] {
  const map = new Map<string, PendingAttacker[]>();
  for (const a of attackers) {
    const tid = a.targetPlayerId ?? 'unknown';
    if (!map.has(tid)) map.set(tid, []);
    map.get(tid)!.push(a);
  }
  return Array.from(map.entries()).map(([targetPlayerId, items]) => ({ targetPlayerId, items }));
}

