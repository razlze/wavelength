import { prisma } from "@/lib/prisma";
import type { RoomRuntime, RoomStatePayload, ThemePayload } from "./types";
import { shuffle, wavelengthScore } from "./scoring";

const runtimes = new Map<string, RoomRuntime>();

function getRuntime(roomId: string): RoomRuntime | undefined {
  return runtimes.get(roomId);
}

function ensureRuntime(roomId: string): RoomRuntime {
  let r = runtimes.get(roomId);
  if (!r) {
    r = {
      playerOrder: [],
      psychicBaseIndex: 0,
      candidateSkipOffset: 0,
      teamNeedle: 0.5,
      submittedGuessers: new Set(),
      socketByPlayer: new Map(),
    };
    runtimes.set(roomId, r);
  }
  return r;
}

function deleteRuntime(roomId: string) {
  runtimes.delete(roomId);
}

export async function seedThemePresetsIfEmpty() {
  const count = await prisma.themePreset.count();
  if (count > 0) return;
  const pairs: [string, string][] = [
    ["Hot", "Cold"],
    ["Easy", "Hard"],
    ["Good movie", "Bad movie"],
    ["Useful invention", "Useless invention"],
    ["Everyone loves it", "Nobody likes it"],
    ["Low tech", "High tech"],
    ["Underrated", "Overrated"],
  ];
  await prisma.themePreset.createMany({
    data: pairs.map(([leftLabel, rightLabel]) => ({ leftLabel, rightLabel })),
  });
}

async function listPresets() {
  return prisma.themePreset.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, leftLabel: true, rightLabel: true },
  });
}

function activePlayersWhere() {
  return { leftAt: null as null };
}

export async function getActivePlayerIds(roomId: string): Promise<string[]> {
  const players = await prisma.player.findMany({
    where: { roomId, ...activePlayersWhere() },
    orderBy: { joinedAt: "asc" },
    select: { id: true },
  });
  return players.map((p) => p.id);
}

function currentPsychicCandidateId(rt: RoomRuntime): string | null {
  const n = rt.playerOrder.length;
  if (n === 0) return null;
  const idx = (rt.psychicBaseIndex + rt.candidateSkipOffset) % n;
  return rt.playerOrder[idx] ?? null;
}

export async function buildRoomState(
  roomId: string,
  meId: string
): Promise<RoomStatePayload | null> {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      players: {
        where: activePlayersWhere(),
        orderBy: { joinedAt: "asc" },
      },
    },
  });
  if (!room) return null;

  const rt = getRuntime(roomId);
  const presets = await listPresets();

  const round = await prisma.round.findFirst({
    where: { roomId },
    orderBy: { roundNumber: "desc" },
    include: { guesses: true, themePreset: true },
  });

  const online = new Set(rt?.socketByPlayer.keys() ?? []);
  const players = room.players.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    isLeader: p.isLeader,
    online: online.has(p.id),
  }));

  let roundPayload: RoomStatePayload["round"] = null;
  let psychicCandidateId: string | null = null;

  if (round) {
    if (round.status === "selecting_psychic" && rt) {
      psychicCandidateId = currentPsychicCandidateId(rt);
    }

    const isPsychic = round.psychicPlayerId === meId;
    let theme: { left: string; right: string; clue?: string } | null = null;

    if (round.status !== "selecting_psychic") {
      if (round.themePresetId && round.themePreset) {
        theme = {
          left: round.themePreset.leftLabel,
          right: round.themePreset.rightLabel,
        };
      } else if (round.themeCustom) {
        try {
          const j = JSON.parse(round.themeCustom) as {
            left?: string;
            right?: string;
            clue?: string;
          };
          if (j.left && j.right) {
            theme = { left: j.left, right: j.right, clue: j.clue };
          }
        } catch {
          theme = { left: "?", right: "?" };
        }
      }
    }

    const guesserIds = room.players
      .filter((p) => p.id !== round.psychicPlayerId)
      .map((p) => p.id);
    const submittedIds =
      round.status === "guessing" || round.status === "psychic_setting_theme"
        ? Array.from(rt?.submittedGuessers ?? [])
        : round.guesses.map((g) => g.playerId);

    roundPayload = {
      id: round.id,
      roundNumber: round.roundNumber,
      status: round.status,
      psychicId: round.psychicPlayerId,
      targetPosition:
        isPsychic &&
        (round.status === "psychic_setting_theme" || round.status === "guessing")
          ? (round.targetPosition ?? undefined)
          : undefined,
      theme:
        round.status === "psychic_setting_theme" && !isPsychic
          ? null
          : round.status === "selecting_psychic"
            ? null
            : theme,
      teamNeedle: rt?.teamNeedle ?? 0.5,
      submittedIds,
      reveal:
        round.status === "revealed" || round.status === "complete"
          ? {
              target: round.targetPosition ?? 0,
              teamGuess: round.finalTeamGuess ?? 0,
              score: round.score ?? 0,
            }
          : undefined,
    };
  }

  return {
    room: { id: room.id, code: room.code, status: room.status },
    players,
    meId,
    round: roundPayload,
    psychicCandidateId,
    presets,
  };
}

