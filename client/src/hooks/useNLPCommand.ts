// ─── useNLPCommand ────────────────────────────────────────────────────────────
// Connects the NLP parser to the Zustand game store.
// Handles ALL intent types and dispatches the right store actions.
// Returns suggestions (for CommandInput autocomplete) and an execute fn.
// ──────────────────────────────────────────────────────────────────────────────

import { useCallback } from 'react';
import { useGameStore } from '../store/gameStore';
import { parseCommand, resolveIntent, getSuggestions } from '../engine/nlpParser';
import type { ResolvedIntent } from '../engine/nlpParser';
import { resolveTokenShortcut, getBattlefieldTokenSuggestions, getTokenDefinitionByName } from '../engine/tokenRegistry';
import type { TokenDef } from '../engine/tokenRegistry';
import { fetchScryfallTokenDefinition } from '../engine/scryfallTokens';
import type { CardDefinition, CardType, ManaColor } from '../types/game';

function tokenDefToCardDefinition(token: TokenDef): Partial<CardDefinition> & { name: string } {
  return {
    id: `token-${token.name.toLowerCase().replace(/\s+/g, '-')}`,
    name: token.name,
    power: token.power,
    toughness: token.toughness,
    colors: token.colors,
    cardTypes: token.cardTypes as CardType[],
    subTypes: token.subTypes,
    keywords: token.keywords,
    oracleText: token.oracleText ?? '',
    typeLine: token.typeLine,
    colorIdentity: token.colors,
    cmc: 0,
    isDoubleFaced: false,
    legalities: {},
  };
}

function parsedTokenToCardDefinition(token: NonNullable<ResolvedIntent['token']>): Partial<CardDefinition> & { name: string } {
  const colors = token.colors as ManaColor[];
  const subTypes = token.subTypes.filter(Boolean);
  const power = token.power ?? 1;
  const toughness = token.toughness ?? 1;
  const typeLine = token.typeLine
    ?? `Token Creature${subTypes.length ? ` - ${subTypes.join(' ')}` : ''}`;
  return {
    id: `custom-token-${token.name.toLowerCase().replace(/\s+/g, '-')}`,
    name: token.name,
    power: String(power),
    toughness: String(toughness),
    colors,
    cardTypes: (token.cardTypes as CardType[] | undefined) ?? ['Creature'],
    subTypes,
    keywords: token.keywords ?? [],
    oracleText: token.oracleText ?? '',
    typeLine,
    imageUrl: token.imageUrl,
    colorIdentity: colors,
    cmc: 0,
    isDoubleFaced: false,
    legalities: {},
  };
}

