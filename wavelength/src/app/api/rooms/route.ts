import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { log } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { signPlayerToken } from "@/lib/tokens";

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
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`room:create:${ip}`, 20, 60_000)) {
    log("warn", "rate_limit", { route: "POST /api/rooms", ip });
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }
  const json = await req.json().catch(() => null);
  const parsed = createRoomSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Even with a uniqueness pre-check, there is still a narrow race where
  // multiple concurrent room creations pick the same code. Retry on that.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = await createUniqueRoomCode();
    try {
      const { room, player } = await prisma.$transaction(async (tx) => {
        const room = await tx.room.create({
          data: {
            code,
            status: "lobby",
          },
        });

        const player = await tx.player.create({
          data: {
            roomId: room.id,
            nickname: parsed.data.nickname,
            isLeader: true,
          },
        });

        await tx.room.update({
          where: { id: room.id },
          data: { leaderPlayerId: player.id },
        });

        return { room, player };
      });

      const token = signPlayerToken({
        playerId: player.id,
        roomId: room.id,
      });

      return NextResponse.json({
        room: { id: room.id, code: room.code, status: room.status },
        player: {
          id: player.id,
          nickname: player.nickname,
          isLeader: player.isLeader,
        },
        token,
      });
    } catch (e) {
      if (
        e &&
        typeof e === "object" &&
        "code" in e &&
        // Prisma unique constraint violation
        (e as { code?: unknown }).code === "P2002"
      ) {
        // Unique constraint violation on `Room.code` - retry with a new code.
        continue;
      }
      throw e;
    }
  }

  return NextResponse.json(
    { error: "Failed to create room (code collision)" },
    { status: 500 },
  );
}