export function registerSocket(roomId: string, playerId: string, socketId: string) {
  const rt = ensureRuntime(roomId);
  rt.socketByPlayer.set(playerId, socketId);
}

export function unregisterSocket(socketId: string): {
  roomId: string;
  playerId: string;
} | null {
  for (const [roomId, rt] of runtimes) {
    for (const [pid, sid] of rt.socketByPlayer) {
      if (sid === socketId) {
        rt.socketByPlayer.delete(pid);
        return { roomId, playerId: pid };
      }
    }
  }
  return null;
}

export async function startGame(roomId: string, leaderId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: { players: { where: activePlayersWhere() } },
  });
  if (!room || room.leaderPlayerId !== leaderId) {
    throw new Error("Only the leader can start the game");
  }
  if (room.players.length < 2) {
    throw new Error("Need at least two players");
  }
  if (room.status !== "lobby") {
    throw new Error("Game already started");
  }

  const ids = room.players.map((p) => p.id);
  const rt = ensureRuntime(roomId);
  rt.playerOrder = shuffle(ids);
  rt.psychicBaseIndex = Math.floor(Math.random() * rt.playerOrder.length);
  rt.candidateSkipOffset = 0;
  rt.teamNeedle = 0.5;
  rt.submittedGuessers = new Set();

  await prisma.$transaction([
    prisma.room.update({
      where: { id: roomId },
      data: { status: "in_round" },
    }),
    prisma.round.create({
      data: {
        roomId,
        roundNumber: 1,
        status: "selecting_psychic",
      },
    }),
  ]);
}

async function abortActiveRoundAndStartNew(
  roomId: string,
  skipPsychicId: string | null
) {
  const rt = ensureRuntime(roomId);
  const last = await prisma.round.findFirst({
    where: { roomId },
    orderBy: { roundNumber: "desc" },
  });
  if (!last) return;

  if (last.status !== "revealed" && last.status !== "complete") {
    await prisma.round.update({
      where: { id: last.id },
      data: { status: "complete", score: 0 },
    });
  }

  const active = await getActivePlayerIds(roomId);
  if (active.length < 2) return;

  if (!rt.playerOrder.length) {
    rt.playerOrder = shuffle([...active]);
    rt.psychicBaseIndex = 0;
  } else {
    const idx = skipPsychicId
      ? rt.playerOrder.indexOf(skipPsychicId)
      : rt.psychicBaseIndex;
    if (idx >= 0) {
      rt.psychicBaseIndex = (idx + 1) % rt.playerOrder.length;
    }
  }
  rt.candidateSkipOffset = 0;
  rt.teamNeedle = 0.5;
  rt.submittedGuessers = new Set();

  const nextNum = last.roundNumber + 1;
  await prisma.round.create({
    data: {
      roomId,
      roundNumber: nextNum,
      status: "selecting_psychic",
    },
  });
}

export async function psychicAccept(roomId: string, playerId: string) {
  const rt = ensureRuntime(roomId);
  const candidate = currentPsychicCandidateId(rt);
  if (!candidate || candidate !== playerId) {
    throw new Error("Not your turn to be psychic");
  }
  const round = await prisma.round.findFirst({
    where: { roomId },
    orderBy: { roundNumber: "desc" },
  });
  if (!round || round.status !== "selecting_psychic") {
    throw new Error("Invalid round phase");
  }
  await prisma.round.update({
    where: { id: round.id },
    data: {
      psychicPlayerId: playerId,
      status: "psychic_setting_theme",
      targetPosition: Math.random(),
    },
  });
}

