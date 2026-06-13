import type {
  ActionRecord,
  CardState,
  Deck,
  GameState,
  Player,
  SoloPerformanceReport,
  SoloTestSession,
} from '../types/game';
import { analyzeOpeningHand } from './openingHand';

export interface GenerateSoloPerformanceReportOptions {
  deck?: Deck;
  session?: SoloTestSession;
  testedPlayerId?: string;
  sessionType?: SoloPerformanceReport['sessionType'];
  now?: number;
}

const BOARD_PERMANENT_TYPES = new Set(['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle']);
const CAST_TYPES = new Set(['CAST', 'CAST_SPELL', 'PUT_ON_STACK', 'RESOLVE_STACK', 'REANIMATE']);

export function generateSoloPerformanceReport(
  game: GameState,
  actionLog: ActionRecord[] = game.actionLog,
  options: GenerateSoloPerformanceReportOptions = {},
): SoloPerformanceReport {
  const now = options.now ?? Date.now();
  const actions = actionLog.filter(action => !action.undone);
  const testedPlayer = getTestedPlayer(game, options.testedPlayerId);
  const dummyPlayers = game.players.filter(player => player.isDummy);
  const sessionType = options.sessionType ?? (options.session?.mode === 'dummy' || dummyPlayers.length > 0 ? 'dummy' : 'goldfish');
  const turnsPlayed = getTurnsPlayed(game, actions);
  const warnings: string[] = [];
  if (actions.length === 0) warnings.push('No action log entries were available, so some timing metrics are inferred from current state.');
  if (!testedPlayer) warnings.push('No tested solo player was found.');

  const openingHand = getOpeningHandSummary(options.deck, options.session, warnings);
  const testedActions = testedPlayer ? actions.filter(action => action.playerId === testedPlayer.id) : [];
  const landDropTurns = getLandDropTurns(testedActions, game.cards);
  const manaDevelopment = {
    landsPlayed: landDropTurns.length,
    turnsMissedLandDrop: getMissedLandDropTurns(turnsPlayed, landDropTurns),
    firstThreeTurnsLandDrops: landDropTurns.filter(turn => turn >= 1 && turn <= 3).length,
  };
  const boardDevelopment = getBoardDevelopment(testedActions, game.cards);
  const combat = getCombatSummary(game, actions, testedPlayer, dummyPlayers);
  const cardFlow = getCardFlow(game, testedActions, testedPlayer);
  const dummy = sessionType === 'dummy'
    ? getDummySummary(game, actions, testedPlayer, dummyPlayers, options.session, turnsPlayed, combat.totalDamageTaken)
    : undefined;
  const suggestions = getSuggestions({
    openingHand,
    manaDevelopment,
    boardDevelopment,
    cardFlow,
    dummy,
    turnsPlayed,
    turnOfLethal: combat.turnOfLethal,
  });

  return {
    id: `solo-report-${game.id}-${now}`,
    deckId: options.deck?.id ?? options.session?.deckId ?? testedPlayer?.deckId,
    deckName: options.deck?.name,
    sessionType,
    generatedAt: now,
    turnsPlayed,
    actionsCount: actions.length,
    openingHand,
    manaDevelopment,
    boardDevelopment,
    combat,
    cardFlow,
    dummy,
    warnings,
    suggestions,
  };
}

