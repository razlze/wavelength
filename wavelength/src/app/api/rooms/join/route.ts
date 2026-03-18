import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { signPlayerToken } from "@/src/lib/tokens";

const joinRoomSchema = z.object({
  code: z.string().min(3).max(8),
  nickname: z.string().min(1).max(32),
});

export async function POST(req: NextRequest) {
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

  const token = signPlayerToken({ playerId: player.id, roomId: room.id });

  return NextResponse.json({
    room: { id: room.id, code: room.code, status: room.status },
    player: { id: player.id, nickname: player.nickname, isLeader: player.isLeader },
    token,
  });
}

