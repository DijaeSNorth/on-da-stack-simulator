import { useEffect, useRef, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import type { CardState, Zone } from '../../types/game';
import {
  getAllMechanics,
  hasMechanic,
  getTier3Patterns,
  type CardMechanic,
} from '../../engine/mechanicResolver';
import { getTokenEntry, getTokensFromOracleText } from '../../engine/tokenRegistry';
import { getLandFaceIndex } from '../../engine/cardFaces';
import { canAccessPrivateCard, canControlPlayer, findCardOwner } from '../../engine/playerPermissions';
import { getMechanicHint, getMechanicsForCard } from '../../rules/mechanicsRegistry';
import { KeywordBadge } from '../icons/KeywordBadge';
import { getImportantKeywordIconIds, getKeywordIconIdsForCard } from '../icons/keywordIconRegistry';

interface MenuAction {
  label: string;
  action: () => void;
  divider?: boolean;
  danger?: boolean;
  disabled?: boolean;
  tier?: 1 | 2 | 3;
  tooltip?: string;
}

export function CardContextMenu() {
  const store = useGameStore();
  const { ui, game, localPlayerId, multiplayer } = store;
  const menuRef = useRef<HTMLDivElement>(null);
  const [manualToolsOpen, setManualToolsOpen] = useState(false);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        store.closeCardContextMenu();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (!ui.cardContextMenu) return null;

  const { instanceId, x, y } = ui.cardContextMenu;
  const card = game.cards[instanceId];
  if (!card) return null;

  const def = card.definition;
  const ownerId = findCardOwner(game, card) ?? card.controllerId;
  const multiplayerControlStatus = multiplayer.isSpectator ? 'spectator' : multiplayer.status;
  const canControlThisCard = canControlPlayer(localPlayerId, ownerId, multiplayerControlStatus, ui.judgeMode);
  const canViewThisCard = canAccessPrivateCard(game, card, localPlayerId, multiplayerControlStatus, ui.judgeMode);
  if (!canViewThisCard) return null;
  const manualToolsExpandedByDensity = ui.judgeMode || ui.settings.density === 'detailed' || ui.settings.density === 'judge';
  const showManualTools = manualToolsExpandedByDensity || manualToolsOpen;
  const onBattlefield = card.zone === 'battlefield';
  const inHand = card.zone === 'hand';
  const inGraveyard = card.zone === 'graveyard';
  const inExile = card.zone === 'exile';
  const inLibrary = card.zone === 'library';
  const inCommand = card.zone === 'command';
  const isCommanderCard = game.players.some(player => player.id === ownerId && player.commanders.includes(instanceId));
  const isPermanent = ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Land', 'Battle']
    .some(t => def.cardTypes.includes(t as typeof def.cardTypes[number]));
  const rulesMechanics = getMechanicsForCard(card);
  const keywordIconIds = getImportantKeywordIconIds(getKeywordIconIdsForCard(card), 6);
  const hintContext = rulesMechanics.some(mechanic => mechanic.id === 'waterbend') && inHand
    ? 'cost_payment'
    : inExile ? 'exile' : inGraveyard ? 'graveyard' : onBattlefield ? 'battlefield' : 'manual_prompt';
  const exhaustUsed = Boolean(card.exhaustUsed?.default) || /\bexhaust(?:ed)?\s*:\s*used\b/i.test(card.notes);
  const hasClue = rulesMechanics.some(mechanic => mechanic.id === 'clue');
  const hasExhaust = rulesMechanics.some(mechanic => mechanic.id === 'exhaust');
  const hasWaterbend = rulesMechanics.some(mechanic => mechanic.id === 'waterbend');
  const hasEarthbend = rulesMechanics.some(mechanic => mechanic.id === 'earthbend');
  const hasSneak = rulesMechanics.some(mechanic => mechanic.id === 'sneak');
  const hasStation = rulesMechanics.some(mechanic => mechanic.id === 'station');
  const hasBlight = rulesMechanics.some(mechanic => mechanic.id === 'blight');
  const hasClass = rulesMechanics.some(mechanic => mechanic.id === 'classes') ||
    def.subTypes.some(subtype => subtype.toLowerCase() === 'class') ||
    /\bclass\b/i.test(def.typeLine);
  const isSpacecraft = rulesMechanics.some(mechanic => mechanic.id === 'spacecraft') ||
    def.subTypes.some(subtype => subtype.toLowerCase() === 'spacecraft') ||
    /\bspacecraft\b/i.test(def.typeLine);
  const exilePermission = card.exilePermission;
  const canUseExilePermission = Boolean(exilePermission && (exilePermission.ownerId === localPlayerId || ui.judgeMode));

  const close = () => store.closeCardContextMenu();
  const promptCounterChange = (mode: 'add' | 'remove') => {
    const counterType = window.prompt(`${mode === 'add' ? 'Add' : 'Remove'} counter type`, '+1/+1')?.trim();
    if (!counterType) return;
    const amount = Math.max(1, Number.parseInt(window.prompt('Amount', '1') ?? '1', 10));
    if (mode === 'add') store.addCounterToCard(instanceId, counterType, amount);
    else store.removeCounterFromCard(instanceId, counterType, amount);
  };
  const promptPowerToughnessOverride = () => {
    const current = card.powerToughnessOverride;
    const raw = window.prompt(
      'Set effective base P/T as power/toughness. Counters still apply.',
      `${current?.power ?? def.power ?? ''}/${current?.toughness ?? def.toughness ?? ''}`,
    );
    if (!raw) return;
    const [power = '', toughness = ''] = raw.split('/').map(part => part.trim());
    if (!power && !toughness) return;
    const reason = window.prompt('Reason/note for this P/T override?', current?.reason ?? 'Manual combat adjustment') ?? undefined;
    store.setPowerToughnessOverride([instanceId], power, toughness, 'manual', reason);
  };

  const actions: MenuAction[] = [];

  // ─── Hand actions ───────────────────────────────────────────────────────────
  if (canControlThisCard && inHand) {
    const landFaceIndex = getLandFaceIndex(def);
    if (def.cardTypes.includes('Land')) {
      actions.push({
        label: 'Play Land',
        action: () => { store.playLand(localPlayerId, instanceId); close(); },
      });
    } else {
      actions.push({
        label: `Cast ${def.name}`,
        action: () => { store.castCard(localPlayerId, instanceId); close(); },
      });
      if (landFaceIndex !== null) {
        const landFace = def.faces?.[landFaceIndex];
        actions.push({
          label: `Play Land Side${landFace?.name ? ` (${landFace.name})` : ''}`,
          action: () => { store.playLand(localPlayerId, instanceId, landFaceIndex); close(); },
          tooltip: 'Play the modal double-faced card using its land face.',
        });
      }
    }

    if (hasSneak && store.canCastWithSneak(localPlayerId, instanceId)) {
      const sneakCandidates = store.getSneakReturnCandidates(localPlayerId);
      actions.push({ divider: true, label: '', action: () => {} });
      if (sneakCandidates.length === 1) {
        actions.push({
          label: 'Cast with Sneak',
          tier: 2,
          tooltip: `Return unblocked ${sneakCandidates[0].sourceName} to cast this with Sneak.`,
          action: () => { store.castWithSneak(localPlayerId, instanceId, sneakCandidates[0].attackerId); close(); },
        });
      } else {
        for (const candidate of sneakCandidates) {
          const attacker = game.cards[candidate.attackerId];
          actions.push({
            label: `Sneak - return ${attacker?.definition.name ?? candidate.sourceName}`,
            tier: 2,
            tooltip: 'Return this unblocked attacker, then put the Sneak creature in tapped and attacking the same target.',
            action: () => { store.castWithSneak(localPlayerId, instanceId, candidate.attackerId); close(); },
          });
        }
      }
    }

    // Cycling — tier 1 (popular) or detected from oracle text
    if (hasMechanic(def, 'cycling')) {
      actions.push({
        label: 'Cycle (Discard → Draw 1)',
        tier: 1,
        action: () => { store.cycleCard(localPlayerId, instanceId); close(); },
        tooltip: 'Pay cycling cost, discard, draw a card.',
      });
    }

    // Tier 2 keywords relevant to hand casting (alternative cast modes)
    const t2 = getAllMechanics(def).filter(m =>
      m.tier === 2 && m.fromZone === 'hand' && m.key !== 'cycling'
    );
    if (t2.length > 0) {
      actions.push({ divider: true, label: '', action: () => {} });
      for (const m of t2) {
        actions.push({
          label: m.label,
          tier: 2,
          tooltip: m.description,
          action: () => {
            // Most hand-alternative-cost mechanics still cast the card — just log it
            store.castCard(localPlayerId, instanceId);
            close();
          },
        });
      }
    }
  }

  // ─── Graveyard actions ──────────────────────────────────────────────────────
  if (canControlThisCard && inGraveyard) {
    if (hasMechanic(def, 'dredge')) {
      actions.push({
        label: 'Dredge',
        tier: 1,
        action: () => { store.dredgeCard(localPlayerId, instanceId); close(); },
        tooltip: 'If you would draw, mill the Dredge number and return this card to hand.',
      });
    }
    actions.push({
      label: 'Cast from Graveyard',
      tier: 1,
      action: () => { store.castFromZone(localPlayerId, instanceId, 'graveyard'); close(); },
      tooltip: 'Flashback, Escape, Unearth, Encore, etc.',
    });
    if (isCommanderCard) {
      actions.push({
        label: 'Move Commander to Command Zone',
        tier: 1,
        action: () => { store.moveCommanderToCommandZone(ownerId, instanceId, 'graveyard'); close(); },
        tooltip: 'Move this commander from graveyard to the command zone without increasing commander tax.',
      });
    }
    if (isPermanent) {
      actions.push({
        label: 'Reanimate (onto Battlefield)',
        tier: 1,
        action: () => { store.reanimateCard(instanceId, localPlayerId); close(); },
        tooltip: 'Put this permanent directly onto the battlefield.',
      });
    }

    // Tier 2 keywords: haunt, dredge, jump-start
    const t2gy = getAllMechanics(def).filter(m =>
      m.tier === 2 && (m.fromZone === 'graveyard' || m.key === 'dredge' || m.key === 'jump-start' || m.key === 'haunt')
    );
    for (const m of t2gy) {
      // Don't duplicate generic cast-from-gy
      if (m.action === 'CAST_FROM_GY' || m.key === 'dredge') continue;
      actions.push({
        label: m.label,
        tier: 2,
        tooltip: m.description,
        action: () => { store.castFromZone(localPlayerId, instanceId, 'graveyard'); close(); },
      });
    }
  }

  // ─── Exile actions ──────────────────────────────────────────────────────────
  if (canControlThisCard && inExile) {
    actions.push({
      label: exilePermission?.alternativeCost ? 'Cast for ' + exilePermission.alternativeCost : 'Cast from Exile',
      tier: 1,
      action: () => { if (exilePermission && canUseExilePermission) store.castExiledWithPermission(localPlayerId, instanceId); else store.castFromZone(localPlayerId, instanceId, 'exile'); close(); },
      tooltip: exilePermission?.sourceMechanic === 'airbend' ? 'Airbended - owner may cast this for {2}; normal timing applies.' : 'Foretell, Adventure, Suspend, Rebound, etc.',
    });
    if (isCommanderCard) {
      actions.push({
        label: 'Move Commander to Command Zone',
        tier: 1,
        action: () => { store.moveCommanderToCommandZone(ownerId, instanceId, 'exile'); close(); },
        tooltip: 'Move this commander from exile to the command zone without increasing commander tax.',
      });
    }
    if (isPermanent) {
      actions.push({
        label: 'Put onto Battlefield',
        tier: 1,
        action: () => { store.reanimateCard(instanceId, localPlayerId); close(); },
        tooltip: 'Directly move this permanent onto the battlefield.',
      });
    }
  }

  if (canControlThisCard && inCommand && isCommanderCard) {
    actions.push({
      label: 'Cast Commander',
      tier: 1,
      action: () => { store.castCommanderFromCommandZone(ownerId, instanceId); close(); },
      tooltip: 'Cast this commander from the command zone and apply commander tax.',
    });
  }

  // ─── Battlefield actions ────────────────────────────────────────────────────
  if (canControlThisCard && onBattlefield) {
    if (!card.tapped) {
      actions.push({ label: 'Tap', action: () => { store.tapCard(instanceId); close(); } });
    } else {
      actions.push({ label: 'Untap', action: () => { store.untapCard(instanceId); close(); } });
    }
    if (hasClue) {
      actions.push({
        label: 'Crack Clue / Draw Card',
        tier: 1,
        tooltip: 'Pay {2}, sacrifice this Clue, then draw a card.',
        action: () => { store.activateClue(instanceId, { confirmPayment: true }); close(); },
      });
    }

    if (hasExhaust) {
      actions.push({
        label: exhaustUsed ? 'Exhaust Used' : 'Mark Exhaust Used',
        tier: 2,
        disabled: exhaustUsed,
        tooltip: exhaustUsed ? 'This exhaust ability is already marked used for this object.' : 'Mark this object as having used its exhaust ability.',
        action: () => { if (!exhaustUsed) store.markExhaustUsed(instanceId); close(); },
      });
      actions.push({
        label: 'Reset Exhaust',
        tier: 2,
        tooltip: 'Manual/judge reset for exhaust tracking on this object.',
        action: () => { store.resetExhaust(instanceId); close(); },
      });
    }

    if (hasWaterbend) {
      actions.push({
        label: 'Pay Waterbend (tap 1)',
        tier: 2,
        tooltip: 'Tap one eligible untapped artifact or creature you control toward a Waterbend generic cost.',
        action: () => {
          const eligible = store.getWaterbendEligiblePermanents(localPlayerId);
          if (eligible[0]) store.payWaterbendCost(localPlayerId, 1, [eligible[0].instanceId], instanceId);
          close();
        },
      });
    }

    if ((hasEarthbend || def.cardTypes.includes('Land')) && def.cardTypes.includes('Land')) {
      actions.push({
        label: 'Earthbend 1',
        tier: 2,
        tooltip: 'Manual Earthbend shortcut: make this land a 0/0 land creature with haste and one +1/+1 counter.',
        action: () => { store.applyEarthbend(localPlayerId, instanceId, 1); close(); },
      });
    }

    // ── Token shortcuts ──────────────────────────────────────────────────────
    if (isSpacecraft || hasStation) {
      const stationEligible = store.getStationEligibleCreatures(localPlayerId, instanceId);
      actions.push({
        label: stationEligible.length === 1 ? `Station with ${stationEligible[0].definition.name}` : 'Station...',
        tier: 2,
        disabled: stationEligible.length === 0,
        tooltip: stationEligible.length === 0
          ? 'No untapped controlled creature is eligible to station this Spacecraft.'
          : 'Tap another untapped creature you control to add charge counters equal to its power.',
        action: () => {
          if (stationEligible.length === 1) {
            store.stationSpacecraft(localPlayerId, instanceId, stationEligible[0].instanceId);
          } else if (stationEligible.length > 1) {
            const choices = stationEligible.map((candidate, index) => `${index + 1}: ${candidate.definition.name} (${candidate.definition.power ?? '?'}/${candidate.definition.toughness ?? '?'})`).join('\n');
            const raw = window.prompt(`Choose creature to station with:\n${choices}`, '1');
            const selected = Number.parseInt(raw ?? '', 10);
            const candidate = stationEligible[selected - 1];
            if (candidate) store.stationSpacecraft(localPlayerId, instanceId, candidate.instanceId);
          }
          close();
        },
      });
    }

    if ((hasBlight || ui.judgeMode) && def.cardTypes.includes('Creature')) {
      actions.push({
        label: 'Blight...',
        tier: 2,
        tooltip: 'Put N -1/-1 counters on a creature you control. +1/+1 and -1/-1 counters cancel in pairs.',
        action: () => {
          const raw = window.prompt('Blight amount', '1');
          const amount = Math.max(0, Number.parseInt(raw ?? '', 10));
          if (amount > 0) store.applyBlight(localPlayerId, instanceId, amount);
          close();
        },
      });
    }

    if (hasClass) {
      actions.push({
        label: `Level Up Class (to ${(card.classLevel ?? 1) + 1})`,
        tier: 2,
        tooltip: `Current Class level: ${card.classLevel ?? 1}. Level abilities unlock in order at sorcery speed.`,
        action: () => {
          store.levelUpClass(localPlayerId, instanceId);
          close();
        },
      });
      if (ui.judgeMode) {
        actions.push({
          label: 'Set Class Level...',
          tier: 3,
          tooltip: 'Judge/manual override. This can skip levels.',
          action: () => {
            const raw = window.prompt('Class level', String(card.classLevel ?? 1));
            const level = Math.max(1, Number.parseInt(raw ?? '', 10));
            if (level > 0) store.setClassLevel(localPlayerId, instanceId, level, true);
            close();
          },
        });
      }
    }

    actions.push({
      label: 'Set Power/Toughness',
      tier: 2,
      tooltip: 'Manual base P/T override. +1/+1 and -1/-1 counters still apply.',
      action: () => { promptPowerToughnessOverride(); close(); },
    });
    if (card.powerToughnessOverride) {
      actions.push({
        label: 'Clear P/T Override',
        tier: 2,
        tooltip: 'Remove the manual P/T override from this object.',
        action: () => { store.clearPowerToughnessOverride([instanceId]); close(); },
      });
    }

    const tokenEntry = getTokenEntry(def.name);
    const oracleTokens = !tokenEntry ? getTokensFromOracleText(def.oracleText || '') : [];
    const allTokens = tokenEntry?.tokens.length ? tokenEntry.tokens : oracleTokens;

    if (allTokens.length > 0) {
      actions.push({ divider: true, label: '', action: () => {} });
      const count = tokenEntry?.defaultCount ?? 1;
      const isVariable = tokenEntry?.variableCount ?? false;
      const hint = tokenEntry?.hint ?? `Create token(s) from ${def.name}'s ability`;
      const seen = new Set<string>();
      for (const tok of allTokens) {
        if (seen.has(tok.name)) continue;
        seen.add(tok.name);
        const countLabel = isVariable ? 'X×' : count > 1 ? `${count}×` : '1×';
        actions.push({
          label: `✨ ${countLabel} ${tok.emoji ?? ''} ${tok.name}`.trim(),
          tier: 1,
          tooltip: hint,
          action: () => {
            const n = isVariable ? 1 : count;
            for (let i = 0; i < n; i++) {
              store.createTokenCard(localPlayerId, {
                id: `token-${tok.name.toLowerCase().replace(/\s+/g, '-')}`,
                name: tok.name,
                power: tok.power,
                toughness: tok.toughness,
                colors: tok.colors,
                cardTypes: tok.cardTypes as typeof def.cardTypes,
                subTypes: tok.subTypes,
                keywords: tok.keywords,
                oracleText: tok.oracleText ?? '',
                typeLine: tok.typeLine,
                isDoubleFaced: false,
                legalities: {},
                colorIdentity: tok.colors,
                cmc: 0,
              });
            }
            close();
          },
        });
      }
      if (isVariable) {
        actions.push({
          label: `  → type "create N ${allTokens[0].subTypes[0]?.toLowerCase() || 'token'}s" for custom count`,
          tooltip: hint,
          action: () => close(),
        });
      }
    }

    if (def.cardTypes.includes('Creature') && !card.tapped && !card.summoningSick) {
      actions.push({
        label: 'Declare as Attacker →',
        action: () => { store.enterCombat(); close(); },
      });
    }

    if (def.isDoubleFaced) {
      actions.push({
        label: card.transformed ? 'Transform Back' : 'Transform',
        action: () => { store.transformCard(instanceId); close(); },
      });
    }

    // Equip / Fortify / Crew / Level Up / Monstrosity from tier 2
    const t2bf = getAllMechanics(def).filter(m =>
      m.tier === 2 && m.fromZone === 'battlefield'
    );
    if (t2bf.length > 0) {
      actions.push({ divider: true, label: '', action: () => {} });
      for (const m of t2bf) {
        actions.push({
          label: m.label,
          tier: 2,
          tooltip: m.description,
          action: () => {
            // Log the intent; actual cost/target selection is manual
            store.logAction && store.logAction(localPlayerId, m.key.toUpperCase(), `${def.name} — ${m.label}`);
            close();
          },
        });
      }
    }

    actions.push({ divider: true, label: '', action: () => {} });
    actions.push({ label: 'Add +1/+1 Counter', action: () => { store.addCounterToCard(instanceId, '+1/+1'); close(); } });
    actions.push({ label: 'Add -1/-1 Counter', action: () => { store.addCounterToCard(instanceId, '-1/-1'); close(); } });
    actions.push({ label: 'Add Loyalty Counter', action: () => { store.addCounterToCard(instanceId, 'loyalty'); close(); } });

    actions.push({ divider: true, label: '', action: () => {} });
  }

  // ─── Tier 3: Oracle-text niche mechanics (flag but don't auto-execute) ──────
  const t3 = getTier3Patterns(def);
  if (canControlThisCard && t3.length > 0) {
    actions.push({ divider: true, label: '', action: () => {} });
    for (const p of t3) {
      actions.push({
        label: `⚑ ${p.label}`,
        tier: 3,
        tooltip: p.description,
        // Tier 3: log a judge note so players are aware — action must be done manually
        action: () => {
          store.logAction && store.logAction(
            localPlayerId,
            'JUDGE_NOTE',
            `[Niche mechanic] ${def.name} — ${p.label}: ${p.description}`
          );
          close();
        },
      });
    }
  }

  // ─── Move to zone ───────────────────────────────────────────────────────────
  if (canControlThisCard) {
    actions.push({ divider: true, label: '', action: () => {} });
    const moveOptions: { label: string; zone: Zone }[] = [
      { label: 'Move to Hand', zone: 'hand' },
      { label: 'Move to Battlefield', zone: 'battlefield' },
      { label: 'Move to Graveyard', zone: 'graveyard' },
      { label: 'Exile', zone: 'exile' },
      { label: 'Move to Library (bottom)', zone: 'library' },
      { label: 'Return to Command Zone', zone: 'command' },
    ];
    for (const opt of moveOptions) {
      if (card.zone !== opt.zone) {
        actions.push({
          label: opt.label,
          action: () => { store.moveCardToZone(instanceId, opt.zone); close(); },
        });
      }
    }
  }

  if (canControlThisCard || ui.judgeMode) {
    actions.push({ divider: true, label: '', action: () => {} });
    actions.push({
      label: showManualTools ? 'Manual / Judge Tools - Hide' : 'Manual / Judge Tools',
      tier: 3,
      tooltip: showManualTools
        ? 'Hide controlled correction tools.'
        : 'Show controlled correction tools for unsupported or missed card logic.',
      action: () => { if (!manualToolsExpandedByDensity) setManualToolsOpen(open => !open); },
    });
  }

  if ((canControlThisCard || ui.judgeMode) && showManualTools) {
    actions.push({
      label: 'Manual: Add Counter...',
      tier: 3,
      action: () => { promptCounterChange('add'); close(); },
    });
    actions.push({
      label: 'Manual: Remove Counter...',
      tier: 3,
      action: () => { promptCounterChange('remove'); close(); },
    });
    actions.push({
      label: 'Manual: Set P/T Override...',
      tier: 3,
      action: () => { promptPowerToughnessOverride(); close(); },
    });
    actions.push({
      label: 'Manual: Clear P/T Override',
      tier: 3,
      disabled: !card.powerToughnessOverride,
      action: () => { store.clearPowerToughnessOverride([instanceId]); close(); },
    });
    actions.push({
      label: card.tapped ? 'Manual: Untap' : 'Manual: Tap',
      tier: 3,
      disabled: !onBattlefield,
      action: () => { card.tapped ? store.untapCard(instanceId) : store.tapCard(instanceId); close(); },
    });
    actions.push({
      label: 'Manual: Mark Exhaust Used',
      tier: 3,
      disabled: exhaustUsed,
      tooltip: 'Manual correction for Exhaust or similar once-per-object tracking.',
      action: () => { store.markExhaustUsed(instanceId); close(); },
    });
    actions.push({
      label: 'Manual: Reset Exhaust',
      tier: 3,
      tooltip: 'Controlled manual corrections for unsupported card logic.',
      action: () => { store.resetExhaust(instanceId); close(); },
    });
    actions.push({
      label: 'Manual: Add Damage...',
      tier: 3,
      disabled: !onBattlefield,
      action: () => {
        const amount = Math.max(0, Number.parseInt(window.prompt('Add marked damage', '1') ?? '0', 10));
        store.setMarkedDamage(instanceId, (card.markedForDamage ?? 0) + amount);
        close();
      },
    });
    actions.push({
      label: 'Manual: Set Damage...',
      tier: 3,
      disabled: !onBattlefield,
      action: () => {
        const amount = Math.max(0, Number.parseInt(window.prompt('Marked damage', String(card.markedForDamage ?? 0)) ?? '0', 10));
        store.setMarkedDamage(instanceId, amount);
        close();
      },
    });
    actions.push({
      label: 'Manual: Clear Damage',
      tier: 3,
      disabled: !onBattlefield,
      action: () => { store.clearMarkedDamage(instanceId); close(); },
    });
    actions.push({
      label: 'Manual: Move to Zone...',
      tier: 3,
      action: () => {
        const choices: { label: string; zone: Zone }[] = [
          { label: 'Hand', zone: 'hand' },
          { label: 'Battlefield', zone: 'battlefield' },
          { label: 'Graveyard', zone: 'graveyard' },
          { label: 'Exile', zone: 'exile' },
          { label: 'Library', zone: 'library' },
          { label: 'Command', zone: 'command' },
        ];
        const raw = window.prompt(`Move to zone:\n${choices.map((choice, index) => `${index + 1}: ${choice.label}`).join('\n')}`, '3');
        const selected = Number.parseInt(raw ?? '', 10);
        const zone = choices[selected - 1]?.zone;
        if (zone) store.moveCardToZone(instanceId, zone);
        close();
      },
    });
    actions.push({
      label: 'Manual: Mark Attacking',
      tier: 3,
      action: () => { store.setManualCombatRole(instanceId, 'attacker'); close(); },
    });
    actions.push({
      label: 'Manual: Mark Blocking',
      tier: 3,
      action: () => { store.setManualCombatRole(instanceId, 'blocker'); close(); },
    });
    actions.push({
      label: 'Manual: Clear Combat Role',
      tier: 3,
      action: () => { store.setManualCombatRole(instanceId, 'none'); close(); },
    });
    actions.push({
      label: 'Manual: Add Note...',
      tier: 3,
      action: () => {
        const note = window.prompt('Temporary note', card.notes || 'Manual correction');
        if (note) store.setCardTemporaryNote(instanceId, note);
        close();
      },
    });
    actions.push({
      label: 'Manual: Add Trigger...',
      tier: 3,
      action: () => {
        const text = window.prompt('Trigger text', `${def.name} manual trigger`);
        if (text) store.addManualTriggerForCard(instanceId, text);
        close();
      },
    });
    actions.push({
      label: 'Manual: Set Controller...',
      tier: 3,
      action: () => {
        const choices = game.players.map((player, index) => `${index + 1}: ${player.name}`).join('\n');
        const raw = window.prompt(`Set controller:\n${choices}`, '1');
        const selected = Number.parseInt(raw ?? '', 10);
        const player = game.players[selected - 1];
        if (player) store.setCardController(instanceId, player.id);
        close();
      },
    });
    if (ui.judgeMode) {
      actions.push({
        label: 'Judge: Set Owner...',
        tier: 3,
        action: () => {
          const choices = game.players.map((player, index) => `${index + 1}: ${player.name}`).join('\n');
          const raw = window.prompt(`Set owner:\n${choices}`, '1');
          const selected = Number.parseInt(raw ?? '', 10);
          const player = game.players[selected - 1];
          if (player) store.setCardOwner(instanceId, player.id);
          close();
        },
      });
    }
    actions.push({
      label: 'Manual: Create Token...',
      tier: 3,
      action: () => {
        const name = window.prompt('Token name', 'Token')?.trim();
        if (!name) { close(); return; }
        const pt = window.prompt('Power/Toughness', '1/1') ?? '1/1';
        const [power = '1', toughness = '1'] = pt.split('/').map(part => part.trim());
        store.createTokenCard(localPlayerId || card.controllerId, {
          name,
          power,
          toughness,
          colors: [],
          colorIdentity: [],
          cardTypes: ['Creature'],
          subTypes: [name],
          keywords: [],
          typeLine: `Token Creature - ${name}`,
          oracleText: '',
        });
        close();
      },
    });
  }

  actions.push({ divider: true, label: '', action: () => {} });
  actions.push({ label: 'Preview Card', action: () => { store.setCardPreview(instanceId, { x: ui.cardContextMenu?.x ?? 24, y: ui.cardContextMenu?.y ?? 24 }); close(); } });

  // ─── Clamp to viewport ──────────────────────────────────────────────────────
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const menuW = 224;
  const menuH = actions.length * 30;
  const clampedX = Math.min(x, vw - menuW - 8);
  const clampedY = Math.min(y, vh - menuH - 8);

  // Tier badge styles
  const tierBadge = (tier?: 1 | 2 | 3) => {
    if (!tier) return null;
    const colors: Record<number, string> = {
      1: '#22c55e',  // green — popular/evergreen
      2: '#3b82f6',  // blue — keyword
      3: '#f59e0b',  // amber — oracle/niche
    };
    const labels: Record<number, string> = { 1: 'T1', 2: 'T2', 3: 'T3' };
    return (
      <span style={{
        marginLeft: 'auto',
        fontSize: 9,
        fontWeight: 700,
        color: colors[tier],
        border: `1px solid ${colors[tier]}`,
        borderRadius: 3,
        padding: '0 3px',
        opacity: 0.8,
        flexShrink: 0,
      }}>
        {labels[tier]}
      </span>
    );
  };

  return (
    <div
      ref={menuRef}
      data-testid="card-context-menu"
      style={{
        position: 'fixed',
        left: clampedX,
        top: clampedY,
        zIndex: 99999,
        background: '#1e1e32',
        border: '1px solid #3d3d5c',
        borderRadius: 8,
        minWidth: menuW,
        maxHeight: '80vh',
        overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '8px 12px 6px',
        borderBottom: '1px solid #2d2d4a',
        fontSize: 11,
        fontWeight: 700,
        color: '#94a3b8',
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
      }}>
        {def.name}
        <span style={{ fontSize: 9, color: '#4b5563', marginLeft: 6, fontWeight: 400 }}>
          {def.keywords.length > 0 ? def.keywords.slice(0, 3).join(' · ') : def.typeLine}
        </span>
        {keywordIconIds.length > 0 && (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 5 }}>
            {keywordIconIds.map(id => <KeywordBadge key={id} id={id} size={12} />)}
          </div>
        )}
        {rulesMechanics.length > 0 && (
          <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3, textTransform: 'none', letterSpacing: 0 }}>
            {rulesMechanics.slice(0, 2).map(mechanic => (
              <div key={mechanic.id} title={mechanic.rulesText} style={{ color: '#bae6fd', fontSize: 10, lineHeight: 1.25, fontWeight: 500 }}>
                {mechanic.automationLevel === 'manual_prompt' || !mechanic.executable ? 'Manual: ' : ''}
                {getMechanicHint(mechanic.id, hintContext, undefined, { exhaustUsed })}
              </div>
            ))}
          </div>
        )}      </div>

      {actions.map((action, i) => {
        if (action.divider) {
          return <div key={i} style={{ height: 1, background: '#2d2d4a', margin: '2px 0' }} />;
        }
        return (
          <button
            key={i}
            title={action.tooltip}
            onClick={action.action}
            disabled={action.disabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: '6px 14px',
              background: 'none',
              border: 'none',
              cursor: action.disabled ? 'not-allowed' : 'pointer',
              textAlign: 'left',
              fontSize: 12,
              color: action.danger ? '#f87171'
                : action.tier === 3 ? '#fbbf24'
                : action.disabled ? '#4b5563'
                : '#e2e8f0',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = '#2d2d4a'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = 'none'; }}
          >
            <span style={{ flex: 1 }}>{action.label}</span>
            {tierBadge(action.tier)}
          </button>
        );
      })}
    </div>
  );
}






