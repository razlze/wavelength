"use client";

import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import type { RoomStatePayload } from "@/lib/game/types";
import { Dial } from "./Dial";

function storageKey(code: string) {
  return `wl:${code}`;
}

type Props = { code: string };

export function RoomClient({ code }: Props) {
  const [nickname, setNickname] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<RoomStatePayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [socket, setSocket] = useState<ReturnType<typeof io> | null>(null);
  const [needle, setNeedle] = useState(0.5);

  useEffect(() => {
    const raw =
      typeof window !== "undefined"
        ? localStorage.getItem(storageKey(code))
        : null;
    if (raw) {
      try {
        const j = JSON.parse(raw) as { token: string };
        if (j.token) setToken(j.token);
      } catch {
        /* ignore */
      }
    }
  }, [code]);

  useEffect(() => {
    if (state?.round?.teamNeedle !== undefined) {
      setNeedle(state.round.teamNeedle);
    }
  }, [state?.round?.teamNeedle, state?.round?.id]);

  useEffect(() => {
    if (!token) return;
    const s = io({
      path: "/socket.io/",
      auth: { token },
      transports: ["websocket", "polling"],
    });
    s.on("connect", () => setErr(null));
    s.on("connect_error", () =>
      setErr("Could not connect. Is the server running?")
    );
    s.on("room:state", (payload: RoomStatePayload) => {
      setState(payload);
      if (payload.round?.teamNeedle !== undefined) {
        setNeedle(payload.round.teamNeedle);
      }
    });
    s.on("room:needle", (p: { teamNeedle: number }) => {
      setNeedle(p.teamNeedle);
    });
    s.on("error:msg", (p: { message: string }) => setErr(p.message));
    s.on("room:closed", () => {
      setErr("Game ended.");
      s.disconnect();
    });
    setSocket(s);
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [token]);

  const createOrJoin = async (join: boolean) => {
    setErr(null);
    const nick =
      nickname.trim() ||
      `Guest${Math.floor(Math.random() * 9000 + 1000)}`;
    const url = join ? "/api/rooms/join" : "/api/rooms";
    const body = join
      ? JSON.stringify({ code: code.toUpperCase(), nickname: nick })
      : JSON.stringify({ nickname: nick });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setErr(data.error || "Request failed");
      return;
    }
    localStorage.setItem(
      storageKey(code),
      JSON.stringify({ token: data.token, playerId: data.player.id })
    );
    setToken(data.token);
    setNickname(nick);
  };

  const me = useMemo(() => {
    if (!state) return null;
    return state.players.find((p) => p.id === state.meId) ?? null;
  }, [state]);

  const isLeader = me?.isLeader ?? false;
  const canStart =
    isLeader &&
    state?.room.status === "lobby" &&
    state.players.length >= 2;

  if (!token) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-6 rounded-2xl border border-violet-500/30 bg-violet-950/40 p-8">
        <p className="text-center text-sm text-violet-200/80">
          Room <span className="font-mono font-bold text-white">{code}</span>
        </p>
        <input
          className="rounded-xl border border-violet-500/40 bg-black/30 px-4 py-3 text-white placeholder:text-violet-400/50"
          placeholder="Your nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => createOrJoin(true)}
            className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 font-semibold text-white"
          >
            Join room
          </button>
        </div>
        {err && <p className="text-center text-sm text-red-400">{err}</p>}
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex justify-center py-20 text-violet-200">
        Connecting…
      </div>
    );
  }

  const round = state.round;
  const isPsychic = round?.psychicId === state.meId;
  const isCandidate = state.psychicCandidateId === state.meId;
  const guessers = round?.psychicId
    ? state.players.filter((p) => p.id !== round.psychicId)
    : state.players;
  const iGuess = round && !isPsychic && guessers.some((g) => g.id === state.meId);
  const submitted = round?.submittedIds.includes(state.meId) ?? false;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-16">
      {err && (
        <div className="rounded-lg bg-red-950/50 px-4 py-2 text-center text-sm text-red-300">
          {err}
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-violet-500/20 pb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-violet-400">
            Room code
          </p>
          <p className="font-mono text-2xl font-bold text-white">{state.room.code}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isLeader && state.room.status === "lobby" && (
            <button
              type="button"
              disabled={!canStart}
              onClick={() => socket?.emit("leader:start_game")}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Start game
            </button>
          )}
          {isLeader &&
            (state.room.status === "between_rounds" ||
              round?.status === "revealed") && (
              <button
                type="button"
                onClick={() => socket?.emit("leader:next_round")}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Next round
              </button>
            )}
          {isLeader && state.room.status !== "lobby" && (
            <button
              type="button"
              onClick={() => socket?.emit("leader:end_game")}
              className="rounded-lg border border-violet-500/50 px-4 py-2 text-sm text-violet-200"
            >
              End game
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              socket?.emit("player:leave");
              localStorage.removeItem(storageKey(code));
              window.location.href = "/";
            }}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-zinc-400"
          >
            Leave
          </button>
        </div>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-medium text-violet-300">Players</h2>
        <ul className="flex flex-wrap gap-2">
          {state.players.map((p) => (
            <li
              key={p.id}
              className={`rounded-full px-3 py-1 text-sm ${
                p.id === state.meId
                  ? "bg-fuchsia-600/40 text-white"
                  : "bg-white/5 text-violet-200"
              }`}
            >
              {p.nickname}
              {p.isLeader && " ★"}
              {!p.online && " (away)"}
              {round?.psychicId === p.id && " 🔮"}
            </li>
          ))}
        </ul>
      </section>

      {state.room.status === "lobby" && (
        <p className="text-center text-violet-200/80">
          Waiting for the leader to start… Need at least 2 players.
        </p>
      )}

      {round?.status === "selecting_psychic" && (
        <div className="rounded-2xl border border-violet-500/30 bg-black/20 p-6 text-center">
          {isCandidate ? (
            <>
              <p className="mb-4 text-lg text-white">You&apos;re up as Psychic</p>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => socket?.emit("psychic:accept")}
                  className="rounded-xl bg-violet-600 px-6 py-3 font-semibold text-white"
                >
                  I&apos;ll be Psychic
                </button>
                <button
                  type="button"
                  onClick={() => socket?.emit("psychic:skip")}
                  className="rounded-xl border border-violet-500/50 px-6 py-3 text-violet-200"
                >
                  Skip
                </button>
              </div>
            </>
          ) : (
            <p className="text-violet-200">
              Waiting for{" "}
              <strong>
                {state.players.find((p) => p.id === state.psychicCandidateId)
                  ?.nickname ?? "…"}
              </strong>{" "}
              to accept or skip…
            </p>
          )}
        </div>
      )}

      {round?.status === "psychic_setting_theme" && isPsychic && (
        <PsychicThemeForm
          presets={state.presets}
          onSubmit={(t) => socket?.emit("psychic:set_theme", t)}
        />
      )}

      {round?.status === "psychic_setting_theme" && !isPsychic && (
        <p className="text-center text-violet-200">Psychic is choosing the spectrum…</p>
      )}

      {round?.status === "guessing" && round.theme && (
        <div className="flex flex-col items-center gap-6">
          <Dial
            value={needle}
            onChange={(v) => {
              setNeedle(v);
              socket?.emit("player:needle_move", { position: v });
            }}
            disabled={!iGuess || submitted || isPsychic}
            leftLabel={round.theme.left}
            rightLabel={round.theme.right}
            showTarget={
              isPsychic ? round.targetPosition : undefined
            }
          />
          {isPsychic && round.targetPosition !== undefined && (
            <p className="text-center text-sm text-cyan-300">
              Target zone center: {(round.targetPosition * 100).toFixed(0)}% — don&apos;t say it out loud!
            </p>
          )}
          {iGuess && !submitted && (
            <button
              type="button"
              onClick={() => socket?.emit("player:guess_submit")}
              className="rounded-xl bg-gradient-to-r from-pink-600 to-orange-500 px-10 py-3 font-bold text-white"
            >
              Submit guess
            </button>
          )}
          {iGuess && submitted && (
            <p className="text-violet-300">You submitted. Waiting for others…</p>
          )}
        </div>
      )}

      {(round?.status === "revealed" || round?.status === "complete") &&
        round.reveal && (
          <div className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-8 text-center">
            <p className="text-3xl font-bold text-white">
              {round.reveal.score} pts
            </p>
            <p className="mt-2 text-violet-200">
              Target {(round.reveal.target * 100).toFixed(0)}% · Team{" "}
              {(round.reveal.teamGuess * 100).toFixed(0)}%
            </p>
            {isLeader && (
              <p className="mt-4 text-sm text-violet-400">
                Press <strong>Next round</strong> when everyone is ready.
              </p>
            )}
          </div>
        )}
    </div>
  );
}