export function useNLPCommand(onCombatIntent?: (intent: ResolvedIntent) => void) {
  const store = useGameStore();

  /** Get autocomplete suggestions for a partial command string */
  const suggestions = useCallback((partial: string): string[] => {
    const { game, localPlayerId } = store;
    const base = getSuggestions(partial, game, localPlayerId);

    // Token shortcuts from battlefield cards
    const localPlayer = game.players.find(p => p.id === localPlayerId);
    if (localPlayer && partial.length >= 1) {
      const battlefieldNames = Object.values(game.cards)
        .filter(c => c.zone === 'battlefield' && c.controllerId === localPlayerId)
        .map(c => c.definition.name);
      const tokenSuggestions = getBattlefieldTokenSuggestions(battlefieldNames);
      for (const { cardName, entry } of tokenSuggestions) {
        if (entry.defaultCount === 0) continue;
        for (const tok of entry.tokens) {
          const cmd = `create ${entry.defaultCount === 1 ? '1' : entry.defaultCount} ${tok.subTypes[0]?.toLowerCase() || tok.name.toLowerCase()} token`;
          if (cmd.includes(partial.toLowerCase()) || cardName.toLowerCase().includes(partial.toLowerCase())) {
            if (!base.includes(cmd)) base.push(cmd);
          }
        }
      }
    }

    return base;
  }, [store]);

  /** Parse, resolve, and execute a raw command string */
  const execute = useCallback((raw: string): { success: boolean; message: string } => {
    const { game, localPlayerId } = store;
    const parsed = parseCommand(raw);
    const intent = resolveIntent(parsed, game, localPlayerId);

    // ── Combat intents — hand off to useCombatFlow ──
    if (
      intent.intent === 'MULTI_ATTACK' ||
      intent.intent === 'MULTI_BLOCK' ||
      intent.intent === 'ATTACK' ||
      intent.intent === 'BLOCK'
    ) {
      if (onCombatIntent) {
        onCombatIntent(intent);
        return { success: true, message: `Combat: ${raw}` };
      }
    }

    // ── All other intents ──
    switch (intent.intent) {
      case 'CAST': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? `Card not found: ${intent.cardName}` };
        const targetIds = [intent.targetPlayerId, intent.targetInstanceId].filter(Boolean) as string[];
        const playerTargetName = intent.targetPlayerId
          ? game.players.find(player => player.id === intent.targetPlayerId)?.name
          : undefined;
        const targetLabels = [playerTargetName ?? intent.targetText].filter(Boolean) as string[];
        store.castCard(localPlayerId, intent.resolvedInstanceId, targetIds.length || targetLabels.length ? {
          ids: targetIds.length ? targetIds : undefined,
          labels: targetLabels.length ? targetLabels : undefined,
        } : undefined);
        return { success: true, message: `Cast ${intent.cardName}${targetLabels.length ? ` targeting ${targetLabels.join(', ')}` : ''}` };
      }

      case 'PLAY_LAND': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? `Card not found: ${intent.cardName}` };
        store.playLand(localPlayerId, intent.resolvedInstanceId);
        return { success: true, message: `Played ${intent.cardName}` };
      }

      case 'TAP': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? `Card not found: ${intent.cardName}` };
        store.tapCard(intent.resolvedInstanceId);
        return { success: true, message: `Tapped ${intent.cardName}` };
      }

      case 'UNTAP': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? `Card not found: ${intent.cardName}` };
        store.untapCard(intent.resolvedInstanceId);
        return { success: true, message: `Untapped ${intent.cardName}` };
      }

      case 'TAP_ALL_LANDS': {
        store.tapAllLands(localPlayerId);
        return { success: true, message: 'Tapped all lands' };
      }

      case 'UNTAP_ALL': {
        store.untapAll(localPlayerId);
        return { success: true, message: 'Untapped all permanents' };
      }

      case 'DRAW': {
        store.drawCard(localPlayerId, intent.count ?? 1);
        return { success: true, message: `Drew ${intent.count ?? 1} card(s)` };
      }

      case 'DISCARD': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? `Card not found: ${intent.cardName}` };
        store.discardFromHand(localPlayerId, intent.resolvedInstanceId);
        return { success: true, message: `Discarded ${intent.cardName}` };
      }

      case 'SHUFFLE': {
        store.shuffleLibrary(localPlayerId);
        return { success: true, message: 'Shuffled library' };
      }

      case 'SORT_HAND': {
        store.sortHand(localPlayerId);
        return { success: true, message: 'Sorted hand by type, color, mana value, and name' };
      }

      case 'MILL': {
        store.millCards(localPlayerId, intent.count ?? 1);
        return { success: true, message: `Milled ${intent.count ?? 1} card(s)` };
      }

      case 'SCRY': {
        store.scryCards(localPlayerId, intent.count ?? 1);
        return { success: true, message: `Scry ${intent.count ?? 1} — library drawer opened` };
      }

      case 'SURVEIL': {
        store.surveilCards(localPlayerId, intent.count ?? 1);
        return { success: true, message: `Surveil ${intent.count ?? 1} — library drawer opened` };
      }

      case 'PROLIFERATE': {
        store.proliferate(localPlayerId);
        return { success: true, message: 'Proliferated all eligible counters' };
      }

      case 'CYCLE': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? `Card not found: ${intent.cardName}` };
        store.cycleCard(localPlayerId, intent.resolvedInstanceId);
        return { success: true, message: `Cycled ${intent.cardName} — drew 1` };
      }

      case 'DREDGE': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? `"${intent.cardName}" not found in graveyard` };
        const ok = store.dredgeCard(localPlayerId, intent.resolvedInstanceId);
        return { success: ok, message: ok ? `Dredged ${intent.cardName} instead of drawing` : `Could not dredge ${intent.cardName}` };
      }

      case 'CAST_FROM_GY': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? `"${intent.cardName}" not found in graveyard` };
        store.castFromZone(localPlayerId, intent.resolvedInstanceId, 'graveyard');
        return { success: true, message: `Cast ${intent.cardName} from graveyard` };
      }

      case 'CAST_FROM_EXILE': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? `"${intent.cardName}" not found in exile` };
        store.castFromZone(localPlayerId, intent.resolvedInstanceId, 'exile');
        return { success: true, message: `Cast ${intent.cardName} from exile` };
      }

      case 'REANIMATE': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? `"${intent.cardName}" not found in graveyard/exile` };
        store.reanimateCard(intent.resolvedInstanceId, localPlayerId);
        return { success: true, message: `Reanimated ${intent.cardName}` };
      }

      case 'LOOK_AT_HAND': {
        const targetId = intent.targetPlayerId ?? localPlayerId;
        store.openZoneDrawer('hand', targetId);
        return { success: true, message: `Looking at player ${intent.targetPlayerIndex}'s hand` };
      }

      case 'LOOK_AT_TOP': {
        const targetId = intent.targetPlayerId ?? localPlayerId;
        store.lookAtTopCards(targetId, intent.count ?? 1, localPlayerId);
        return { success: true, message: `Looking at top of library` };
      }

      case 'ADD_COUNTER': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? 'Card not found' };
        store.addCounterToCard(intent.resolvedInstanceId, intent.counterType ?? '+1/+1', intent.counterAmount ?? 1);
        return { success: true, message: `Added ${intent.counterAmount ?? 1} ${intent.counterType ?? '+1/+1'} to ${intent.cardName}` };
      }

      case 'REMOVE_COUNTER': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? 'Card not found' };
        store.removeCounterFromCard(intent.resolvedInstanceId, intent.counterType ?? '+1/+1', intent.counterAmount ?? 1);
        return { success: true, message: `Removed counter from ${intent.cardName}` };
      }

      case 'LIFE_CHANGE': {
        const targetId = intent.targetPlayerId ?? localPlayerId;
        store.modifyPlayerLife(targetId, intent.delta ?? 0);
        const sign = (intent.delta ?? 0) > 0 ? '+' : '';
        return { success: true, message: `Life ${sign}${intent.delta}` };
      }

      case 'POISON': {
        const targetId = intent.targetPlayerId ?? localPlayerId;
        store.addPoisonCounter(targetId, intent.count ?? 1);
        return { success: true, message: `Added ${intent.count ?? 1} poison counter(s)` };
      }

      case 'PASS_PRIORITY': {
        store.passPriority();
        return { success: true, message: 'Priority passed' };
      }

      case 'GO_TO_PHASE': {
        if (!intent.phase) return { success: false, message: 'Unknown phase' };
        store.goToPhase(intent.phase);
        return { success: true, message: `Moved to ${intent.phase}` };
      }

      case 'END_TURN': {
        store.advanceTurn();
        return { success: true, message: 'Turn ended' };
      }

      case 'ENTER_COMBAT': {
        store.enterCombat();
        return { success: true, message: 'Entering combat' };
      }

      case 'END_COMBAT': {
        store.endCombat();
        return { success: true, message: 'Combat ended' };
      }

      case 'RESOLVE_STACK': {
        store.resolveStack();
        return { success: true, message: 'Top of stack resolved' };
      }

      case 'COUNTER_SPELL': {
        const stackObj = game.stack.find(s =>
          s.sourceName.toLowerCase().includes((intent.cardName ?? '').toLowerCase())
        );
        if (!stackObj) return { success: false, message: `${intent.cardName} not found on stack` };
        store.counterSpell(stackObj.id);
        return { success: true, message: `Countered ${stackObj.sourceName}` };
      }

      case 'MOVE_CARD': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? 'Card not found' };
        store.moveCardToZone(intent.resolvedInstanceId, intent.toZone ?? 'graveyard');
        return { success: true, message: `Moved ${intent.cardName} to ${intent.toZone}` };
      }

      case 'TRANSFORM': {
        if (!intent.resolvedInstanceId) return { success: false, message: intent.error ?? 'Card not found' };
        store.transformCard(intent.resolvedInstanceId);
        return { success: true, message: `Transformed ${intent.cardName}` };
      }

      case 'CREATE_TOKEN': {
        if (!intent.token) return { success: false, message: 'Token definition incomplete' };
        const count = intent.token.count ?? 1;
        const lookupQuery = intent.token.lookupQuery ?? intent.token.name;
        if (intent.token.preferScryfall) {
          store.addAssistantMessage({
            severity: 'info',
            label: 'Info',
            text: `Searching Scryfall for "${lookupQuery}" token data...`,
          });
          void fetchScryfallTokenDefinition(lookupQuery).then(definition => {
            const localToken = getTokenDefinitionByName(lookupQuery);
            const tokenDef = definition ?? (localToken ? tokenDefToCardDefinition(localToken) : parsedTokenToCardDefinition(intent.token!));
            store.createTokenCards(localPlayerId, tokenDef, count);
            store.addAssistantMessage({
              severity: definition ? 'info' : 'warning',
              label: definition ? 'Info' : 'Needs Review',
              text: definition
                ? `Created ${count} ${definition.name} token${count === 1 ? '' : 's'} using Scryfall data.`
                : localToken
                  ? `Scryfall lookup missed "${lookupQuery}", so On-Da-Stack used the local token template.`
                  : `Scryfall lookup missed "${lookupQuery}", so On-Da-Stack created a custom 1/1 token you can adjust on the battlefield.`,
            });
          });
          return { success: true, message: `Searching Scryfall for ${lookupQuery} token...` };
        }
        const localToken = getTokenDefinitionByName(lookupQuery);
        store.createTokenCards(localPlayerId, localToken ? tokenDefToCardDefinition(localToken) : parsedTokenToCardDefinition(intent.token), count);
        return { success: true, message: `Created ${count} ${intent.token.name} token(s)` };
      }

      case 'FLIP_COIN': {
        const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
        store.addAssistantMessage({ severity: 'info', label: 'Info', text: `Coin flip: ${result}` });
        return { success: true, message: `Coin flip: ${result}` };
      }

      case 'ROLL_DICE': {
        const sides = intent.diceSize ?? 6;
        const roll = Math.floor(Math.random() * sides) + 1;
        store.addAssistantMessage({ severity: 'info', label: 'Info', text: `d${sides} roll: ${roll}` });
        return { success: true, message: `d${sides}: ${roll}` };
      }

      case 'UNDO': {
        store.undo();
        return { success: true, message: 'Action undone' };
      }

      case 'UNKNOWN':
      default: {
        // Last-chance: try token shortcut from registry
        // e.g. "activate krenko", "create token from smothering tithe", "make goblin token"
        const tokenShortcut = resolveTokenShortcut(raw);
        if (tokenShortcut) {
          const { entry, count } = tokenShortcut;
          for (const tok of entry.tokens) {
            store.createTokenCards(localPlayerId, tokenDefToCardDefinition(tok), count);
          }
          const names = entry.tokens.map(t => t.name).join(', ');
          return { success: true, message: `Created ${count}× ${names} token(s)` };
        }
        return { success: false, message: `Unknown command: "${raw}"` };
      }
    }
  }, [store, onCombatIntent]);

  return { execute, suggestions };
}
