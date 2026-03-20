# Wavelength: End-to-End Rules, Behaviors, and Requirements

## 1. Purpose
This document is a comprehensive, end-to-end specification of the Wavelength multiplayer application:
- The gameplay rules (including "away/disconnected" semantics).
- The authoritative behavioral model (server + DB + in-memory runtime).
- The network/API contract (REST + Socket.IO events).
- Functional requirements, non-functional requirements, and correctness invariants.
- A test blueprint (what to test and why) to enable reliable future CI.

This spec reflects the current behavior of the codebase, including recent correctness cleanups (countdown snapshot semantics, idempotent reveals, stale packet guards, lock invalidation rules, and socket de-dup on reconnect).

## 2. Glossary and Key Concepts
**Room**: A multiplayer session identified by a join code (`Room.code`).

**Player**: A user instance stored in the database (`Player`). Players may be leader, psychic, or guessers.

**Round**: A game round stored in the database (`Round`). Rounds progress through phases.

**Theme**: The spectrum definition (left/right labels and optional clue). Chosen by the psychic and stored in the round via `themePresetId` or `themeCustom`.

**Needle**: The shared team needle position on the dial (`RoomRuntime.teamNeedle` during the guessing phase; revealed via `Round.finalTeamGuess` and `Round.score`).

**Needle Dominion**: Exclusive control of the needle by one guesser at a time (`RoomRuntime.needleDominionPlayerId`).

**Locked Guessers**: Guessers who have confirmed their guess before the reveal countdown executes (`RoomRuntime.lockedGuessers`).

**Away / Disconnected**: A player who has lost their socket connection but has not fully "left the game" (they have no `Player.leftAt` timestamp set). This player is considered "away" in gameplay semantics.

**Full Leave**: The explicit action to leave the room (`player:leave` socket event), which sets `Player.leftAt` and removes runtime eligibility for that round.

**Countdown**: The 3.5-second timer that starts only when the lock invariant is satisfied. When it fires, the server finalizes guesses and reveals the score.

**Cohort Snapshot**: The set of guessers eligible to be scored for a particular countdown. The snapshot is determined at countdown start time.

## 3. Actors and Responsibilities
**Leader**
- Creates the room.
- Starts the game.
- Advances to the next round when the round is ready.
- Can end the game.

**Psychic**
- For each round, selects the theme (target spectrum).
- Is the only player who sees the hidden target (client behavior via dial mode).

**Guessers**
- Move the needle collaboratively.
- Claim needle dominion to move it.
- Lock/unlock their confirmation.
- Are scored according to the countdown cohort snapshot rules.

**Away/Disconnected players**
- Remain eligible according to the "online at countdown start" snapshot semantics.
- Are treated as offline for countdown eligibility while they are away; their lock state is not necessary to start the countdown.
- Do not need to re-confirm lock after becoming away if they were online at the moment countdown started (they are included in the cohort snapshot).

## 4. System Architecture (End-to-End)
### 4.1 Runtime vs Database Authority
The system uses both:
- **Database (Prisma/Postgres)**: Authoritative durable game record of rooms, players, rounds, and guesses.
- **In-memory runtime (`RoomRuntime`)**: Authoritative real-time control and correctness invariants, per room:
  - Needle position and sequences (`teamNeedle`, `needleSeq`).
  - Needle dominion and sequence (`needleDominionPlayerId`, `needleDominionSeq`).
  - Locked guesser set (`lockedGuessers`).
  - Countdown timer (`countdownTimer`) and scheduling.
  - Player order / psychic rotation indices.
  - Socket mapping for online-ness detection (`socketByPlayer`).

If the server process restarts, `RoomRuntime` is lost but DB persists; behavior after restart is not currently specified and should be treated as an explicit gap for future work.

### 4.2 Transport and Endpoints
**REST APIs**
- `POST /api/rooms`: Create a room and leader player; returns a signed token.
- `POST /api/rooms/join`: Join an existing open room; returns a signed token.
- `POST /api/rooms/reconnect`: Verify a token and return room + player metadata (used for reconnection UX; the current client may or may not call it yet).

