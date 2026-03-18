import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/src/lib/prisma";
import { signPlayerToken } from "@/src/lib/tokens";

const createRoomSchema = z.object({
  nickname: z.string().min(1).max(32),
});

function generateRoomCode(length = 5): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

async function createUniqueRoomCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateRoomCode();
    const existing = await prisma.room.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error("Failed to generate unique room code");
}

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = createRoomSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const code = await createUniqueRoomCode();

  const room = await prisma.room.create({
    data: {
      code,
      status: "lobby",
    },
  });

  const player = await prisma.player.create({
    data: {
      roomId: room.id,
      nickname: parsed.data.nickname,
      isLeader: true,
    },
  });

  await prisma.room.update({
    where: { id: room.id },
    data: { leaderPlayerId: player.id },
  });

  const token = signPlayerToken({ playerId: player.id, roomId: room.id });

  return NextResponse.json({
    room: { id: room.id, code: room.code, status: room.status },
    player: { id: player.id, nickname: player.nickname, isLeader: player.isLeader },
    token,
  });
}

