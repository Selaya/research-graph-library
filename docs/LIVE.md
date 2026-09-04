# Mode B: live runs

`g.run({ mode: "live" })` replays a real, append-only event log instead of a compiled
schedule — the graph animates as things *actually happen*, fed by whatever wiring you have
(a WebSocket, SSE, polling a job queue). This is the deep reference for that mode; the
README's API section is the summary, and `docs/RUN.md` covers Mode A (simulated durations).

## Mental model: two clocks

A live run owns two clocks:

- **The frontier** (`run.now()`) — real elapsed ms since the run was created (or re-seeded).
  It advances on **every** tick, unconditionally: paused, mid-scrub, or idle, live time keeps
  flowing, because a real pipeline does not wait for a viewer.
- **The view clock** (`run.time()`) — what is actually being drawn. While `run.following` is
  true (the default), it is glued to the frontier every tick: the view is just watching the
  frontier happen. `run.seek(ms)` detaches it (time-travel into history, clamped to
  `[0, frontier]` — you can never scrub past "now"). `run.play()` catches the view back up to
  the frontier at 1× (`speed()` scales the catch-up rate); `run.follow()` snaps back
  immediately, no ramp.

Because both clocks advance at 1× when following, `play()` from a detached position only
*catches up* — it does not fast-forward past the frontier. `follow()` is the "jump to live"
primitive; reach for it, not `seek(run.now())`, when you just want back to the front.

## Creating a live run

```js
const run = g.run({ mode: "live" });                 // starts empty, frontier at 0
const run = g.run({ mode: "live", log: savedLog });   // re-seeded — see Reconnect below
const run = g.run({ mode: "live", hopMs: 400 });      // edge-crossing time for hop fills
```

Remember the replacement rule from `docs/RUN.md`: `g.run(anyOpts)` always tears down
whatever transport is currently attached and builds a new one — including switching an
existing Mode A run into Mode B. `g.run()` (no argument) reuses whatever is already there.

## The primitive surface

All five primitives append to the log and return the **stamped time** — the instant, clamped
to `[0, frontier]`, the entry actually landed at (`o.at` if given and in range, else the
frontier). None of them ever throws; each has its own diagnostics (below).

```js
run.start(id, { at? });                      // node goes active
run.finish(id, { at?, n? });                  // n occupants leave (default: all); fans out
run.fail(id, { at?, reason? });               // ALL occupants leave; nothing fans out
run.spawn(id, n, { at? });                    // n tokens land on id, waiting (no dwell yet)
```

- **`finish(id, { n })`** is a *partial* fan-in release: with `n` given, only that many of
  the node's current occupants finish (and fan out); the rest stay. Omit `n` to finish
  everyone currently on the node.
- **`fail(id, { reason })`** has **no `n`** — a failure is never partial. It consumes *every*
  current occupant and emits nothing downstream: the branch dies at that node. `reason` is
  optional annotation carried on the log entry and the bus event; replay never reads it back.
- A node parked on `'failed'` is **not** cleared by a token merely arriving at it — only an
  explicit `start(id)` retries it (see **Retrying a failed node**, below). This is
  deliberately asymmetric with `'done'`, which *does* reset to `'pending'` on a fresh
  arrival (D4 M2: "target stays pending until its own start").

Everything else on the handle:

