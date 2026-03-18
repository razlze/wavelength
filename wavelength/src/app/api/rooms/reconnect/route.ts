import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPlayerToken } from "@/lib/tokens";

const reconnectSchema = z.object({
  token: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = reconnectSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const payload = verifyPlayerToken(parsed.data.token);
  if (!payload) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const player = await prisma.player.findUnique({
    where: { id: payload.playerId },
    include: { room: true },
  });

  if (!player || !player.room || player.room.id !== payload.roomId) {
    return NextResponse.json({ error: "Player not found" }, { status: 404 });
  }

  return NextResponse.json({
    room: {
      id: player.room.id,
      code: player.room.code,
      status: player.room.status,
    },
    player: {
      id: player.id,
      nickname: player.nickname,
      isLeader: player.isLeader,
    },
  });
}

