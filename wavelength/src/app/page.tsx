"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

function randomNick() {
  const a = ["Cosmic", "Neon", "Lunar", "Solar", "Quiet", "Wild"];
  const b = ["Fox", "Owl", "Wave", "Star", "Mint", "Jam"];
  return `${a[Math.floor(Math.random() * a.length)]}${b[Math.floor(Math.random() * b.length)]}${Math.floor(Math.random() * 99)}`;
}

export default function Home() {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const create = async () => {
    setErr(null);
    setLoading(true);
    const nick = nickname.trim() || randomNick();
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nick }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      localStorage.setItem(
        `wl:${data.room.code}`,
        JSON.stringify({ token: data.token, playerId: data.player.id }),
      );
      router.push(`/room/${data.room.code}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const join = async () => {
    setErr(null);
    const code = joinCode.trim().toUpperCase();
    if (code.length < 3) {
      setErr("Enter a room code");
      return;
    }
    setLoading(true);
    const nick = nickname.trim() || randomNick();
    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, nickname: nick }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      localStorage.setItem(
        `wl:${code}`,
        JSON.stringify({ token: data.token, playerId: data.player.id }),
      );
      router.push(`/room/${code}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="mb-10 text-center">
        <h1 className="text-4xl font-black tracking-tight text-[#11163A] sm:text-5xl">
          Wavelength
        </h1>
        <p className="mt-3 max-w-md text-sm text-gray-500">
          Read each other&apos;s minds. One psychic, one spectrum, one dial.
          Party game — not affiliated with the board game.
        </p>
      </div>

      <div className="w-full max-w-md space-y-8 rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
        <div>
          <label className="mb-2 block text-xs uppercase tracking-wider text-gray-400">
            Nickname
          </label>
          <input
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[#11163A] placeholder:text-gray-400"
            placeholder={randomNick()}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <div className="space-y-3">
          <button
            type="button"
            disabled={loading}
            onClick={create}
            className="w-full rounded-xl bg-[#11163A] py-4 text-lg font-bold text-white shadow-sm disabled:opacity-50"
          >
            Create room
          </button>
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-mono uppercase text-[#11163A] placeholder:text-gray-400"
              placeholder="CODE"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={8}
            />
            <button
              type="button"
              disabled={loading}
              onClick={join}
              className="rounded-xl border border-gray-300 px-6 py-3 font-semibold text-[#11163A] disabled:opacity-50"
            >
              Join
            </button>
          </div>
        </div>

        {err && <p className="text-center text-sm text-red-500">{err}</p>}
      </div>

      <p className="mt-10 max-w-sm text-center text-xs text-gray-400">
        Run the app with{" "}
        <code className="rounded bg-gray-100 px-1 text-gray-600">
          npm run dev
        </code>{" "}
        (custom server + Socket.IO). Set{" "}
        <code className="rounded bg-gray-100 px-1 text-gray-600">
          DATABASE_URL
        </code>{" "}
        and{" "}
        <code className="rounded bg-gray-100 px-1 text-gray-600">
          JWT_SECRET
        </code>{" "}
        in{" "}
        <code className="rounded bg-gray-100 px-1 text-gray-600">.env</code>.
      </p>
    </main>
  );
}
