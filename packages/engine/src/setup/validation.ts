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

  return mode;
}
