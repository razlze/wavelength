import type { RoomStatus, RoundStatus } from "../../generated/prisma/enums";
export type { RoomStatus, RoundStatus };

export type PublicPlayer = {
  id: string;
  nickname: string;
  isLeader: boolean;
  online: boolean;
  /** Sum of team round scores from rounds where this player was scored as a guesser. */
  totalScore: number;
};

export type ThemePayload =
  | { kind: "custom"; left: string; right: string; clue?: string }
  | { kind: "preset"; presetId: string };

export type RoomStatePayload = {
  /** Monotonic per-room state sequence; guards against stale room:state delivery. */
  roomStateSeq: number;
  room: { id: string; code: string; status: RoomStatus };
  players: PublicPlayer[];
  /**
   * Turn rotation order (runtime), oldest-first shuffle from game start.
   * Only set after the game has left the lobby; null in lobby.
   */
  playerOrder: string[] | null;
  meId: string;
  round: null | {
    id: string;
    roundNumber: number;
    status: RoundStatus;
    psychicId: string | null;
    /** Only for psychic during theme / guessing prep */
    targetPosition?: number;
    theme: null | {
      left: string;
      right: string;
      clue?: string;
    };
    teamNeedle: number;
    /** Monotonic sequence for teamNeedle updates (guards against reordering) */
    needleSeq: number;
    /** If non-null, this player currently has exclusive control over the needle. */
    needleDominionPlayerId: string | null;
    /** Monotonic sequence for needleDominion updates (guards against reordering). */
    needleDominionSeq: number;
    lockedIds: string[];
    /** After reveal */
    reveal?: {
      target: number;
      teamGuess: number;
      score: number;
    };
  };
  psychicCandidateId: string | null;
  presets: { id: string; leftLabel: string; rightLabel: string }[];
};

export type RoomRuntime = {
  playerOrder: string[];
  /** Index in playerOrder for current round's psychic rotation base */
  psychicBaseIndex: number;
  /** Offset during skip cycle within selecting_psychic */
  candidateSkipOffset: number;
  teamNeedle: number;
  needleSeq: number;
  needleDominionPlayerId: string | null;
  needleDominionSeq: number;
  lockedGuessers: Set<string>;
  socketByPlayer: Map<string, string>;
  /** Monotonic per-room sequence for full room:state payload broadcasts. */
  roomStateSeq: number;
  countdownTimer: ReturnType<typeof setTimeout> | null;
};
