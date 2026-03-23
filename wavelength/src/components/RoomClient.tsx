"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import type { PublicPlayer, RoomStatePayload } from "@/lib/game/types";
import { LeaderCrownIcon } from "./icons/RoomIcons";
import { Dial } from "./Dial";

function storageKey(code: string) {
  return `wl:${code}`;
}

type Props = { code: string };

/** Psychic first, then others following runtime turn rotation. */
function orderedPlayersForGame(
  players: PublicPlayer[],
  playerOrder: string[] | null,
  psychicId: string | null,
  psychicCandidateId: string | null,
): PublicPlayer[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const headId = psychicId ?? psychicCandidateId ?? null;

  if (!playerOrder?.length) {
    if (!headId) return [...players];
    return [...players].sort((a, b) => {
      if (a.id === headId) return -1;
      if (b.id === headId) return 1;
      return 0;
    });
  }

  const n = playerOrder.length;
  const headIdx = headId ? playerOrder.indexOf(headId) : -1;

  if (headIdx < 0 || !headId) {
    const ordered = playerOrder
      .map((id) => byId.get(id))
      .filter((p): p is PublicPlayer => p !== undefined);
    for (const p of players) {
      if (!ordered.some((o) => o.id === p.id)) ordered.push(p);
    }
    return ordered;
  }

  const ordered: PublicPlayer[] = [];
  for (let i = 0; i < n; i++) {
    const id = playerOrder[(headIdx + i) % n]!;
    const p = byId.get(id);
    if (p) ordered.push(p);
  }
  for (const p of players) {
    if (!ordered.some((o) => o.id === p.id)) ordered.push(p);
  }
  return ordered;
}