**Socket.IO**
- The app runs a Socket.IO server from `server.ts` with path `/socket.io/`.
- Socket authentication is performed using a signed token (`socket.handshake.auth.token` or query token).
- After auth, `socket.data.playerId` and `socket.data.roomId` are set.

### 4.3 Event Error Semantics
- For any invalid action, the server may emit `error:msg` with `{ message }`.
- The client uses this to clear local in-flight state (primarily around lock/unlock UX).

## 5. Data Model (DB Schema)
Source: `prisma/schema.prisma`.

### 5.1 Room
Fields:
- `id` (UUID primary key)
- `code` (unique join code)
- `status`: `lobby | in_round | between_rounds | closed`
- `leaderPlayerId` (optional FK to leader)

### 5.2 Player
Fields:
- `id` (UUID primary key)
- `roomId` (FK to Room)
- `nickname`
- `isLeader`
- `joinedAt`
- `leftAt` (nullable; null means active/away but present; non-null means fully left)

### 5.3 Round
Fields:
- `id`, `roomId`, `roundNumber`
- `psychicPlayerId` (nullable until accepted)
- `themeCustom` or `themePresetId` (nullable; chosen during `psychic_setting_theme`)
- `targetPosition` (float; randomly chosen by psychic on accept)
- `finalTeamGuess` (float)
- `score` (int)
- `status`: `selecting_psychic | psychic_setting_theme | guessing | revealed | complete`

### 5.4 Guess
Fields:
- `roundId`
- `playerId`
- `position` (team needle position used for that player’s guess)

### 5.5 ThemePreset
- Used for preset themes.

## 6. Gameplay Rules: Functional Requirements
This section defines gameplay behaviors as the server enforces them.

## 6.1 Room Lifecycle
### 6.1.1 Create Room
Requirement:
- Leader creation starts in `Room.status = lobby`.
- A leader `Player` is created with `isLeader = true`.
- A signed token is returned for the leader to connect via Socket.IO.

Server constraints:
- Rate limiting is applied to `POST /api/rooms`.
- Room codes are unique; the create endpoint retries on uniqueness collisions.

### 6.1.2 Join Room
Requirement:
- Joining creates a `Player` with `isLeader = false`.
- If the room is already `in_round` or `between_rounds`, the runtime `playerOrder` is updated to include the new player.

### 6.1.3 Start Game
Trigger:
- Socket event `leader:start_game`.

Rules:
- Only the leader can start.
- Room must be in `lobby`.
- At least 2 active players must exist.

Effects:
- `Room.status` becomes `in_round`.
- A `Round(1)` is created with status `selecting_psychic`.
- Runtime state is initialized for the room:
  - `playerOrder` is shuffled.
  - `psychicBaseIndex` set randomly.
  - needle/dominion reset.
  - lock set cleared.

### 6.1.4 Next Round
Trigger:
- Socket event `leader:next_round`.

Rules:
- Round must be `revealed` to proceed.

Effects:
- In a DB transaction:
  - Current round transitions `revealed -> complete`.
  - A new round is created with `selecting_psychic`.
  - `Room.status` transitions `between_rounds -> in_round`.
- Runtime state resets for the new round:
  - countdown cleared
  - dominant holder cleared
  - locked guessers cleared
  - psychic rotation base advanced

### 6.1.5 End Game
Trigger:
- Socket event `leader:end_game`.

Effects:
- `Room.status` becomes `closed`.
- Runtime is deleted for that room.

## 6.2 Round Lifecycle
### 6.2.1 Selecting Psychic
Round status:
- `selecting_psychic`.

Trigger:
- Socket event `psychic:accept` by the current psychic candidate.

Rules:
- Must be the correct candidate based on runtime rotation indices.
- If invalid phase or wrong player, server throws.

Effects:
- The round transitions to `psychic_setting_theme`.
- `psychicPlayerId` is set.
- `targetPosition` is set randomly.

Trigger:
- `psychic:skip`.

Effects:
- Candidate rotation index is advanced; if cycle wraps, forced accept may occur.

### 6.2.2 Psychic Setting Theme
Round status:
- `psychic_setting_theme`.

Trigger:
- Socket event `psychic:set_theme`.

Rules:
- Only the psychic can set theme.
- Phase must be `psychic_setting_theme`.
- The theme input is validated via schema.