export async function psychicSkip(roomId: string, playerId: string) {
  const rt = ensureRuntime(roomId);
  const candidate = currentPsychicCandidateId(rt);
  if (!candidate || candidate !== playerId) {
    throw new Error("Not your turn to skip");
  }
  const round = await prisma.round.findFirst({
    where: { roomId },
    orderBy: { roundNumber: "desc" },
  });
  if (!round || round.status !== "selecting_psychic") {
    throw new Error("Invalid round phase");
  }
  const n = rt.playerOrder.length;
  rt.candidateSkipOffset += 1;
  if (rt.candidateSkipOffset >= n) {
    rt.candidateSkipOffset = 0;
    const forced = rt.playerOrder[rt.psychicBaseIndex % n];
    if (forced) await psychicAccept(roomId, forced);
  }
}

export async function setTheme(roomId: string, playerId: string, theme: ThemePayload) {
  const round = await prisma.round.findFirst({
    where: { roomId },
    orderBy: { roundNumber: "desc" },
  });
  if (!round || round.psychicPlayerId !== playerId) {
    throw new Error("Only the psychic can set the theme");
  }
  if (round.status !== "psychic_setting_theme") {
    throw new Error("Wrong phase for theme");
  }

  const rt = ensureRuntime(roomId);
  rt.teamNeedle = 0.5;
  rt.submittedGuessers = new Set();

  if (theme.kind === "custom") {
    await prisma.round.update({
      where: { id: round.id },
      data: {
        themeCustom: JSON.stringify({
          left: theme.left.slice(0, 28),
          right: theme.right.slice(0, 28),
          clue: theme.clue?.slice(0, 200),
        }),
        themePresetId: null,
        status: "guessing",
      },
    });
  } else {
    const preset = await prisma.themePreset.findUnique({
      where: { id: theme.presetId },
    });
    if (!preset) throw new Error("Invalid preset");
    await prisma.round.update({
      where: { id: round.id },
      data: {
        themePresetId: preset.id,
        themeCustom: null,
        status: "guessing",
      },
    });
  }
}

export async function setTeamNeedle(
  roomId: string,
  playerId: string,
  position: number
) {
  const clamp = Math.max(0, Math.min(1, position));
  const round = await prisma.round.findFirst({
    where: { roomId },
    orderBy: { roundNumber: "desc" },
  });
  if (!round || round.status !== "guessing") return;
  if (round.psychicPlayerId === playerId) return;
  const rt = ensureRuntime(roomId);
  if (rt.submittedGuessers.has(playerId)) return;
  rt.teamNeedle = clamp;
}

export async function submitGuess(roomId: string, playerId: string) {
  const round = await prisma.round.findFirst({
    where: { roomId },
    orderBy: { roundNumber: "desc" },
    include: { room: { include: { players: { where: activePlayersWhere() } } } },
  });
  if (!round || round.status !== "guessing") {
    throw new Error("Not in guessing phase");
  }
  if (round.psychicPlayerId === playerId) {
    throw new Error("Psychic cannot guess");
  }
  const rt = ensureRuntime(roomId);
  if (rt.submittedGuessers.has(playerId)) {
    throw new Error("Already submitted");
  }

  const pos = rt.teamNeedle;
  await prisma.guess.create({
    data: {
      roundId: round.id,
      playerId,
      position: pos,
    },
  });
  rt.submittedGuessers.add(playerId);

  const guessers = round.room.players
    .filter((p) => p.id !== round.psychicPlayerId)
    .map((p) => p.id);
  const allIn =
    guessers.length > 0 &&
    guessers.every((id) => rt.submittedGuessers.has(id));

  if (allIn) {
    await doReveal(roomId, round.id);
  }
}

