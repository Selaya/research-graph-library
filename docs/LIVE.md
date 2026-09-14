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
const run = g.run({ mode: "live", minHopMs: 120 });   // shortest visible crossing (below)
const run = g.run({ mode: "live", now: 60000 });      // explicit frontier epoch (below)
const run = g.run({ mode: "live", spawnOnStart: false }); // strict start() (below)
```

| option | default | does |
|---|---|---|
| `hopMs` | `300` | How long a token takes to cross an edge on screen. |
| `minHopMs` | `0` | Shortest crossing a hop may be squashed to when a `start()` claims it mid-flight — see **Timestamps with no hop**. Clamped to `hopMs`. |
| `log` | `[]` | Seed the event log. The frontier floors on its span. |
| `now` | — | Explicit frontier epoch in ms — see **Reconnect and persistence**. |
| `spawnOnStart` | `true` | Whether a bare `start()` may mint a token where nothing is waiting — see **Where a token comes from**. |

Remember the replacement rule from `docs/RUN.md`: `g.run(anyOpts)` always tears down
whatever transport is currently attached and builds a new one — including switching an
existing Mode A run into Mode B. `g.run()` (no argument) reuses whatever is already there.

## The primitive surface

All five primitives append to the log and return the **stamped time** — the instant, clamped
to `[0, frontier]`, the entry actually landed at (`o.at` if given and in range, else the
frontier). None of them ever throws; each has its own diagnostics (below).

```js
run.start(id, { at?, spawn? });               // node goes active
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
| `state()` | `RunState` | `replayLive(spec, log, time())` — same shape as Mode A's `stateAt(t)`, see `docs/RUN.md`, plus the live-only `waiting`/`active`/`overBudget` on each node entry (below). |
| `sim()` | `Sim`-shaped | `{ duration: frontier, events: log (copy), stateAt }` — for code written against both modes' `sim()` uniformly. |
| `log()` | `LiveEvent[]` | A **copy** of the full event log, in insertion order. |
| `options()` | `object` | `{ hopMs, mode: "live", now, log }` (plus `minHopMs` / `spawnOnStart` when set) — carries the whole log and the frontier epoch, not just compile inputs, so a snapshot/restore round-trips history losslessly. |
| `reset(opts, time?)` | `number` | Re-seeds the log (`{ log, now, replay }`) under the **same** transport identity/listeners — see **Reconnect and persistence**. |
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

## Where a token comes from

`state().nodes[id]` splits its occupancy in live mode: `waiting` (arrived, nothing working
on it yet — including an arrival a join is still holding) and `active` (an explicit
`start()` picked it up and it is dwelling). `waiting + active === occupancy`.

```js
const n = run.state().nodes["enrich"];   // { status, progress, occupancy, waiting, active, overBudget }
```

`start(id)` normally *picks up* a waiting occupant — or claims a hop still crossing towards
the node. Where there is nothing to pick up it mints a token instead, which is exactly right
on a **root** (nothing points at it, so that is how a live run seeds itself) and a footgun
anywhere else: a phantom unit of work nothing produced. "Root" means what the engine means
by it: a `loop: true` edge, a self-edge and the back edge of an untagged cycle do not feed
their target, so a graph drawn as a feedback pair still has a root to seed. So a `start()`
on a non-root that

- has no `waiting` occupant, and
- has no token crossing towards it, and
- is not `'done'` or `'failed'` (restarting either is the retry / live loop iteration),

warns, and names the way to say you meant it:

```
[smv:live] start("deploy") — nothing is waiting on "deploy" and it is not a root, so this
mints a token out of nothing. Pass { spawn: true } if that is what you mean.
```

`run.start("deploy", { spawn: true })` mints it silently. `g.run({ mode: "live",
spawnOnStart: false })` goes further: the warned-about start does nothing at all — not even
a log entry — so only real arrivals and deliberate `{ spawn: true }` calls put tokens on
non-root nodes.

## Joins

A fan-in behaves as it does in Mode A: arrivals are **counted**, and one token is released
when the policy is met. Two arrivals at an implicit AND-join are one occupant, so a bare
`finish()` there hands **one** token downstream, not one per arrival.

```js
// A -> J <- B, no `join` declared: the implicit AND-join over J's two in-edges
run.finish("A"); run.finish("B");        // two arrivals...
run.state().nodes.J.occupancy;           // ...one occupant
run.start("J"); run.finish("J");         // ...and one token onto J's out-edges
```

- The policy is the same one `docs/RUN.md` documents: no `join` and 2+ non-loop in-edges is
  an AND-join over all of them; `join: "any"` needs one; `join: { count: k }` needs `k`.
- Arrivals that have not made a group yet are **held**: they occupy the node (the `×N` badge
  and `waiting` count them, the join pips fill) but nothing is released.
- Unlike Mode A the join **re-arms**: every further group of `needed` arrivals releases
  another token, which is what a long-running fan-in needs.
- `state().joins[id]` still reports `{ arrived, needed, fired }` for the first group only —
  `arrived` saturates at `needed`, `fired` stays true once it has fired.