Effects:
- Round transitions to `guessing`.
- Theme is stored in `themePresetId` or `themeCustom` (JSON string).
- Runtime needle and locks reset to prepare guessing phase.

## 6.3 Guessing Phase: Needle Dominion and Collaborative Movement
Round status:
- `guessing`.

### 6.3.1 Needle Dominion (Exclusive Control)
Trigger:
- `player:needle_claim`.
- `player:needle_letgo`.

Rules:
- Psychic can never claim dominion.
- A player can claim dominion only if:
  - Not psychic.
  - The player is not in `lockedGuessers`.
  - No other dominion holder exists (or the caller already has it).
- Releasing dominion sets `needleDominionPlayerId = null` and increments `needleDominionSeq`.

Non-functional correctness:
- Dominion transitions are exposed via `room:needle_dominion` and guarded on the client by `needleDominionSeq` monotonicity.

### 6.3.2 Needle Movement Updates
Trigger:
- `player:needle_move`.

Input validation:
- `{ position: number, playerId: string }`.

Rules:
- Round must be in `guessing`.
- Caller must not be psychic.
- Caller must not be in `lockedGuessers`.
- Caller must be the current dominion holder.

Performance:
- Server uses an EPSILON threshold to avoid unnecessary broadcasts when the needle doesn’t meaningfully move.

Correctness:
- When a meaningful needle move occurs:
  - `teamNeedle` and `needleSeq` update.
  - Locks are invalidated only for currently-online locked guessers:
    - The lock set is partially cleared based on `socketByPlayer.has(id)`.
    - Server emits `room:locks_updated` immediately so lock/unlock UI updates are not delayed behind full `room:state` fan-out.
  - Countdown cancellation happens only if the needle movement is meaningful.

### 6.3.3 Stale Needle Packets (Cross-Round)
Correctness invariant:
- `room:needle` carries `roundId`.
- The client stores `state.round.id` and ignores `room:needle` packets with mismatched `roundId`.

This prevents old packets from a prior round causing brief incorrect needle positions.

## 6.4 Guess Confirmation: Lock/Unlock and Countdown
### 6.4.1 Lock Guess
Trigger:
- `player:lock_guess`.

Rules:
- Round must be in `guessing`.
- Psychic cannot lock.
- Player is added to `lockedGuessers`.
- If the player locks while holding dominion, dominion is released to allow others to move.

Countdown start criteria (authoritative):
- Server evaluates online eligibility:
  - It builds `guesserIds` from DB players with `leftAt = null`.
  - It filters to `onlineGuesserIds` by `rt.socketByPlayer.has(id)`.
  - It requires:
    - `onlineGuesserIds.length > 0`
    - every `onlineGuesserId` is present in `rt.lockedGuessers`.

Countdown scheduling:
- If criteria is satisfied and no countdown timer is active:
  - Start a 3.5-second timer.
  - Broadcast `room:countdown_start`.

Cohort Snapshot:
- At countdown start, the server snapshots `lockedGuesserIdsSnapshot = [...onlineGuesserIds]`.

### 6.4.2 Unlock Guess
Trigger:
- `player:unlock_guess`.

Rules:
- Round must be in `guessing`.
- Psychic cannot unlock.
- Player is removed from `lockedGuessers`.

Effects:
- If a countdown was active, it is cancelled and the server broadcasts `room:countdown_cancel`.

## 6.5 Reveal Phase and Scoring
### 6.5.1 Countdown Reveal Trigger
When the timer fires, the server calls:
- `executeCountdownReveal(roomId, lockedGuesserIdsSnapshot)`.

### 6.5.2 Reveal Idempotency and Concurrency Hardening
Correctness invariant:
- Reveal is DB-idempotent and race-safe:
  - The reveal attempts to transition `Round.status` from `guessing -> revealed` using a conditional `updateMany`.
  - Only the first transaction that successfully performs the transition writes guesses and updates room status.
  - Concurrent reveal attempts become no-ops.

### 6.5.3 Scoring Cohort Semantics (Away/Disconnected Rules)
Your gameplay rules are enforced as follows:

1. Offline-at-countdown-start players do not get points for that round.
   - The snapshot includes only guessers that were online at countdown start.