function PlayerRow({
  player,
  isMe,
  showScore = true,
  guessLocked = false,
}: {
  player: PublicPlayer;
  isMe: boolean;
  /** Hidden in lobby before the game starts. */
  showScore?: boolean;
  /** During guessing: guesser has confirmed their guess (locked in). */
  guessLocked?: boolean;
}) {
  const rowTone = guessLocked
    ? "border-emerald-200/90 bg-emerald-50"
    : isMe
      ? "border-[#11163A]/25 bg-[#11163A]/5"
      : "border-gray-200 bg-white";
  const nameTone = guessLocked
    ? "text-emerald-900"
    : isMe
      ? "text-[#11163A]"
      : "text-gray-800";
  const scoreTone = guessLocked ? "text-emerald-700/90" : "text-gray-500";

  return (
    <div
      className={`flex min-h-[44px] items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
        showScore ? "justify-between" : ""
      } ${rowTone}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className={`truncate font-medium ${nameTone}`}>
          {player.nickname}
          {isMe ? " (You)" : ""}
        </span>
        {player.isLeader && (
          <span className="inline-flex shrink-0 text-amber-500" title="Room leader">
            <LeaderCrownIcon className="h-4 w-4" />
          </span>
        )}
        {!player.online && (
          <span className="shrink-0 text-xs text-gray-400">away</span>
        )}
      </div>
      {showScore && (
        <span className={`shrink-0 tabular-nums ${scoreTone}`}>
          {player.totalScore}
        </span>
      )}
    </div>
  );
}

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
  const lastNeedlePosRef = useRef<number | null>(null);
  const lastRoomStateSeqRef = useRef(0);
  const lastNeedleSeqRef = useRef(0);
  const lastLockSeqRef = useRef(0);
  const currentRoundIdRef = useRef<string | null>(null);
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
  /** Below md, player sidebar can collapse so the dial gets vertical space. */
  const [mobilePlayersOpen, setMobilePlayersOpen] = useState(true);
  const prevRoundStatusRef = useRef<string | null>(null);
  // Optimistic UX for the center "lock" button:
  // immediately reflect lock/unlock locally while waiting for the server `room:state`.
  const [optimisticLocked, setOptimisticLocked] = useState<boolean | null>(null);
  const [lockRequestInFlight, setLockRequestInFlight] = useState(false);
  const lockRequestPendingRef = useRef(false);
  const lockRequestTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

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
        lastNeedleSeqRef.current = state.round.needleSeq;
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
    lastRoomStateSeqRef.current = 0;
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
      if (payload.roomStateSeq <= lastRoomStateSeqRef.current) return;
      lastRoomStateSeqRef.current = payload.roomStateSeq;
      const prevRoundId = currentRoundIdRef.current;
      const nextRoundId = payload.round?.id ?? null;
      // Reset per-round monotonic guards immediately on round transitions.
      // Doing this here avoids races with async effects after setState.
      if (prevRoundId !== nextRoundId) {
        lastNeedleSeqRef.current = 0;
        lastLockSeqRef.current = 0;
        lastNeedleDominionSeqRef.current = 0;
      }
      setState(payload);
      currentRoundIdRef.current = nextRoundId;
      meIdRef.current = payload.meId;
      const domId = payload.round?.needleDominionPlayerId ?? null;
      if (needleDominionPlayerIdRef.current !== domId) {
        needleDominionPlayerIdRef.current = domId;
        setNeedleDominionPlayerId(domId);
      }
      if (payload.round?.teamNeedle !== undefined) {
        if (typeof payload.round.needleSeq === "number") {
          lastNeedleSeqRef.current = payload.round.needleSeq;
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
        roundId: string;
      }) => {
        const currentRoundId = currentRoundIdRef.current;
        // Ignore delayed needle packets from previous rounds.
        if (currentRoundId && p.roundId !== currentRoundId) return;
        if (p.needleSeq <= lastNeedleSeqRef.current) return;
        lastNeedleSeqRef.current = p.needleSeq;
        // Ignore broadcasts while I'm the current dominion holder.
        if (p.needleDominionPlayerId === meIdRef.current) return;
        setNeedle(p.teamNeedle);
      },
    );
    s.on(
      "room:locks_updated",
      (p: { lockedIds: string[]; roundId: string; lockSeq: number }) => {
        const currentRoundId = currentRoundIdRef.current;
        if (currentRoundId && p.roundId !== currentRoundId) return;
        if (p.lockSeq <= lastLockSeqRef.current) return;
        lastLockSeqRef.current = p.lockSeq;
        setState((prev) => {
          if (!prev?.round || prev.round.id !== p.roundId) return prev;
          return {
            ...prev,
            round: {
              ...prev.round,
              lockedIds: p.lockedIds,
            },
          };
        });
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
    s.on("error:msg", (p: { message: string }) => {
      // If lock/unlock failed, clear local optimistic/in-flight state immediately.
      if (lockRequestPendingRef.current) {
        lockRequestPendingRef.current = false;
        setLockRequestInFlight(false);
        setOptimisticLocked(null);
      }
      setErr(p.message);
    });
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
    setOptimisticLocked(null);
    setLockRequestInFlight(false);
    lockRequestPendingRef.current = false;
    if (lockRequestTimeoutRef.current) {
      clearTimeout(lockRequestTimeoutRef.current);
      lockRequestTimeoutRef.current = null;
    }

    // Server resets runtime sequence numbers between rounds (e.g. `needleSeq`).
    // Reset our local monotonic guards too, otherwise we would incorrectly
    // ignore all subsequent `room:needle` updates after the first round.
    lastNeedleSeqRef.current = 0;
    lastLockSeqRef.current = 0;
    lastNeedleDominionSeqRef.current = 0;
    currentRoundIdRef.current = state?.round?.id ?? null;
    lastNeedlePosRef.current = null;
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
  const serverLocked = (state && round?.lockedIds?.includes(state.meId)) ?? false;
  const locked = optimisticLocked ?? serverLocked;
  const needleDominionLocked =
    needleDominionPlayerId !== null && state
      ? needleDominionPlayerId !== state.meId
      : false;

  // Reconcile optimistic UI with server truth as soon as the server updates.
  useEffect(() => {
    // If the server and optimistic already match, we can just clear the override.
    // If they don't match, clearing makes the UI converge to server state.
    if (optimisticLocked !== null && optimisticLocked !== serverLocked) {
      setOptimisticLocked(null);
      return;
    }
    if (optimisticLocked !== null && optimisticLocked === serverLocked) {
      // Clear so future toggles use server value until next optimistic interaction.
      setOptimisticLocked(null);
    }
  }, [serverLocked]);

  // Clear in-flight guard once we see the server lock state change.
  useEffect(() => {
    if (!lockRequestInFlight) return;
    // If serverLocked changed, we can safely re-enable input.
    lockRequestPendingRef.current = false;
    setLockRequestInFlight(false);
  }, [serverLocked]);

  useEffect(() => {
    if (!lockRequestInFlight) return;
    // Safety net: if something goes wrong and the server never updates,
    // don't permanently disable the button.
    lockRequestTimeoutRef.current = setTimeout(() => {
      lockRequestPendingRef.current = false;
      setLockRequestInFlight(false);
      lockRequestTimeoutRef.current = null;
      setOptimisticLocked(null);
    }, 6000);
    return () => {
      if (lockRequestTimeoutRef.current) {
        clearTimeout(lockRequestTimeoutRef.current);
        lockRequestTimeoutRef.current = null;
      }
    };
  }, [lockRequestInFlight]);
  const dominionHolder = useMemo(() => {
    if (!state?.round) return null;
    if (!needleDominionPlayerId) return null;
    if (!needleDominionLocked) return null; // other guessers only
    return state.players.find((p) => p.id === needleDominionPlayerId) ?? null;
  }, [needleDominionLocked, needleDominionPlayerId, state]);

  const toggleLock = useCallback(() => {
    if (!socket || !iGuess) return;
    if (lockRequestInFlight) return;
    // Optimistically update the UI so the dial turns green immediately.
    setOptimisticLocked(!locked);
    lockRequestPendingRef.current = true;
    setLockRequestInFlight(true);
    if (locked) {
      socket.emit("player:unlock_guess");
    } else {
      socket.emit("player:lock_guess");
    }
  }, [socket, iGuess, locked, lockRequestInFlight]);

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

  const gameStarted = !!state && state.room.status !== "lobby";
  const orderedPlayers = useMemo(() => {
    if (!state) return [];
    return orderedPlayersForGame(
      state.players,
      state.playerOrder,
      state.round?.psychicId ?? null,
      state.psychicCandidateId,
    );
  }, [state]);

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

  const outerShell = gameStarted
    ? "mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-16"
    : "mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-16";

  const bodyRowClass = gameStarted
    ? "flex w-full flex-col gap-6 md:flex-row md:items-start md:gap-10"
    : "";

  const lockedGuessersWhileGuessing =
    round?.status === "guessing"
      ? new Set(round.lockedIds ?? [])
      : null;

  return (
    <div className={outerShell}>
      <header className="flex w-full flex-wrap items-center justify-between gap-4 border-b border-gray-200 pb-4">
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

      <div className={bodyRowClass}>
        {gameStarted && (
          <aside className="w-full shrink-0 md:sticky md:top-4 md:w-56 md:self-start">
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm md:contents md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:shadow-none">
              <button
                type="button"
                className="flex w-full min-h-[44px] items-center justify-between gap-2 px-3 py-2.5 text-left md:hidden"
                onClick={() => setMobilePlayersOpen((o) => !o)}
                aria-expanded={mobilePlayersOpen}
                aria-controls="room-players-list"
              >
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {mobilePlayersOpen
                    ? "Psychic:"
                    : `Players${orderedPlayers.length > 0 ? ` (${orderedPlayers.length})` : ""}`}
                </span>
                <svg
                  className={`h-5 w-5 shrink-0 text-gray-400 transition-transform duration-200 ${
                    mobilePlayersOpen ? "rotate-180" : ""
                  }`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <h2 className="mb-2 hidden text-xs font-semibold uppercase tracking-wider text-gray-400 md:block">
                Psychic:
              </h2>
            {orderedPlayers.length > 0 && (
              <div
                id="room-players-list"
                className={`flex flex-col gap-2 px-2 pb-2 pt-1 md:px-0 md:pb-0 md:pt-0 ${
                  !mobilePlayersOpen ? "max-md:hidden" : ""
                }`}
              >
                <PlayerRow
                  player={orderedPlayers[0]!}
                  isMe={orderedPlayers[0]!.id === state.meId}
                  guessLocked={
                    lockedGuessersWhileGuessing?.has(
                      orderedPlayers[0]!.id,
                    ) ?? false
                  }
                />
                {orderedPlayers.length > 1 && (
                  <>
                    <div className="my-1 border-t border-gray-200/90" />
                    <div className="flex flex-col gap-2">
                      <p className="px-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">
                        Next up:
                      </p>
                      {orderedPlayers.slice(1).map((p) => (
                        <PlayerRow
                          key={p.id}
                          player={p}
                          isMe={p.id === state.meId}
                          guessLocked={
                            lockedGuessersWhileGuessing?.has(p.id) ?? false
                          }
                        />
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
            </div>
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-6">
        {err && (
          <div className="rounded-lg bg-red-50 px-4 py-2 text-center text-sm text-red-600">
            {err}
          </div>
        )}

        {!gameStarted && (
          <section>
            <h2 className="mb-2 text-sm font-medium text-gray-400">
              Joined so far
            </h2>
            <ul className="flex flex-col gap-2">
              {state.players.map((p) => (
                <li key={p.id}>
                  <PlayerRow
                    player={p}
                    isMe={p.id === state.meId}
                    showScore={false}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

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
                    lastNeedlePosRef.current = v;
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
              const pos = lastNeedlePosRef.current;
              socket.emit(
                "player:needle_letgo",
                pos === null ? { playerId: myId } : { playerId: myId, position: pos },
              );
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
              Tap the center to confirm your guess
            </p>
          )}
          {!dialReveal && iGuess && locked && countdown === null && (
            <p className="text-center text-sm text-emerald-600">
              Confirmed! Tap again to cancel
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
      </div>
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
