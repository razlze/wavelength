import Link from "next/link";

export default function RoomNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-violet-950 px-6 text-center">
      <h1 className="text-2xl font-bold text-white">Room not found</h1>
      <p className="text-violet-300">This code may be wrong or the game has ended.</p>
      <Link
        href="/"
        className="rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white"
      >
        Home
      </Link>
    </main>
  );
}
