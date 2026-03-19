"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  const draggingNeedleRef = useRef(false);
  const rafSendRef = useRef<number | null>(null);
  const pendingSendRef = useRef<number | null>(null);
  const lastNeedleSeqRef = useRef(0);
  const [needleDominionPlayerId, setNeedleDominionPlayerId] = useState<
    string | null
  >(null);
  const needleDominionPlayerIdRef = useRef<string | null>(null);
  const meIdRef = useRef<string | null>(null);
  const lastNeedleDominionSeqRef = useRef(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Guesser: cover stays until peel finishes after guessing → reveal. */
  const [revealPeelDone, setRevealPeelDone] = useState(false);
  const [revealCoverPeeling, setRevealCoverPeeling] = useState(false);
  const prevRoundStatusRef = useRef<string | null>(null);

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
    if (!state) return;
    meIdRef.current = state.meId;
    const domId = state.round?.needleDominionPlayerId ?? null;
    if (needleDominionPlayerIdRef.current !== domId) {
      needleDominionPlayerIdRef.current = domId;
      setNeedleDominionPlayerId(domId);
    }

    if (state.round?.teamNeedle !== undefined) {
      if (typeof state.round.needleSeq === "number") {
        lastNeedleSeqRef.current = Math.max(
          lastNeedleSeqRef.current,
          state.round.needleSeq,
        );
      }
      const amDominionHolder = domId === state.meId;
      if (!amDominionHolder) setNeedle(state.round.teamNeedle);
    }
  }, [
    state?.round?.teamNeedle,
    state?.round?.id,
    state?.round?.needleDominionPlayerId,
    state?.meId,
  ]);

  useEffect(() => {
    if (!token) return;
    const s = io({
      path: "/socket.io/",
      auth: { token },
      transports: ["websocket", "polling"],
    });
    s.on("connect", () => setErr(null));
    s.on("connect_error", () =>
      setErr("Could not connect. Please try again."),
    );
    s.on("room:state", (payload: RoomStatePayload) => {
      setState(payload);
      meIdRef.current = payload.meId;
      const domId = payload.round?.needleDominionPlayerId ?? null;
      if (needleDominionPlayerIdRef.current !== domId) {
        needleDominionPlayerIdRef.current = domId;
        setNeedleDominionPlayerId(domId);
      }
      if (payload.round?.teamNeedle !== undefined) {
        if (typeof payload.round.needleSeq === "number") {
          lastNeedleSeqRef.current = Math.max(
            lastNeedleSeqRef.current,
            payload.round.needleSeq,
          );
        }
        if (domId !== payload.meId) setNeedle(payload.round.teamNeedle);
      }
    });
    s.on(
      "room:needle_dominion",
      (p: { needleDominionPlayerId: string | null; needleDominionSeq: number }) => {
        if (p.needleDominionSeq <= lastNeedleDominionSeqRef.current) return;
        lastNeedleDominionSeqRef.current = p.needleDominionSeq;
        needleDominionPlayerIdRef.current = p.needleDominionPlayerId;
        setNeedleDominionPlayerId(p.needleDominionPlayerId);
      },
    );
    s.on(
      "room:needle",
      (p: {
        teamNeedle: number;
        needleSeq: number;
        needleDominionPlayerId: string | null;
      }) => {
      if (p.needleSeq <= lastNeedleSeqRef.current) return;
      lastNeedleSeqRef.current = p.needleSeq;
      // Ignore broadcasts while I'm the current dominion holder.
      if (p.needleDominionPlayerId === meIdRef.current) return;
      setNeedle(p.teamNeedle);
      },
    );
    s.on("room:countdown_start", () => {
      setCountdown(3);
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c !== null && c > 1) return c - 1;
          if (countdownRef.current) clearInterval(countdownRef.current);
          countdownRef.current = null;
          return c;
        });
      }, 1000);
    });
    s.on("room:countdown_cancel", () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setCountdown(null);
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

  useEffect(() => {
    return () => {
      if (rafSendRef.current !== null) {
        cancelAnimationFrame(rafSendRef.current);
        rafSendRef.current = null;
      }
      pendingSendRef.current = null;
    };
  }, []);

  const createOrJoin = async (join: boolean) => {
    setErr(null);
    const nick =
      nickname.trim() || `Guest${Math.floor(Math.random() * 9000 + 1000)}`;
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
      JSON.stringify({ token: data.token, playerId: data.player.id }),
    );
    setToken(data.token);
    setNickname(nick);
  };

  useEffect(() => {
    setRevealPeelDone(false);
    setRevealCoverPeeling(false);
  }, [state?.round?.id]);

  useEffect(() => {
    const status = state?.round?.status;
    const prev = prevRoundStatusRef.current;
    prevRoundStatusRef.current = status ?? null;

    if (status !== "guessing") {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setCountdown(null);
    }

    const psychicId = state?.round?.psychicId;
    const meId = state?.meId;
    const amGuesser =
      !!psychicId &&
      meId !== psychicId &&
      !!state?.players.some((p) => p.id === meId);
    const hasReveal = !!state?.round?.reveal;

    if (status === "revealed" || status === "complete") {
      if (!amGuesser || !hasReveal) return;
      if (prev === "guessing") {
        requestAnimationFrame(() => setRevealCoverPeeling(true));
        const t = window.setTimeout(() => {
          setRevealPeelDone(true);
          setRevealCoverPeeling(false);
        }, 720);
        return () => window.clearTimeout(t);
      }
      setRevealPeelDone(true);
      setRevealCoverPeeling(false);
      return;
    }

    if (status === "guessing") {
      setRevealPeelDone(false);
      setRevealCoverPeeling(false);
    }
  }, [
    state?.round?.status,
    state?.round?.psychicId,
    state?.meId,
    state?.players,
    state?.round?.reveal,
  ]);

  const me = useMemo(() => {
    if (!state) return null;
    return state.players.find((p) => p.id === state.meId) ?? null;
  }, [state]);

  const round = state?.round ?? null;
  const isPsychic = round?.psychicId === state?.meId;
  const guessers = round?.psychicId
    ? (state?.players.filter((p) => p.id !== round.psychicId) ?? [])
    : (state?.players ?? []);
  const iGuess =
    round && !isPsychic && state ? guessers.some((g) => g.id === state.meId) : false;
  const locked = (state && round?.lockedIds?.includes(state.meId)) ?? false;
  const needleDominionLocked =
    needleDominionPlayerId !== null && state
      ? needleDominionPlayerId !== state.meId
      : false;
  const dominionHolder = useMemo(() => {
    if (!state?.round) return null;
    if (!needleDominionPlayerId) return null;
    if (!needleDominionLocked) return null; // other guessers only
    return state.players.find((p) => p.id === needleDominionPlayerId) ?? null;
  }, [needleDominionLocked, needleDominionPlayerId, state]);

  const toggleLock = useCallback(() => {
    if (!socket || !iGuess) return;
    if (locked) {
      socket.emit("player:unlock_guess");
    } else {
      socket.emit("player:lock_guess");
    }
  }, [socket, iGuess, locked]);

  const flushPendingNeedleMove = () => {
    if (!socket) return;
    const myId = meIdRef.current;
    if (!myId) return;

    // Ensure the last dragged position is sent before claiming release.
    if (rafSendRef.current !== null) {
      cancelAnimationFrame(rafSendRef.current);
      rafSendRef.current = null;
    }

    const pos = pendingSendRef.current;
    pendingSendRef.current = null;
    if (pos !== null) {
      socket.emit("player:needle_move", { position: pos, playerId: myId });
    }
  };

  const isLeader = me?.isLeader ?? false;
  const canStart =
    isLeader && state?.room.status === "lobby" && (state?.players.length ?? 0) >= 2;

  if (!token) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-6 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-center text-sm text-gray-500">
          Room{" "}
          <span className="font-mono font-bold text-[#11163A]">{code}</span>
        </p>
        <input
          className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[#11163A] placeholder:text-gray-400"
          placeholder="Your nickname"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => createOrJoin(true)}
            className="flex-1 rounded-xl bg-[#11163A] py-3 font-semibold text-white"
          >
            Join room
          </button>
        </div>
        {err && <p className="text-center text-sm text-red-500">{err}</p>}
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex justify-center py-20 text-gray-400">Connecting…</div>
    );
  }

  const isCandidate = state.psychicCandidateId === state.meId;

  const dialReveal =
    round?.status === "revealed" || round?.status === "complete";
  const showDialBoard =
    !!round?.theme &&
    (round.status === "guessing" ||
      (dialReveal && !!round.reveal));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-16">
      {err && (
        <div className="rounded-lg bg-red-50 px-4 py-2 text-center text-sm text-red-600">
          {err}
        </div>
      )}

      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div>
          <p className="text-xs uppercase tracking-widest text-gray-400">
            Room code
          </p>
          <p className="font-mono text-2xl font-bold text-[#11163A]">
            {state.room.code}
          </p>
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
                className="rounded-lg bg-[#11163A] px-4 py-2 text-sm font-semibold text-white"
              >
                Next round
              </button>
            )}
          {isLeader && state.room.status !== "lobby" && (
            <button
              type="button"
              onClick={() => socket?.emit("leader:end_game")}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600"
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
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-500"
          >
            Leave
          </button>
        </div>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-medium text-gray-400">Players</h2>
        <ul className="flex flex-wrap gap-2">
          {state.players.map((p) => (
            <li
              key={p.id}
              className={`rounded-full px-3 py-1 text-sm ${
                p.id === state.meId
                  ? "bg-[#11163A]/10 font-medium text-[#11163A]"
                  : "bg-gray-100 text-gray-700"
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
        <p className="text-center text-gray-500">
          Waiting for the leader to start… Need at least 2 players.
        </p>
      )}

      {round?.status === "selecting_psychic" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
          {isCandidate ? (
            <>
              <p className="mb-4 text-lg font-medium text-[#11163A]">
                You&apos;re up as Psychic
              </p>
              <div className="flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => socket?.emit("psychic:accept")}
                  className="rounded-xl bg-[#11163A] px-6 py-3 font-semibold text-white"
                >
                  I&apos;ll be Psychic
                </button>
                <button
                  type="button"
                  onClick={() => socket?.emit("psychic:skip")}
                  className="rounded-xl border border-gray-300 px-6 py-3 text-gray-600"
                >
                  Skip
                </button>
              </div>
            </>
          ) : (
            <p className="text-gray-500">
              Waiting for{" "}
              <strong className="text-[#11163A]">
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
        <p className="text-center text-gray-500">
          Psychic is choosing the spectrum…
        </p>
      )}

      {showDialBoard && round.theme && (
        <div className="relative flex flex-col items-center gap-4">
          <Dial
            mode={
              dialReveal ? "reveal" : isPsychic ? "psychic" : "guess"
            }
            value={
              dialReveal
                ? round.reveal!.teamGuess
                : isPsychic && round.targetPosition !== undefined
                  ? round.targetPosition
                  : needle
            }
            teamNeedle={
              dialReveal ? undefined : isPsychic ? needle : round.teamNeedle
            }
            onChange={
              dialReveal || isPsychic
                ? undefined
                : (v) => {
                    setNeedle(v);
                    pendingSendRef.current = v;
                    if (rafSendRef.current === null) {
                      rafSendRef.current = requestAnimationFrame(() => {
                        rafSendRef.current = null;
                        const pos = pendingSendRef.current;
                        pendingSendRef.current = null;
                        if (pos !== null) {
                          const myId = meIdRef.current;
                          if (myId) {
                            socket?.emit("player:needle_move", {
                              position: pos,
                              playerId: myId,
                            });
                          }
                        }
                      });
                    }
                  }
            }
            onDragStateChange={(dragging) => {
              if (!socket || !iGuess || locked) return;
              const myId = meIdRef.current;
              if (!myId) return;

              if (dragging) {
                // Only allow claiming when no one else currently has dominion.
                if (
                  needleDominionPlayerId !== null &&
                  needleDominionPlayerId !== myId
                )
                  return;
                draggingNeedleRef.current = true;
                socket.emit("player:needle_claim", { playerId: myId });
                return;
              }

              // Only release if we actually started a drag/claim.
              if (!draggingNeedleRef.current) return;
              draggingNeedleRef.current = false;
              flushPendingNeedleMove();
              socket.emit("player:needle_letgo", { playerId: myId });
            }}
            disabled={dialReveal || !iGuess || locked || needleDominionLocked}
            leftLabel={round.theme.left}
            rightLabel={round.theme.right}
            showTarget={
              dialReveal ? round.reveal!.target : round.targetPosition
            }
            locked={locked}
            onToggleLock={!dialReveal && iGuess ? toggleLock : undefined}
            fadedByDominion={needleDominionLocked}
            dominionHolderName={dominionHolder?.nickname ?? null}
            showCover={
              iGuess &&
              !revealPeelDone &&
              (round.status === "guessing" || dialReveal)
            }
            coverRevealing={iGuess && revealCoverPeeling}
          />
          {!dialReveal && isPsychic && (
            <p className="text-center text-sm text-[#4D8B8B]">
              You&apos;re the Psychic — give a clue! Don&apos;t reveal the
              target.
            </p>
          )}
          {!dialReveal && iGuess && !locked && (
            <p className="text-center text-sm text-gray-400">
              Tap the center to approve
            </p>
          )}
          {!dialReveal && iGuess && locked && countdown === null && (
            <p className="text-center text-sm text-emerald-600">
              Approved! Waiting for others…
            </p>
          )}
          {!dialReveal && countdown !== null && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <span
                key={countdown}
                className="animate-ping text-[120px] font-black text-white drop-shadow-[0_0_40px_rgba(0,0,0,0.7)]"
                style={{ animationDuration: "0.8s", animationIterationCount: 1 }}
              >
                {countdown}
              </span>
            </div>
          )}
          {dialReveal && round.reveal && (
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm">
              <p className="text-3xl font-bold text-[#11163A]">
                {round.reveal.score} pts
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Target {(round.reveal.target * 100).toFixed(0)}% · Team{" "}
                {(round.reveal.teamGuess * 100).toFixed(0)}%
              </p>
              {isLeader && (
                <p className="mt-3 text-sm text-gray-400">
                  Press <strong>Next round</strong> when everyone is ready.
                </p>
              )}
            </div>
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
  onSubmit: (
    t:
      | { kind: "custom"; left: string; right: string }
      | { kind: "preset"; presetId: string },
  ) => void;
}) {
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [presetId, setPresetId] = useState(presets[0]?.id ?? "");

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <p className="mb-4 text-lg font-medium text-[#11163A]">
        Set the spectrum
      </p>
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode("preset")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${mode === "preset" ? "bg-[#11163A] text-white" : "text-gray-500"}`}
        >
          Presets
        </button>
        <button
          type="button"
          onClick={() => setMode("custom")}
          className={`rounded-lg px-4 py-2 text-sm font-medium ${mode === "custom" ? "bg-[#11163A] text-white" : "text-gray-500"}`}
        >
          Custom
        </button>
      </div>
      {mode === "preset" ? (
        <div className="flex flex-col gap-3">
          <select
            className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[#11163A]"
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
            className="rounded-xl bg-[#11163A] py-3 font-semibold text-white"
          >
            Lock in &amp; start guessing
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <input
            className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[#11163A] placeholder:text-gray-400"
            placeholder="Left pole"
            maxLength={28}
            value={left}
            onChange={(e) => setLeft(e.target.value)}
          />
          <input
            className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[#11163A] placeholder:text-gray-400"
            placeholder="Right pole"
            maxLength={28}
            value={right}
            onChange={(e) => setRight(e.target.value)}
          />
          <button
            type="button"
            disabled={!left.trim() || !right.trim()}
            onClick={() =>
              onSubmit({
                kind: "custom",
                left: left.trim(),
                right: right.trim(),
              })
            }
            className="rounded-xl bg-[#11163A] py-3 font-semibold text-white disabled:opacity-40"
          >
            Lock in &amp; start guessing
          </button>
        </div>
      )}
    </div>
  );
}
