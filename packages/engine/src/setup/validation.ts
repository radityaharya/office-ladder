import type {
  GameSetup,
  SetupContent,
  SetupEngineError,
  SetupErrorCode,
  SetupModeContent,
  SetupResult,
} from "./types";

const PLAYER_COUNT_RANGE = { minimum: 3, maximum: 6 } as const;

function createSetupError(
  code: SetupErrorCode,
  message: string,
  setup: GameSetup,
  details: SetupEngineError["details"],
): SetupResult {
  return {
    ok: false,
    error: {
      name: "EngineError",
      code,
      message,
      recoverable: true,
      gameId: setup.gameId,
      commandId: null,
      actorId: null,
      decisionPointId: null,
      frameId: null,
      details,
    },
  };
}

function hasDuplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export function validateSetup(
  setup: GameSetup,
  content: SetupContent,
): SetupResult | SetupModeContent {
  if (
    setup.players.length < PLAYER_COUNT_RANGE.minimum ||
    setup.players.length > PLAYER_COUNT_RANGE.maximum
  ) {
    return createSetupError(
      "INVALID_PLAYER_COUNT",
      "A game requires between three and six players.",
      setup,
      { minimum: PLAYER_COUNT_RANGE.minimum, maximum: PLAYER_COUNT_RANGE.maximum },
    );
  }

  const playerIds = setup.players.map((player) => player.id);
  if (hasDuplicate(playerIds)) {
    return createSetupError(
      "DUPLICATE_PLAYER_ID",
      "Player IDs must be unique.",
      setup,
      {},
    );
  }

  const characterIds = setup.players.map((player) => player.characterId);
  if (hasDuplicate(characterIds)) {
    return createSetupError(
      "DUPLICATE_CHARACTER_ID",
      "Character IDs must be unique.",
      setup,
      {},
    );
  }

  const ordersMatchInput = setup.players.every(
    (player, index) => player.order === index,
  );
  if (!ordersMatchInput) {
    return createSetupError(
      "INVALID_PLAYER_ORDER",
      "Player order must be contiguous and match input order.",
      setup,
      {},
    );
  }

  if (!playerIds.includes(setup.authorizedStarterId)) {
    return createSetupError(
      "AUTHORIZED_STARTER_NOT_FOUND",
      "The authorized starter must be one of the setup players.",
      setup,
      {},
    );
  }

  const mode = content.modes[setup.modeId];
  if (mode === undefined) {
    return createSetupError(
      "UNSUPPORTED_MODE",
      "The selected mode is not provided by this content release.",
      setup,
      { modeId: setup.modeId },
    );
  }

  if (content.board.spaces.length !== 44) {
    return createSetupError(
      "INVALID_CONTENT",
      "Deadline Dash content must define exactly 44 board spaces.",
      setup,
      { boardSize: content.board.spaces.length },
    );
  }

  const contentCharacterIds = Object.keys(content.characters);
  if (
    !characterIds.every((characterId) => contentCharacterIds.includes(characterId))
  ) {
    return createSetupError(
      "INVALID_CONTENT",
      "Every player character must exist in the selected content release.",
      setup,
      {},
    );
  }

  const internRank = content.ranks.find((rank) => rank.id === "rank.intern");
  if (internRank === undefined || internRank.tier !== 1) {
    return createSetupError(
      "INVALID_CONTENT",
      "Content must define Intern as the first rank.",
      setup,
      {},
    );
  }

  const rulesError = validateModeRules(setup, content, mode);
  if (rulesError !== null) {
    return rulesError;
  }

  return mode;
}

/**
 * Guards the parts of `ModeRules` that `createGame` itself depends on, plus the
 * one invariant the spec states as a hard requirement (`winPaths` not all false).
 *
 * Deliberately not a full re-validation of the ruleset: a lobby-authored custom
 * mode is untrusted input and is bounds-checked by `@office-ladder/contracts`
 * before it ever reaches the engine (spec §8.4). What is checked here is only
 * what would otherwise let setup produce nonsense canonical state — a quarter
 * schedule that cannot be laid out, an unwinnable match, or an upkeep ladder that
 * cannot be indexed by rank.
 */
function validateModeRules(
  setup: GameSetup,
  content: SetupContent,
  mode: SetupModeContent,
): SetupResult | null {
  const { rules } = mode;
  const { winPaths, quarters, economy } = rules;

  if (
    !winPaths.promotion &&
    !winPaths.wealth &&
    !winPaths.influence &&
    !winPaths.survival
  ) {
    return createSetupError(
      "INVALID_MODE_RULES",
      "At least one win path must be enabled or the match is unwinnable.",
      setup,
      { modeId: setup.modeId },
    );
  }

  if (quarters.enabled && (quarters.count < 1 || quarters.roundsEach < 1)) {
    return createSetupError(
      "INVALID_MODE_RULES",
      "Enabled quarters require a positive count and rounds-per-quarter.",
      setup,
      { count: quarters.count, roundsEach: quarters.roundsEach },
    );
  }

  if (
    economy.upkeepEnabled &&
    economy.upkeepByRankIndex.length !== content.ranks.length
  ) {
    return createSetupError(
      "INVALID_MODE_RULES",
      "The upkeep ladder must declare one charge per rank.",
      setup,
      {
        upkeepEntries: economy.upkeepByRankIndex.length,
        rankCount: content.ranks.length,
      },
    );
  }

  return null;
}
