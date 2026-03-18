import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appendPlayerToRuntime } from "@/lib/game/gameService";
import { log } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { signPlayerToken } from "@/lib/tokens";

const joinRoomSchema = z.object({
  code: z.string().min(3).max(8),
  nickname: z.string().min(1).max(32),
});

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`room:join:${ip}`, 40, 60_000)) {
    log("warn", "rate_limit", { route: "POST /api/rooms/join", ip });
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const json = await req.json().catch(() => null);
  const parsed = joinRoomSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const code = parsed.data.code.toUpperCase();
  const room = await prisma.room.findUnique({ where: { code } });
  if (!room || room.status === "closed") {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const player = await prisma.player.create({
    data: {
      roomId: room.id,
      nickname: parsed.data.nickname,
      isLeader: false,
    },
  });

  if (room.status === "in_round" || room.status === "between_rounds") {
    appendPlayerToRuntime(room.id, player.id);
  }

  const token = signPlayerToken({ playerId: player.id, roomId: room.id });

  return NextResponse.json({
    room: { id: room.id, code: room.code, status: room.status },
    player: { id: player.id, nickname: player.nickname, isLeader: player.isLeader },
    token,
  });
}