- The log outranks the policy: an explicit `start(id)` activates a held arrival anyway (or
  claims a hop still crossing towards the node), and `finish`/`fail` consume whatever is on
  the node. That arrival still **counts into the group it belonged to**: the partners that
  land afterwards complete that group and merge into the work already standing on the node,
  so a 2-input AND-join that received two arrivals hands one token downstream however early
  its `start()` was stamped. `spawn()` is an explicit injection — it is never held by, and
  never counted into, a join.
- A `finish()` on a join that has **not** fired yet — the normal live shape, one slow branch
  still outstanding — consumes the arrivals it is holding as **one** piece of work and hands
  a single token downstream, never one per arrival.

## Durations are expectations, not a schedule

`data.duration` does **not** pace a live run — there is no schedule in Mode B, the log is the
only truth. It does exactly two things: it paces the node's progress fill while the node is
active (so a step with a declared 2s dwell fills over 2s, capped just short of full until the
real `finish()` lands), and the pipeline preset draws it as the node's chip. A node with no
declared duration simply shows no fill; its pulse and status carry it.

The one judgement a declared duration makes is **over budget**: once a live dwell has run
longer than it, `state().nodes[id].overBudget` is `true` and the renderer marks the node
`data-over-budget` (styled as a dashed warning boundary, composing with whatever `data-run`
tint the node already has). It survives the `finish` that closed the over-long dwell — the
step really did overrun — and a fresh `start()` on the node clears it, judging the new
attempt on its own. "Fresh" is about the unit of work, not about the node being idle: a
`start()` that picks up an arrival (or mints a token) from at or after the moment the
overrun ended is a new attempt and clears the flag, while one that picks up work which was
already sitting on the node while the overrun ran is concurrent with it and leaves the
verdict standing.

```css
/* your own reading of it, if the default boundary is not the one you want */
.smv-node[data-over-budget] rect.smv-node-box { stroke: crimson; }
```

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

[smv:live] start("deploy") — nothing is waiting on "deploy" and it is not a root, so this
mints a token out of nothing. Pass { spawn: true } if that is what you mean.
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

## Timestamps with no hop

In a real trace a parent's dispatch instant *is* the child's start instant, so a log built
from spans stamps `finish(parent, { at: T })` and `start(child, { at: T })` at the same ms.
A `start()` claims the hop that is still crossing towards it (rather than fabricating a
second token), and with both stamped at `T` that crossing collapses to zero length: the
token teleports between activations.

`minHopMs` is the shortest crossing such a claimed hop may be squashed to:

```js
const run = g.run({ mode: "live", hopMs: 300, minHopMs: 120 });
run.finish("gateway", { at: t });
run.start("pricing", { at: t });   // still shows 120ms of wire before pricing goes active
```

The claimed start is pushed out to `hop start + minHopMs` — so the node goes `'active'` when
the crossing finishes, not when the log said. It is clamped to `hopMs` (a minimum can never
outlast the hop it shortens), it only applies to a hop that is still in the air, and it
defaults to `0`, which is the old collapse-on-claim behaviour exactly.

Real spans are routinely *shorter* than a sensible minimum hop, so a `finish()` (or `fail()`)
often lands inside the window the `start()` it follows opened. That terminal event waits for
the landing: the node keeps reading `'pending'` with its token visibly on the wire, and goes
straight to `'done'`/`'failed'` when the crossing completes. The dwell collapses — with
`minHopMs` you are trading dwell time for wire time — but nothing is ever painted finished
while its token is still crossing.

## Reconnect and persistence

The whole state is the log — persist it, and `reset()` replays it back onto a fresh (or the
same) transport:

```js
// periodically, or on visibilitychange/beforeunload:
localStorage.setItem("pipeline-log", JSON.stringify(run.log()));

// on reconnect / page load:
const saved = JSON.parse(localStorage.getItem("pipeline-log") || "[]");
run.reset({
  log: saved,
  mode: "live",
  now: Date.now() - t0,   // the epoch: how far this session's clock has actually got
  replay: true,           // re-emit the seeded entries through run.on(...)
});
run.follow();                              // jump straight to "now" if that's what you want
```

`reset()` re-seats the **same** run object — same identity, same listeners — so anything
already subscribed with `run.on(...)` keeps working across the restore; only the log and the
frontier change. `time` (the second argument) defaults to 0, so the restored view starts
detached, at the beginning of the restored history.

- **`now`** is an explicit epoch for the frontier, in ms. Without it the frontier restarts at
  the seeded log's own span (its latest timestamp) — right for a log you saved a moment ago,
  wrong when the session has been running for minutes: every later event stamped `{ at }`
  from the server clock would be clamped back onto that span, landing "a few hundred ms ago"
  instead of where it happened. Pass the same `now` you would compute for an `{ at }` stamp
  and the two agree. The frontier is always at least the seeded log's span.
- **`replay: true`** pushes every seeded entry back through this handle's emitter as it is
  re-seeded, in log order, so UI beats that hang off `run.on('fail' | 'start' | …)` rebuild
  from restored history instead of only from the entries that arrive afterwards. Each
  payload carries `replay: true` alongside its usual `{ id, t, n?, reason? }`, so a listener
  can tell history from news. Without the flag `reset()` is silent, as it always was.

`options()` carries `now` (plus `log`, `hopMs`, `minHopMs`, `spawnOnStart`), so a storyboard
snapshot/restore pair round-trips the frontier as well as the history.

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