function PsychicThemeForm({
  presets,
  onSubmit,
}: {
  presets: { id: string; leftLabel: string; rightLabel: string }[];
  onSubmit: (t: { kind: "custom"; left: string; right: string } | { kind: "preset"; presetId: string }) => void;
}) {
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");

  return (
    <div className="rounded-2xl border border-violet-500/30 bg-black/30 p-6">
      <p className="mb-4 text-lg font-medium text-white">Set the spectrum</p>
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("preset")}
          className={`rounded-lg px-4 py-2 text-sm ${mode === "preset" ? "bg-violet-600 text-white" : "text-violet-300"}`}
        >
          Presets
        </button>
        <button
          type="button"
          onClick={() => setMode("custom")}
          className={`rounded-lg px-4 py-2 text-sm ${mode === "custom" ? "bg-violet-600 text-white" : "text-violet-300"}`}
        >
          Custom
        </button>
      </div>
      {mode === "preset" ? (
        <div className="flex flex-col gap-3">
          <select
            className="rounded-xl border border-violet-500/40 bg-black/40 px-4 py-3 text-white"
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.leftLabel} ↔ {p.rightLabel}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onSubmit({ kind: "preset", presetId })}
            className="rounded-xl bg-violet-600 py-3 font-semibold text-white"
          >
            Lock in & start guessing
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input
            className="rounded-xl border border-violet-500/40 bg-black/40 px-4 py-3 text-white"
            placeholder="Left pole"
            value={left}
            onChange={(e) => setLeft(e.target.value)}
          />
          <input
            className="rounded-xl border border-violet-500/40 bg-black/40 px-4 py-3 text-white"
            placeholder="Right pole"
            value={right}
            onChange={(e) => setRight(e.target.value)}
          />
          <button
            type="button"
            disabled={!left.trim() || !right.trim()}
            onClick={() =>
              onSubmit({ kind: "custom", left: left.trim(), right: right.trim() })
            }
            className="rounded-xl bg-violet-600 py-3 font-semibold text-white disabled:opacity-40"
          >
            Lock in & start guessing
          </button>
        </div>
      )}
    </div>
  );
}