async function doReveal(roomId: string, roundId: string) {
  const round = await prisma.round.findUnique({
    where: { id: roundId },
    include: { guesses: true },
  });
  if (!round || !round.targetPosition) return;

  const positions = round.guesses.map((g) => g.position);
  const teamGuess =
    positions.length > 0
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : ensureRuntime(roomId).teamNeedle;

  const score = wavelengthScore(round.targetPosition, teamGuess);
  await prisma.round.update({
    where: { id: roundId },
    data: {
      status: "revealed",
      finalTeamGuess: teamGuess,
      score,
    },
  });
  await prisma.room.update({
    where: { id: roomId },
    data: { status: "between_rounds" },
  });
}

export async function leaderNextRound(roomId: string, leaderId: string) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || room.leaderPlayerId !== leaderId) {
    throw new Error("Only the leader can advance");
  }
  const round = await prisma.round.findFirst({
    where: { roomId },
    orderBy: { roundNumber: "desc" },
  });
  if (!round || round.status !== "revealed") {
    throw new Error("Round not ready for next");
  }

  await prisma.round.update({
    where: { id: round.id },
    data: { status: "complete" },
  });

  const rt = ensureRuntime(roomId);
  const n = rt.playerOrder.length;
  if (n > 0) {
    rt.psychicBaseIndex = (rt.psychicBaseIndex + 1) % n;
  }
  rt.candidateSkipOffset = 0;
  rt.teamNeedle = 0.5;
  rt.submittedGuessers = new Set();

  await prisma.round.create({
    data: {
      roomId,
      roundNumber: round.roundNumber + 1,
      status: "selecting_psychic",
    },
  });
  await prisma.room.update({
    where: { id: roomId },
    data: { status: "in_round" },
  });
}

export async function leaderEndGame(roomId: string, leaderId: string) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || room.leaderPlayerId !== leaderId) {
    throw new Error("Only the leader can end the game");
  }
  await prisma.room.update({
    where: { id: roomId },
    data: { status: "closed" },
  });
  deleteRuntime(roomId);
}

export async function leaveRoom(roomId: string, playerId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      players: { where: activePlayersWhere(), orderBy: { joinedAt: "asc" } },
    },
  });
  if (!room) return;

  const round = await prisma.round.findFirst({
    where: { roomId },
    orderBy: { roundNumber: "desc" },
  });

  const wasPsychic =
    round &&
    round.psychicPlayerId === playerId &&
    (round.status === "psychic_setting_theme" || round.status === "guessing");

  await prisma.player.update({
    where: { id: playerId },
    data: { leftAt: new Date() },
  });

  const rt = getRuntime(roomId);
  if (rt) {
    rt.socketByPlayer.delete(playerId);
    rt.playerOrder = rt.playerOrder.filter((id) => id !== playerId);
  }

  if (room.leaderPlayerId === playerId) {
    const remaining = room.players.filter((p) => p.id !== playerId);
    if (remaining.length === 0) {
      await prisma.room.update({
        where: { id: roomId },
        data: { status: "closed", leaderPlayerId: null },
      });
      deleteRuntime(roomId);
      return;
    }
    const newLeader = remaining[0];
    await prisma.player.update({
      where: { id: newLeader.id },
      data: { isLeader: true },
    });
    await prisma.room.update({
      where: { id: roomId },
      data: { leaderPlayerId: newLeader.id },
    });
  }

  if (wasPsychic) {
    await abortActiveRoundAndStartNew(roomId, playerId);
  } else if (round?.status === "selecting_psychic" && rt) {
    const active = await getActivePlayerIds(roomId);
    rt.playerOrder = rt.playerOrder.filter((id) => active.includes(id));
    if (rt.playerOrder.length === 0 && active.length > 0) {
      rt.playerOrder = shuffle([...active]);
    }
    rt.candidateSkipOffset = Math.min(
      rt.candidateSkipOffset,
      Math.max(0, rt.playerOrder.length - 1)
    );
  }
}

export async function onSocketDisconnect(socketId: string) {
  unregisterSocket(socketId);
}

export function appendPlayerToRuntime(roomId: string, playerId: string) {
  const rt = getRuntime(roomId);
  if (!rt || rt.playerOrder.includes(playerId)) return;
  rt.playerOrder.push(playerId);
}

export { ensureRuntime, getRuntime };
