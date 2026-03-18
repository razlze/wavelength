import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { RoomClient } from "@/components/RoomClient";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }> };

export default async function RoomPage({ params }: Props) {
  const { code } = await params;
  const upper = code.toUpperCase();
  const room = await prisma.room.findUnique({
    where: { code: upper },
  });
  if (!room || room.status === "closed") {
    notFound();
  }
  return (
    <main className="min-h-screen bg-gradient-to-b from-violet-950 via-purple-950 to-black py-8">
      <RoomClient code={upper} />
    </main>
  );
}
