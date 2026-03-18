import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.toUpperCase() ?? "";
  if (code.length < 3) {
    return NextResponse.json({ exists: false }, { status: 400 });
  }
  const room = await prisma.room.findUnique({
    where: { code },
    select: { id: true, status: true },
  });
  return NextResponse.json({
    exists: !!room && room.status !== "closed",
    status: room?.status,
  });
}