2. Players who were online at countdown start can disconnect and still get points.
   - They are part of the snapshot already, and the reveal uses that snapshot filtered by still-active players at reveal time.

3. Fully leaving players do not get points for that round.
   - If `Player.leftAt != null`, they are not active at scoring time and will not be included.

## 6.6 Away and Disconnect Semantics (Locks and Points)
This system explicitly distinguishes:
- Disconnect/away: socket lost, `leftAt` remains null.
- Leave game: `leftAt` is set.

### Lock Requirements During Guessing
- Moving the needle invalidates locks only for currently-online locked guessers.
- Away players are not required to be locked for countdown eligibility while they are away. If an away player was already locked and included in the cohort snapshot, they do not need to re-confirm after disconnecting.

### Points Requirements During Scoring
- Countdown cohort is based on online status at countdown start.
- If a player is away when countdown starts, they do not get points for that round.

## 7. Network/API Contract: Functional Requirements
## 7.1 REST API Contract
### Create Room: `POST /api/rooms`
Input:
- JSON `{ nickname: string }`.

Output:
- `{ room: { id, code, status }, player: { id, nickname, isLeader }, token }`.

Requirements:
- Rate limited per IP.
- Generates a unique code; retries on code uniqueness collisions.

### Join Room: `POST /api/rooms/join`
Input:
- JSON `{ code, nickname }`.

Requirements:
- Rate limited per IP.
- Room must exist and not be `closed`.
- Returns signed token for the new player.

### Reconnect: `POST /api/rooms/reconnect`
Input:
- JSON `{ token }`.

Output:
- `{ room: { id, code, status }, player: { id, nickname, isLeader } }`.

Requirements:
- Token must be valid and match room.

## 7.2 Socket.IO Auth
Auth:
- Token must be included in `socket.handshake.auth.token` or `socket.handshake.query.token`.

Requirements:
- Unauthorized sockets are rejected.

## 7.3 Socket Event Contract (Client -> Server)
The following events are handled:
- `leader:start_game`
- `leader:next_round`
- `leader:end_game`
- `psychic:accept`
- `psychic:skip`
- `psychic:set_theme` (validated)
- `player:needle_move`
- `player:needle_claim`
- `player:needle_letgo` (validated)
- `player:lock_guess`
- `player:unlock_guess`
- `player:leave`

Input validation requirements:
- `player:needle_move` uses `zod` schema: clamp to `[0,1]`.
- `psychic:set_theme` uses discriminated union schema.

## 7.4 Socket Event Contract (Server -> Client)
The following broadcasts are emitted:
- `room:state` (per player, includes `roomStateSeq`)
- `room:refresh` (room-wide)
- `room:closed`
- `room:needle_dominion` (includes `needleDominionSeq`)
- `room:needle` (includes `needleSeq` and `roundId`)
- `room:locks_updated` (includes `lockedIds`, `lockSeq`, and `roundId`)
- `room:countdown_start`
- `room:countdown_cancel`

Client monotonic guards:
- Ignore stale `room:state` using `roomStateSeq`.
- Ignore stale needle packets using `needleSeq`.
- Ignore cross-round needle packets using `roundId`.
- For `room:locks_updated`, ignore mismatched `roundId` and stale `lockSeq`.

## 8. Correctness Invariants (Core Philosophy)
This section captures the “philosophy” we’ve been applying:

## 8.1 Deterministic authorization and phase gating
Only the correct actor can perform phase-specific actions, and only during the correct round/room status.

## 8.2 Invariants are rechecked after awaits
Anywhere server code awaits between:
- checking countdown state, and
- arming or modifying reveal logic,
the logic must re-check to avoid stale timer arms.

## 8.3 Idempotency and race hardening at persistence boundaries
Reveal is DB-idempotent via conditional `Round.status` transition.

## 8.4 Monotonic sequencing for out-of-order packet tolerance
- `room:state` uses monotonic `roomStateSeq`.
- `room:needle` uses monotonic `needleSeq`.
- `room:locks_updated` uses monotonic `lockSeq`.
- On round transition (`roundId` change), client resets per-round sequence guards (`needleSeq`, `lockSeq`, `needleDominionSeq`) immediately in the socket handler to avoid dropping valid early packets from the new round.

