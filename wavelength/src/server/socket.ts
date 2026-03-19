import type { Server as IOServer, Socket } from "socket.io";
import { prisma } from "@/lib/prisma";
import { verifyPlayerToken } from "@/lib/tokens";
import {
  claimNeedle,
  buildRoomState,
  executeCountdownReveal,
  getRuntime,
  leaderEndGame,
  leaderNextRound,
  leaveRoom,
  lockGuess,
  onSocketDisconnect,
  psychicAccept,
  psychicSkip,
  registerSocket,
  seedThemePresetsIfEmpty,
  setTeamNeedle,
  setTheme,
  releaseNeedle,
  startGame,
  unlockGuess,
} from "@/lib/game/gameService";
import { z } from "zod";

const needleSchema = z.object({
  position: z.number().min(0).max(1),
  playerId: z.string().min(1),
});
const themeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("custom"),
    left: z.string().min(1).max(28),
    right: z.string().min(1).max(28),
    clue: z.string().max(200).optional(),
  }),
  z.object({ kind: z.literal("preset"), presetId: z.string().min(1) }),
]);

const dominionSchema = z.object({
  playerId: z.string().min(1),
});

async function broadcastRoom(io: IOServer, roomId: string) {
  const room = await prisma.room.findUnique({
    where: { id: roomId },
    include: {
      players: { where: { leftAt: null }, select: { id: true } },
    },
  });
  if (!room) return;
  for (const p of room.players) {
    const state = await buildRoomState(roomId, p.id);
    if (state) {
      io.to(`player:${p.id}`).emit("room:state", state);
    }
  }
  io.to(`room:${room.code}`).emit("room:refresh");
}

export function attachGameSockets(io: IOServer) {
  void seedThemePresetsIfEmpty();

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string) ||
      (socket.handshake.query?.token as string);
    if (!token || typeof token !== "string") {
      next(new Error("Unauthorized"));
      return;
    }
    const payload = verifyPlayerToken(token);
    if (!payload) {
      next(new Error("Unauthorized"));
      return;
    }
    socket.data.playerId = payload.playerId;
    socket.data.roomId = payload.roomId;
    next();
  });

  io.on("connection", async (socket: Socket) => {
    const playerId = socket.data.playerId as string;
    const roomId = socket.data.roomId as string;

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.status === "closed") {
      socket.disconnect();
      return;
    }

    registerSocket(roomId, playerId, socket.id);
    await socket.join(`room:${room.code}`);
    await socket.join(`player:${playerId}`);

    await broadcastRoom(io, roomId);

    socket.on("leader:start_game", async () => {
      try {
        await startGame(roomId, playerId);
        await broadcastRoom(io, roomId);
      } catch (e) {
        socket.emit("error:msg", {
          message: e instanceof Error ? e.message : "Error",
        });
      }
    });

    socket.on("leader:next_round", async () => {
      try {
        await leaderNextRound(roomId, playerId);
        await broadcastRoom(io, roomId);
      } catch (e) {
        socket.emit("error:msg", {
          message: e instanceof Error ? e.message : "Error",
        });
      }
    });

    socket.on("leader:end_game", async () => {
      try {
        await leaderEndGame(roomId, playerId);
        io.to(`room:${room.code}`).emit("room:closed");
      } catch (e) {
        socket.emit("error:msg", {
          message: e instanceof Error ? e.message : "Error",
        });
      }
    });

    socket.on("psychic:accept", async () => {
      try {
        await psychicAccept(roomId, playerId);
        await broadcastRoom(io, roomId);
      } catch (e) {
        socket.emit("error:msg", {
          message: e instanceof Error ? e.message : "Error",
        });
      }
    });

    socket.on("psychic:skip", async () => {
      try {
        await psychicSkip(roomId, playerId);
        await broadcastRoom(io, roomId);
      } catch (e) {
        socket.emit("error:msg", {
          message: e instanceof Error ? e.message : "Error",
        });
      }
    });

    socket.on("psychic:set_theme", async (raw: unknown) => {
      const parsed = themeSchema.safeParse(raw);
      if (!parsed.success) {
        socket.emit("error:msg", { message: "Invalid theme" });
        return;
      }
      try {
        await setTheme(roomId, playerId, parsed.data);
        await broadcastRoom(io, roomId);
      } catch (e) {
        socket.emit("error:msg", {
          message: e instanceof Error ? e.message : "Error",
        });
      }
    });

    socket.on("player:needle_move", async (raw: unknown) => {
      const parsed = needleSchema.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.playerId !== playerId) return;
      const { othersReset, countdownCancelled, teamNeedle, needleSeq } =
        await setTeamNeedle(
        roomId,
        playerId,
        parsed.data.position,
      );
      if (teamNeedle === null || needleSeq === null) return;
      io.to(`room:${room.code}`).emit("room:needle", {
        teamNeedle,
        needleSeq,
        needleDominionPlayerId: playerId,
      });
      if (countdownCancelled) {
        io.to(`room:${room.code}`).emit("room:countdown_cancel");
      }
      if (othersReset) {
        await broadcastRoom(io, roomId);
      }
    });

    socket.on("player:needle_claim", async (raw: unknown) => {
      const parsed = dominionSchema.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.playerId !== playerId) return;
      const res = await claimNeedle(roomId, playerId);
      if (!res.ok) return;
      io.to(`room:${room.code}`).emit("room:needle_dominion", {
        needleDominionPlayerId: res.needleDominionPlayerId,
        needleDominionSeq: res.needleDominionSeq,
      });
    });

    socket.on("player:needle_letgo", async (raw: unknown) => {
      const parsed = dominionSchema.safeParse(raw);
      if (!parsed.success) return;
      if (parsed.data.playerId !== playerId) return;
      const res = await releaseNeedle(roomId, playerId);
      if (!res.ok) return;
      io.to(`room:${room.code}`).emit("room:needle_dominion", {
        needleDominionPlayerId: res.needleDominionPlayerId,
        needleDominionSeq: res.needleDominionSeq,
      });
    });

    socket.on("player:lock_guess", async () => {
      try {
        const { allLocked } = await lockGuess(roomId, playerId);
        if (allLocked) {
          const rt = getRuntime(roomId);
          if (rt && rt.countdownTimer === null) {
            io.to(`room:${room.code}`).emit("room:countdown_start");
            rt.countdownTimer = setTimeout(async () => {
              rt.countdownTimer = null;
              await executeCountdownReveal(roomId);
              await broadcastRoom(io, roomId);
            }, 3500);
          }
        }
        await broadcastRoom(io, roomId);
      } catch (e) {
        socket.emit("error:msg", {
          message: e instanceof Error ? e.message : "Error",
        });
      }
    });

    socket.on("player:unlock_guess", async () => {
      try {
        const { wasCounting } = await unlockGuess(roomId, playerId);
        if (wasCounting) {
          io.to(`room:${room.code}`).emit("room:countdown_cancel");
        }
        await broadcastRoom(io, roomId);
      } catch (e) {
        socket.emit("error:msg", {
          message: e instanceof Error ? e.message : "Error",
        });
      }
    });

    socket.on("player:leave", async () => {
      await leaveRoom(roomId, playerId);
      socket.leave(`room:${room.code}`);
      socket.disconnect();
      await broadcastRoom(io, roomId);
    });

    socket.on("disconnect", async () => {
      await onSocketDisconnect(socket.id);
      await broadcastRoom(io, roomId);
    });
  });
}