export function serializeSoloPerformanceReport(report: SoloPerformanceReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatSoloPerformanceReportText(report: SoloPerformanceReport): string {
  const lines = [
    `Solo Performance Report: ${report.deckName ?? report.deckId ?? 'Untitled deck'}`,
    `Session: ${report.sessionType}`,
    `Turns: ${report.turnsPlayed}`,
    `Actions: ${report.actionsCount}`,
    `Lands played: ${report.manaDevelopment.landsPlayed}`,
    `Damage dealt: ${report.combat.totalDamageDealt}`,
    `Damage taken: ${report.combat.totalDamageTaken}`,
    `Cards drawn: ${report.cardFlow.cardsDrawn}`,
  ];
  if (report.openingHand) {
    lines.push(`Opening hand: ${report.openingHand.landCount} land, ${report.openingHand.nonlandCount} nonland`);
  }
  if (report.suggestions.length > 0) {
    lines.push('Suggestions:');
    lines.push(...report.suggestions.map(suggestion => `- ${suggestion}`));
  }
  if (report.warnings.length > 0) {
    lines.push('Warnings:');
    lines.push(...report.warnings.map(warning => `- ${warning}`));
  }
  return lines.join('\n');
}

function getTestedPlayer(game: GameState, testedPlayerId?: string): Player | undefined {
  if (testedPlayerId) {
    const exact = game.players.find(player => player.id === testedPlayerId);
    if (exact) return exact;
  }
  return game.players.find(player => !player.isDummy) ?? game.players[0];
}

function getTurnsPlayed(game: GameState, actions: ActionRecord[]): number {
  return Math.max(
    0,
    game.turn,
    ...actions
      .map(action => action.turn)
      .filter(turn => Number.isFinite(turn)),
  );
}

function getOpeningHandSummary(
  deck: Deck | undefined,
  session: SoloTestSession | undefined,
  warnings: string[],
): SoloPerformanceReport['openingHand'] {
  if (!session?.currentHand?.length) {
    warnings.push('Opening hand data is unavailable for this session.');
    return undefined;
  }
  if (!deck) {
    warnings.push('Opening hand card names are available, but deck metadata is missing.');
    const landCount = session.currentHand.filter(card => isBasicLandName(card.name)).length;
    return {
      landCount,
      nonlandCount: session.currentHand.length - landCount,
      mulligansTaken: session.mulligansTaken ?? 0,
      keptHandSize: Math.max(0, session.currentHand.length - (session.cardsToBottom?.length ?? 0)),
    };
  }
  const stats = analyzeOpeningHand(deck, session.currentHand);
  return {
    landCount: stats.landCount,
    nonlandCount: stats.nonlandCount,
    averageManaValue: stats.averageManaValue,
    mulligansTaken: session.mulligansTaken ?? 0,
    keptHandSize: Math.max(0, session.currentHand.length - (session.cardsToBottom?.length ?? 0)),
  };
}

function getLandDropTurns(actions: ActionRecord[], cards: Record<string, CardState>): number[] {
  const turns = new Set<number>();
  for (const action of actions) {
    if (!isLandPlayAction(action, cards)) continue;
    turns.add(action.turn);
  }
  return [...turns].sort((a, b) => a - b);
}

function isLandPlayAction(action: ActionRecord, cards: Record<string, CardState>): boolean {
  const text = action.description.toLowerCase();
  if (action.data?.kind === 'playLand') return true;
  if (action.actionType !== 'MOVE_CARD' && action.actionType !== 'OTHER') return false;
  if (text.includes('played as land') || text.includes('played a land')) return true;
  return action.affectedObjects.some(id => cards[id]?.definition.cardTypes.includes('Land'));
}

function getMissedLandDropTurns(turnsPlayed: number, landDropTurns: number[]): number[] {
  const landed = new Set(landDropTurns);
  const result: number[] = [];
  for (let turn = 1; turn <= Math.max(0, turnsPlayed); turn += 1) {
    if (!landed.has(turn)) result.push(turn);
  }
  return result;
}

function getBoardDevelopment(
  actions: ActionRecord[],
  cards: Record<string, CardState>,
): SoloPerformanceReport['boardDevelopment'] {
  let firstPermanentTurn: number | undefined;
  let firstCreatureTurn: number | undefined;
  let creaturesPlayed = 0;
  let noncreatureSpellsPlayed = 0;
  let tokensCreated = 0;

  for (const action of actions) {
    const affectedCards = action.affectedObjects.map(id => cards[id]).filter((card): card is CardState => Boolean(card));
    if (action.actionType === 'ADD_TOKEN' || action.data?.kind === 'createToken') {
      tokensCreated += getTokenCountFromAction(action, affectedCards);
    }
    if (!isCastOrBoardAction(action)) continue;

    const creatureCards = affectedCards.filter(card => card.definition.cardTypes.includes('Creature'));
    const boardPermanentCards = affectedCards.filter(isBoardPermanent);
    const spellCards = affectedCards.filter(card => !card.definition.cardTypes.includes('Land'));
    if (boardPermanentCards.length > 0 && firstPermanentTurn === undefined) firstPermanentTurn = action.turn;
    if (creatureCards.length > 0 && firstCreatureTurn === undefined) firstCreatureTurn = action.turn;
    creaturesPlayed += creatureCards.length;
    noncreatureSpellsPlayed += spellCards.filter(card => !card.definition.cardTypes.includes('Creature')).length;
  }

  return {
    firstPermanentTurn,
    firstCreatureTurn,
    creaturesPlayed,
    noncreatureSpellsPlayed,
    tokensCreated,
  };
}

function isBoardPermanent(card: CardState): boolean {
  return card.definition.cardTypes.some(type => BOARD_PERMANENT_TYPES.has(type));
}

function isCastOrBoardAction(action: ActionRecord): boolean {
  if (CAST_TYPES.has(action.actionType)) return true;
  if (action.actionType === 'MOVE_CARD') return /played|cast|reanimated|battlefield/i.test(action.description);
  if (action.actionType === 'OTHER') return /cast|created|adds? .*permanent/i.test(action.description);
  return false;
}

function getTokenCountFromAction(action: ActionRecord, affectedCards: CardState[]): number {
  const explicit = getNumericValue(action.data?.tokenCount) ?? getNumericValue(action.data?.count);
  if (explicit !== undefined) return explicit;
  const tokenAffected = affectedCards.filter(card => card.token).length;
  if (tokenAffected > 0) return tokenAffected;
  const match = action.description.match(/created\s+(\d+)/i);
  return match ? Number(match[1]) : action.affectedObjects.length;
}

function getCombatSummary(
  game: GameState,
  actions: ActionRecord[],
  testedPlayer: Player | undefined,
  dummyPlayers: Player[],
): SoloPerformanceReport['combat'] {
  const opponents = testedPlayer ? game.players.filter(player => player.id !== testedPlayer.id) : [];
  const finalDamageDealt = opponents.reduce((sum, opponent) => {
    const startingLife = getStartingLife(game, opponent);
    return sum + Math.max(0, startingLife - opponent.life);
  }, 0);
  const finalDamageTaken = testedPlayer ? Math.max(0, getStartingLife(game, testedPlayer) - testedPlayer.life) : 0;
  const fallbackDamage = getLifeActionDamage(actions, testedPlayer?.id);
  const attacks = testedPlayer ? actions.filter(action => action.playerId === testedPlayer.id && isAttackAction(action)) : [];
  const blocks = actions.filter(isBlockAction);
  const lethalOpponent = opponents.find(opponent => opponent.life <= 0);

  return {
    totalDamageDealt: finalDamageDealt > 0 ? finalDamageDealt : fallbackDamage.dealt,
    totalDamageTaken: finalDamageTaken > 0 ? finalDamageTaken : fallbackDamage.taken,
    turnOfFirstAttack: attacks[0]?.turn,
    turnOfLethal: lethalOpponent ? game.turn : undefined,
    attacksDeclared: attacks.length,
    blockersDeclared: blocks.length,
  };
}

function getStartingLife(game: GameState, player: Player): number {
  return player.dummyConfig?.startingLife ?? game.config.startingLife;
}

function getLifeActionDamage(actions: ActionRecord[], testedPlayerId?: string): { dealt: number; taken: number } {
  let dealt = 0;
  let taken = 0;
  for (const action of actions) {
    if (action.actionType !== 'CHANGE_LIFE' && action.actionType !== 'COMMANDER_DAMAGE') continue;
    const delta = getLifeDelta(action);
    if (delta === undefined || delta >= 0) continue;
    if (testedPlayerId && action.playerId === testedPlayerId) taken += Math.abs(delta);
    else dealt += Math.abs(delta);
  }
  return { dealt, taken };
}

function getLifeDelta(action: ActionRecord): number | undefined {
  const dataDelta = getNumericValue(action.data?.delta) ?? getNumericValue(action.data?.lifeDelta);
  if (dataDelta !== undefined) return dataDelta;
  const match = action.description.match(/life\s+([+-]\d+)/i) ?? action.description.match(/([+-]\d+)\s+life/i);
  return match ? Number(match[1]) : undefined;
}

function isAttackAction(action: ActionRecord): boolean {
  const text = action.description.toLowerCase();
  return action.actionType === 'DECLARE_ATTACKER' || /\battacks?\b|\battacked\b/.test(text);
}

function isBlockAction(action: ActionRecord): boolean {
  const text = action.description.toLowerCase();
  return action.actionType === 'DECLARE_BLOCKER' || /\bblocks?\b|\bblocked\b/.test(text);
}

function getCardFlow(
  game: GameState,
  actions: ActionRecord[],
  testedPlayer: Player | undefined,
): SoloPerformanceReport['cardFlow'] {
  return {
    cardsDrawn: actions.filter(action => action.actionType === 'DRAW_CARD' || /\bdrew\b|\bdraw\b/i.test(action.description))
      .reduce((sum, action) => sum + (getActionCount(action) ?? 1), 0),
    cardsDiscarded: actions.filter(action => action.actionType === 'DISCARD' || /\bdiscard/i.test(action.description))
      .reduce((sum, action) => sum + Math.max(1, action.affectedObjects.length), 0),
    cardsTutoredOrSearched: actions.filter(action =>
      action.actionType === 'TUTOR' ||
      action.actionType === 'SEARCH_LIBRARY' ||
      /\btutor\b|\bsearch/i.test(action.description)
    ).length,
    cardsInHandAtEnd: testedPlayer ? testedPlayer.hand.length : 0,
  };
}

function getActionCount(action: ActionRecord): number | undefined {
  return getNumericValue(action.data?.count) ??
    getNumericValue(action.data?.amount) ??
    getNumericValue(action.data?.requestedCount) ??
    getNumericValue(action.description.match(/(\d+)\s+cards?/i)?.[1]);
}

function getDummySummary(
  game: GameState,
  actions: ActionRecord[],
  testedPlayer: Player | undefined,
  dummyPlayers: Player[],
  session: SoloTestSession | undefined,
  turnsPlayed: number,
  pressureTaken: number,
): SoloPerformanceReport['dummy'] {
  const dummyPlayer = dummyPlayers[0];
  const config = dummyPlayer?.dummyConfig ?? session?.dummyOpponents?.[0];
  return {
    profile: dummyPlayer?.dummyProfile ?? config?.profile,
    archetype: config?.dummyDeckArchetype,
    pressureTaken,
    survivedToTurn: testedPlayer && testedPlayer.life > 0 ? turnsPlayed : undefined,
    comboClockTurn: config?.comboTurn,
    dummyActionsCount: actions.filter(action => action.data?.dummyAction === true).length,
  };
}

function getSuggestions(input: {
  openingHand?: SoloPerformanceReport['openingHand'];
  manaDevelopment: SoloPerformanceReport['manaDevelopment'];
  boardDevelopment: SoloPerformanceReport['boardDevelopment'];
  cardFlow: SoloPerformanceReport['cardFlow'];
  dummy?: SoloPerformanceReport['dummy'];
  turnsPlayed: number;
  turnOfLethal?: number;
}): string[] {
  const suggestions: string[] = [];
  if (input.manaDevelopment.firstThreeTurnsLandDrops < 2) {
    suggestions.push('Opening mana may be inconsistent.');
  }
  if ((input.openingHand?.averageManaValue ?? 0) >= 3.5) {
    suggestions.push('Opening hand may be slow.');
  }
  const firstBoardTurn = Math.min(
    input.boardDevelopment.firstPermanentTurn ?? Number.POSITIVE_INFINITY,
    input.boardDevelopment.firstCreatureTurn ?? Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(firstBoardTurn) || firstBoardTurn > 3) {
    suggestions.push('Early board presence may be light.');
  }
  if (input.manaDevelopment.turnsMissedLandDrop.length >= 2) {
    suggestions.push('Consider reviewing land count or ramp.');
  }
  if (
    input.dummy?.comboClockTurn &&
    input.turnsPlayed >= input.dummy.comboClockTurn &&
    (!input.turnOfLethal || input.turnOfLethal > input.dummy.comboClockTurn)
  ) {
    suggestions.push('Deck may need faster pressure or interaction.');
  }
  const boardActions = input.boardDevelopment.creaturesPlayed +
    input.boardDevelopment.noncreatureSpellsPlayed +
    input.boardDevelopment.tokensCreated;
  if (input.turnsPlayed >= 3 && input.cardFlow.cardsInHandAtEnd >= 6 && boardActions < 2) {
    suggestions.push('Deck may have too many expensive or situational cards.');
  }
  return [...new Set(suggestions)];
}

function getNumericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function isBasicLandName(name: string): boolean {
  return /^(plains|island|swamp|mountain|forest|wastes)$/i.test(name.trim());
}