## 8.5 Away/disconnect semantics are explicit and consistent
- Disconnect does not require re-confirmation for lock purposes for players who were already online and locked at countdown start; however, countdown eligibility and scoring depend on being online at countdown start.
- Scoring depends on online-at-countdown-start snapshot.
- Full leave removes the player from lock set and from active scoring eligibility.

## 9. Non-Functional Requirements
## 9.1 Security Requirements
- Token-based authentication for Socket.IO.
- Input validation for socket event payloads via `zod`.
- Rate limiting on REST endpoints.
- CORS origin restrictions in production.

## 9.2 Scalability and Deployment Constraints
- The runtime uses in-memory `RoomRuntime` state.
- Horizontal scaling requires:
  - sticky sessions for Socket.IO,
  - and/or a shared adapter/runtime for correctness.
- Without a shared adapter/runtime, multiple Node instances may produce divergent runtime state.

## 9.3 Reliability and Observability
- Server uses structured logging (`src/lib/logger.ts`).
- Client displays `error:msg` messages for failed operations.

## 9.4 Performance Requirements
- Needle updates avoid spamming broadcasts using EPSILON thresholds.
- Client throttles outgoing `player:needle_move` calls via `requestAnimationFrame`.
- `room:state` stamping reduces UI regressing due to out-of-order async broadcasts.

## 9.5 User Experience Requirements
- UI should not deadlock: optimistic lock UX is cleared when server reports an error or server truth arrives.
- Reconnect should not create duplicate dominion/lock chaos (socket de-dup on reconnect).

## 10. Test Blueprint (What to Add Next)
Even if you add no tests today, this blueprint turns the rules into a measurable acceptance suite.

## 10.1 Unit Tests (Server-side)
Recommended unit test targets:
- `executeCountdownReveal` idempotency:
  - multiple concurrent calls -> exactly one reveal transition
  - guesses/score consistent with single winner
- Lock invalidation behavior:
  - meaningful needle move clears only online locked guessers
  - non-meaningful needle move does not change locks or countdown
- `setTeamNeedle` EPSILON + force path:
  - force final needle on let-go updates runtime even if delta is tiny
  - force does not incorrectly cancel countdown unless the update counts as meaningful per current semantics
- `player:lock_guess` countdown eligibility:
  - countdown does not start when online set is empty
  - countdown starts only when every online guesser is locked
- Snapshot scoring semantics:
  - a player away at countdown start is excluded
  - a player disconnecting after countdown start is included
  - a player fully leaving is excluded
- Stale packet guards:
  - ensure `room:needle` includes `roundId`
  - ensure client ignores mismatched roundId
  - ensure `room:locks_updated` includes `roundId` + `lockSeq`
  - ensure round transitions reset local per-round sequence guards before processing new-round packets

## 10.2 Integration Tests (Socket.IO + DB)
Recommended scenarios:
- Full end-to-end round:
  - leader start -> psychic accept -> set theme -> guessing -> lock -> countdown -> reveal -> next_round -> complete
- Away during guessing, needle move:
  - one player disconnects (socket lost but leftAt null)
  - verify countdown still starts based on currently-online online set (snapshot semantics)
- Countdown starts before reconnection:
  - away player does not receive points for that round
- Countdown starts while online:
  - away player disconnects after arming -> still gets points
- Multiple reveal fires:
  - simulate multiple countdown callbacks -> one reveal only
- Reconnect duplicate sockets:
  - connect twice for same player -> old socket disconnected -> no duplicate client event handling

## 11. Open Questions / Explicit Gaps
This spec intentionally documents what is currently enforced. Some gaps remain:
- Server restart behavior: what happens to in-flight countdowns and runtime-only state after process restarts.
- Horizontal scaling correctness guarantees (requires explicit adapter strategy).
- Client reconnection UX: the REST reconnect endpoint exists, but client usage may still be incomplete.

If you want, we can turn this doc into an executable spec by:
1. creating a test harness (socket+DB),
2. writing integration tests for the acceptance scenarios above,
3. adding property tests for invariants (monotonic seq and snapshot rules).