| method | returns | does |
|---|---|---|
| `pause()` | `number` | Stops advancing the view clock AND detaches it from the frontier (`following` becomes `false`) — the frontier itself keeps running underneath. |
| `follow()` | `number` | Re-attaches the view clock to the frontier immediately. |
| `seek(ms)` | `number` | Time-travel; clamps to `[0, run.now()]`; detaches (`following = false`). |
| `step()` | `number` | Jumps to the next logged event timestamp after the current view time, capped at the frontier. |
| `speed(factor, { branch? })` | `number` | Scales the **catch-up** rate of `play()`/the view clock. The frontier itself is real time and cannot be sped up. `branch` is a documented no-op in this mode — live mode has no per-token rate concept. |
| `play({ until? })` | `Promise<{canceled}>` | Advances the view clock toward the frontier (or, detached, resolves once `until`'s status is `'done'`/`'failed'`, or once the view catches the frontier if no `until`). |
| `timeOf(id)` | `number` | First `'finish'` or `'fail'` entry for `id` in the log; falls back to the frontier. |
| `following` (getter) | `boolean` | Whether the view clock is currently glued to the frontier. |
| `now()` | `number` | The frontier. |
| `time()` | `number` | The view clock. |
| `duration` (getter) | `number` | Alias for the frontier — Mode B has no fixed total, it grows. |
| `state()` | `RunState` | `replayLive(spec, log, time())` — same shape as Mode A's `stateAt(t)`, see `docs/RUN.md`. |
| `sim()` | `Sim`-shaped | `{ duration: frontier, events: log (copy), stateAt }` — for code written against both modes' `sim()` uniformly. |
| `log()` | `LiveEvent[]` | A **copy** of the full event log, in insertion order. |
| `options()` | `object` | `{ hopMs, mode: "live", log }` — carries the whole log, not just compile inputs, so a snapshot/restore round-trips history losslessly. |
| `reset(opts, time?)` | `number` | Re-seeds the log under the **same** transport identity/listeners — see **Reconnect and persistence**. |
| `on(type, fn)` / `off(type, fn)` | | Subscribe to `start`/`finish`/`fail`/`spawn` plus the shared transport events (`play`/`pause`/`seek`/`speed`/`step`/`tick`/`end`/`cancel`/`destroy`/`remap`) documented in `docs/RUN.md`. Live mode never emits `enter`/`join`/`drop`/`loop`/`warn`/`done`/`recompile` — those are Mode A's compiled-schedule events. |
| `destroy()` | `void` | |

### Retrying a failed node

```js
run.start("deploy");
run.fail("deploy", { reason: "connection refused" });
// ... later ...
run.start("deploy");   // the retry — re-activates the node, status back to 'active'
```

If a `loop: true` edge targets the retried node, this restart increments that loop edge's
iteration counter — exactly the rule that already applied to restarting a `'done'` node
("that restart *is* the live loop iteration," D4 M2). `state().loops[edgeId].iteration`
reflects it, capped at that edge's `maxIterations`.

## ID validation and self-healing

None of `start`/`finish`/`fail`/`spawn` throws on an unknown node id, or on `finish`/`n`
being non-numeric — the entry is still logged, but it has no effect on `state()` until a
matching node exists. Each case gets a `console.warn` instead, so the mistake is visible
without breaking the log:

```
run-transport: start("nope") — no node "nope" in the current graph; the event is logged
but filtered out of every state() unless "nope" is added later (self-heals).

run-transport: finish("deploy") — "deploy" has zero current occupancy; this finish() is a no-op.
run-transport: fail("deploy") — "deploy" has zero current occupancy; this fail() is a no-op.
run-transport: spawn("nope") — non-numeric n (undefined); ignored.
```

**Self-healing**: an id that doesn't exist yet when you log an event is not an error — it's
normal if your event stream and your graph spec arrive independently (a node the pipeline
hasn't declared to the UI yet, say). The moment a node with that id is added to the graph,
already-logged events for it become visible on the next `state()` sample, no replay needed.
The zero-occupancy warning on `finish`/`fail` catches the other common mistake — double
firing, or firing before the matching `start` — without corrupting anything either: the log
entry lands, it's simply a no-op against the current occupancy.

## Wiring a WebSocket

Stamp events with the **server's** timestamp via `{ at }`, not the client's receive time —
otherwise replay ordering depends on network jitter instead of what actually happened:

```js
const run = g.run({ mode: "live" });
const t0 = Date.now();   // this run's own "time zero," agreed with the server out of band

ws.onmessage = (msg) => {
  const { type, id, n, reason, ts } = JSON.parse(msg.data);
  const at = ts - t0;   // server timestamp, translated onto the run's own clock

  if (type === "start") run.start(id, { at });
  else if (type === "finish") run.finish(id, { at, n });
  else if (type === "fail") run.fail(id, { at, reason });
  else if (type === "spawn") run.spawn(id, n, { at });
};
```

`{ at }` is clamped to `[0, run.now()]` — a server timestamp that arrives ahead of the local
frontier (clock skew, a burst of buffered messages) gets pulled up to "now" rather than
rejected, so a batch of backlogged events compresses onto the current instant instead of
throwing. Keep `t0` fixed for the run's lifetime; re-derive it (and reset the run, see below)
only when you actually reconnect to a different session.

## Reconnect and persistence

The whole state is the log — persist it, and `reset()` replays it back onto a fresh (or the
same) transport:

```js
// periodically, or on visibilitychange/beforeunload:
localStorage.setItem("pipeline-log", JSON.stringify(run.log()));

// on reconnect / page load:
const saved = JSON.parse(localStorage.getItem("pipeline-log") || "[]");
run.reset({ log: saved, mode: "live" });   // time defaults to 0 — the restored view starts
                                            // detached, at the beginning of the restored history
run.follow();                              // jump straight to "now" if that's what you want
```

`reset()` re-seats the **same** run object — same identity, same listeners — so anything
already subscribed with `run.on(...)` keeps working across the restore; only the log and the
frontier change. The frontier restarts at the seeded log's own span (its latest timestamp),
so events you saved before disconnecting are immediately reachable the moment they're
re-seeded, not "in the future" relative to a frontier that starts at 0.

## Scale

`replayLive` (`src/run-live.js`) is a from-scratch reconstruction of state from the log every
time it's asked for a new `(time, log)` pair; it used to be O(n²)-ish in practice (an O(n)
array splice per insert, O(n) `indexOf` scans per hop) — this round it was rebuilt around
binary min-heaps and is O(n log n) in the log's size. Measured on a synthetic 50-node chain
(same shape `test/run-live-perf.test.js` builds), before → after:

| log size | before | after |
|---|---:|---:|
| 1,000 events | 11.96ms | 10.28ms |
| 8,000 events | 56.75ms | 24.28ms |
| 16,000 events | 820.11ms | 24.69ms |
| 40,000 events | 1996.95ms | 72.74ms |

Absolute numbers depend on your graph's shape and `hopMs`, but the shape of the change —
superlinear, then log-linear — holds generally: a run with a few thousand events is
effectively free; tens of thousands stays comfortably interactive. `state()` also memoizes
its last replay result, keyed on `(time, store revision, log revision)`, so an idle live
graph — following the frontier with nothing new happening — costs a comparison per frame,
not a re-replay.

## See also

- `docs/RUN.md` — Mode A (simulated durations), the shared `RunState` shape, and the event
  vocabulary both engines share on the transport side.
- `docs/PRESETS.md` — drawing decoration off `g.run().state()` or the `'runstatus'`/`'fail'`
  bus events, for either mode.
