# Mode A: simulated runs

`g.run(opts)` *compiles* a token schedule from declared durations and plays it back on the
shared ticker (D1/D4). One pass up front (`compileRun`, `src/run.js`) turns the spec into a
flat, time-sorted schedule; everything after that — `play`, `seek`, `step`, per-branch
`speed`, scrubbing — is just sampling that artifact, which is why all of it is cheap and all
of it is exact. This is the deep reference; the README's API section is the summary.

For a real event log instead of declared durations, see `docs/LIVE.md` (Mode B). For writing
your own decoration layer on top of either mode, see `docs/PRESETS.md`.

## Creating a run

```js
g.run();       // reuse the current transport, or create one with the last-used opts
g.run(opts);   // ALWAYS tear down the current transport and create a fresh one
```

`g.run()` with **no argument** returns the transport already attached to `g`, creating one
with default options only if none exists yet. `g.run(opts)` — even `g.run({})` — always
destroys whatever transport is attached and builds a new one from `opts`, at time 0. If you
just want to keep playing the run that already exists, call `g.run()`.

**Your listeners survive the recompile.** Everything you registered with `run.on(type, fn)`
is carried onto the fresh transport — the handle is conceptually the same run, and
re-attaching after every `g.run(opts)` was pure ceremony. `run.off(type, fn)` (and the
unsubscriber `on()` hands back) still drops it for good, from either handle. Methods are
not carried: the *old* object is destroyed, so call `play()`/`seek()` on the one
`g.run(opts)` returned (or just on `g.run()`).

Every run event is also mirrored onto the instance bus under a `run:` prefix, so a listener
registered on `g` outlives any number of recompiles — including ones a storyboard's own
`run` op does:

```js
g.on("run:finish", ({ nodeId }) => console.log(nodeId, "done"));
g.on("run:end", () => console.log("schedule over"));
```

`g.on("runstatus")` is the older, narrower channel (per-node status transitions, what the
ARIA layer listens to); `run:*` is the whole vocabulary below, verbatim.

`opts` (all optional): `{ iterations, rates, hopMs, dwell, mode }`. Omit `mode` (or pass
`"simulate"`) for Mode A; `mode: "live"` switches to Mode B (`docs/LIVE.md`). The Mode A
fields:

- `iterations: { [loopEdgeId]: n }` — override how many times a bounded loop edge iterates
  for this compile, capped at that edge's own `maxIterations`.
- `rates: [{ t, scope: nodeId | "*", factor }]` — pre-seed speed changes (see **Per-branch
  speed** below); `speed()` appends to this list and recompiles.
- `hopMs` — edge-crossing time in ms (default 300).
- `dwell(sec, ctx) => ms` — override the default dwell-time formula per node; return a
  non-negative finite number to use it, anything else falls back to the default. `ctx` is
  `{ id, node, maxSec, default }`.

## The run handle

Every method below is on the object `g.run(opts)` returns.

| method | returns | does |
|---|---|---|
| `play({ until? })` | `Promise<{canceled}>` | Runs the ticker forward. With `until: nodeId`, resolves the instant that node reaches `'done'` **or** `'failed'` — never hangs on a step that fails. Without it, resolves at the end of the schedule. Awaiting twice while already playing shares the same promise. |
| `pause()` | `number` (current `t`) | Stops the ticker hook; `play()`'s pending promise survives and resumes on the next `play()`. |
| `seek(ms)` | `number` | Jumps to `ms` (clamped to `[0, duration]`) without re-firing events already passed — a scrub is a state restore, not a replay (D8). |
| `speed(factor, { branch? })` | `number` | Appends a rate event at the current time and recompiles. `factor` multiplies dwell/hop time for every token from here on; `branch: nodeId` scopes it to tokens entering that node, omitted/`"*"` is global. `factor: 0` freezes a branch (this is how `step({token})` isolates one branch). |
| `step({ token? })` | `number` | Jumps to the next event boundary. No `token`: the next boundary across every token. `token: id`: that token's own next boundary (a join's fire time counts as a boundary for every token it consumed). |
| `timeOf(nodeId)` | `number` | First instant `nodeId` emits `'finish'` **or** `'fail'` — what a storyboard `run.play({until})` step is worth on the cumulative timeline. Falls back to `duration` if the node never does either. |
| `reset(opts, time?)` | `number` | Re-seats the *same* transport (same identity, same listeners) with new compile inputs, silently jumping to `time` (default 0) — used by storyboard restores, not something you usually call directly. |
| `reload()` | `number` | Forces a recompile against the live spec and returns the new `duration`. |
| `playing` (getter) | `boolean` | |
| `duration` (getter) | `number` | The compiled schedule's total ms. |
| `promise` (getter) | `Promise<{canceled}>` | The awaitable for whatever `play()` target is current; `pause()` never resolves it. |
| `time()` | `number` | Current virtual ms. |
| `state()` | `RunState` | `stateAt(time())` — see **Sampling a state** below. |
| `sim()` | `Sim` | The compiled artifact: `{ duration, events, boundaries, stateAt(t), nextBoundary(t, tokenId?) }`. |
| `options()` | `object` | The live compile inputs (`{iterations, hopMs, dwell, rates}`), for snapshotting. |
| `on(type, fn)` / `off(type, fn)` | `() => void` / `void` | Subscribe to transport and forwarded engine events — see **Event vocabulary**. |
| `destroy()` | `void` | Tears the transport down; `g.run(opts)` calls this on the outgoing transport automatically. |

### Sampling a state

`state()`/`sim().stateAt(t)` returns:

```js
{
  tokens: [{ id, rate, at: { kind: "node" | "edge", id, progress } }],
  nodes: { [id]: { status: "pending" | "active" | "done" | "failed", progress, occupancy } },
  edges: { [id]: { traversed } },       // 0..1
  joins: { [id]: { arrived, needed, fired } },
  loops: { [edgeId]: { iteration, max } },
  done: boolean,                        // false while any token is stalled (parked at an unfired join)
}
```

A `'failed'` node reports `progress: 1` and `occupancy: 0` — terminal like `'done'`, so its
fill never reads as "still going." A container's status/progress rolls up from its
descendants (union window; earliest failure wins): `play({until: containerId})` means "until
everything inside it is finished or has failed."

## Duration grammar

`data.duration` on a node: a number (already seconds) or a string matching
`([+-]?number)(unit)?` with optional whitespace — `ms | s | m | h | d`, case-insensitive.
A bare number-as-string (`"12"`) means seconds, same as the number `12`.

| input | seconds | valid? |
|---|---|---|
| `"2h"` | 7200 | yes |
| `"45m"` | 2700 | yes |
| `"8s"` | 8 | yes |
| `"300ms"` | 0.3 | yes |
| `"1.5h"` | 5400 | yes |
| `".25s"` | 0.25 | yes |
| `"12"` | 12 | yes (bare number, unit-less) |
| `12` (number) | 12 | yes |
| `" 2 h "` | 7200 | yes — surrounding/unit whitespace is tolerated |
| `"2H"` | 7200 | yes — units are case-insensitive |
| `"45mins"` | — | **no** — not a recognized unit |
| `"-5s"` | — | **no** — negative values are rejected outright |
| `-5` (number) | — | **no** — same rule for the numeric form |
| `"abc"` | — | **no** — not a number at all |
| `true` / `{}` / other non-string, non-number | — | **no** |
| absent (`data.duration` never set) | — | *silent* — this is not a warning case, see below |

**A node with no `data.duration` at all is silent** — that's the normal "no declared
duration" case, and it dwells for the default 600ms. **A node whose `data.duration` is
*present but fails to parse*** — bad grammar, a negative value, or a non-string/non-number —
is different: `compileRun` falls back to the same 600ms default, but says so, once per node
per compile:

```
compileRun: node "ingest" has an unparseable duration ("45mins"); falling back to the 600ms default
```

...and pushes a `{ t: 0, type: "warn", nodeId, message: "unparseable duration", value }`
event into `sim().events`, which the transport re-emits on the run bus by type — so
`run.on("warn", ({nodeId, value}) => ...)` catches it with no extra plumbing. Negative values
used to parse silently (`"-5s"` → `-5`), which could give a dwell segment with `t1 < t0` and
corrupt the time-sorted event order (a node reporting `'done'` before it reported
`'active'`); they now reject-and-warn instead of clamping, so the mistake stays visible
rather than getting silently coerced to 0 or 5.

## Declared failure: `data.fail`

The declarative counterpart to Mode B's `run.fail(id)`. A node's `data.fail`, if truthy,
makes that step run its full dwell and then **fail** instead of finishing: status
`'failed'`, no `'finish'` event, no loop, no fan-out to its successors — the branch dies
there rather than handing anything downstream.

```js
{ id: "deploy", data: { duration: "8s", fail: "exit code 137" } }
```

A string value is carried through as the emitted `'fail'` event's `reason` (annotation
only — nothing in the engine reads it back). `data.fail: true` fails with no reason. A
container can't carry `data.fail` itself (it's never an executable step, D5); if one of its
descendants fails, the container's own status rolls up to `'failed'` at that descendant's
failure instant, same as its `'done'` window rolls up from its children's windows.

```js
const sim = compileRun(spec);           // or: g.run().sim()
const fail = sim.events.find((e) => e.type === "fail");
fail.nodeId;   // the node that failed
fail.reason;   // undefined if data.fail was `true`
```

A sibling branch that never touches the failed node completes normally; an AND-join fed
partly by the failing branch never fires (pre-existing "unsatisfiable join" behavior — not
something `fail` changes) and the run reports `done: false` (stalled) because a token is
still parked there waiting.

## Join semantics

A node with 2+ non-loop in-edges and no `join` declared is an implicit AND-join (`needed =
expected`, where `expected` is its non-loop in-edge count) — the mirror of implicit fan-out.
Declare `join` to change that:

```js
{ id: "merge", join: "all" }              // needed = expected (the default, made explicit)
{ id: "merge", join: "any" }              // needed = 1 — first arrival fires it
{ id: "merge", join: { count: 2 } }       // needed = clamp(2, 1, max(expected, 1))
```

Arrivals after the policy has already fired are dropped (ghost-faded by the renderer) and
emit a `'drop'` event; `joins[id].fired` flips `true` at the fire instant and stays true.

**`'all'`** — three branches feeding one join, all required:

```js
const spec = {
  nodes: [{ id: "a" }, { id: "x" }, { id: "y" }, { id: "z" }, { id: "merge" }],
  edges: [
    { id: "ax", source: "a", target: "x" }, { id: "ay", source: "a", target: "y" },
    { id: "az", source: "a", target: "z" },
    { id: "xm", source: "x", target: "merge" }, { id: "ym", source: "y", target: "merge" },
    { id: "zm", source: "z", target: "merge" },
  ],
};
// merge.join is undeclared, expected = 3 -> implicit "all": needed = 3, fires only once
// x, y AND z have all arrived.
```

**`'any'`** — a race, first branch to arrive wins and the rest ghost-fade:

```js
{ id: "merge", join: "any" }
// needed = 1: whichever of x/y/z lands first fires `merge`'s dwell; the other two arrivals
// emit 'drop' and their tokens end there.
```

**`{ count: k }`** — a quorum:

```js
{ id: "merge", join: { count: 2 } }
// needed = 2 of the 3 incoming branches (clamped to [1, expected]); the third arrival drops.
```

## Bounded retry loops

A `loop: true` edge with `maxIterations > 0` is a back edge the layout renders as a loop-back
arc, not an ordinary in-edge (it's excluded from join arity and from a plain untagged cycle's
zero-iteration treatment):

```js
{ id: "retry", source: "check", target: "deploy", loop: true, maxIterations: 5 }
```

A token finishing dwell at the loop edge's **source** node (`"check"` above) checks for an
unconsumed loop edge before falling through to implicit fan-out. If it has one and
iterations remain, it crosses the arc to the edge's **target** (`"deploy"`) once, visually —
iteration 1, a real edge-crossing hop — then every further iteration is a compressed 250ms
in-place tick hosted on that same target node (never a re-fly of the arc), emitting `'loop'`
`{edgeId, nodeId, iteration, max}` each time. Once the iterations run out, the token
continues through the loop **source's** own normal out-edges — the retry never re-runs the
target's actual dwell, it only ticks there visually; whatever comes after the retrying step
hangs off the source node's other out-edges, not the target's. `state().loops[edgeId]` gives
you `{ iteration, max }` for an iteration badge (`iter 3/5`); pass
`opts.iterations: { retry: n }` to `g.run(opts)`/`speed`-driven recompiles to cap a
particular play at fewer than `maxIterations`.

Because the in-place tick has nothing to re-stage, a story where later iterations should
look different (a different result, a different branch taken) has to be narrated
reactively off `run.on('loop', ...)` rather than declared as a storyboard step — see the
README's "Retry loops" callout for the pattern, and docs/PLAN.md (D18) for a proposed
`replay` mode that would re-simulate the subgraph per iteration instead.

## Per-branch speed

```js
g.run().speed(2);                    // everything from here on runs 2x
g.run().speed(0.5, { branch: "clean" });  // only tokens entering "clean" slow to half
g.run().speed(0, { branch: "build" });    // freeze that branch in place
```

`speed()` appends a `{t, scope, factor}` rate event and recompiles; a token folds a rate in
exactly once, the moment it *enters* a node the rate applies to — already-elapsed dwell time
never retroactively changes, and children spawned after inherit the rate their parent had.
`step({token})` is built on this: it sets that token's rate to 0, isolating it. Mode B has no
equivalent — `branch` is a documented no-op there (see `docs/LIVE.md`).

## Driving a run from a storyboard

Five storyboard ops reach the run, so the whole arc can live in the declared timeline
(`g.cues()` and `smv-fit` see it) instead of in an `sb.on("step")` handler:

| step | equals |
|---|---|
| `{ op: "run", args: [opts] }` | `g.run(opts)` — recompile. Omit `args` to recompile with the opts the run already has. Listeners survive it. |
| `{ op: "run.reset", args: [opts?] }` | `run.reset(opts ?? run.options(), 0)` — the SAME transport, back at t = 0, keeping its identity, its listeners and (Mode B) its log. |
| `{ op: "run.play", until? }` | `run.play({until})` — the only op the sequencer awaits. |
| `{ op: "run.step", token? }` | `run.step({token})` |
| `{ op: "run.seek", ms }` | `run.seek(ms)` |

`run` and `run.reset` are discrete flips: zero duration on the cumulative timeline, and
they put the run's clock back to 0, so the next `run.play` step is priced from there.

```json
{ "op": "run", "args": [{ "iterations": { "retry": 1 } }] },
{ "op": "run.play", "until": "deploy" },
{ "op": "caption", "args": ["Retry once more, with the flag flipped."] },
{ "op": "run", "args": [{ "iterations": { "retry": 3 } }] },
{ "op": "run.play" }
```

The fluent builder spells these `runCompile(opts)`, `runReset()`, `run({until})` (kept as
`run.play`, which is what it has always meant), `runStep()` and `runSeek(ms)`.

**Limitation — one compile per cue sheet.** A `run.play` step is priced off the *compiled*
transport (`run.timeOf(until)`), and only one compile is live at a time. So in a script like
the one above, `g.cues()` and `g.timeline()` price **every** `run.play` step against
whichever compile is current when you ask: before playback starts there is no transport at
all and each `run.play` falls back to the mount's `animation.duration`, and after the second
`{op:"run"}` lands every `run.play` is priced against the *second* schedule. If you need a
cue sheet that is stable and exact — VO fitting, `smv-record`, a scrubber you trust to the
millisecond — keep one compile per script (put the recompile in a second storyboard, or use
`run.reset` with the same opts) and call `g.cues()` with the run already compiled.
`bin/smv-fit` refuses any script containing a `run.play` for the same reason; `run` and
`run.reset` themselves are priced at 0 ms there, exactly as they are here.

## Event vocabulary

Every `run.on(type, fn)` call subscribes to the run's own bus. Two families of events land
on it: transport-level (emitted by `run-transport.js` itself) and engine-level (Mode A's
compiled schedule, re-emitted verbatim as playback crosses each event's timestamp).

**Transport events:**

| type | payload | when |
|---|---|---|
| `play` | `{time, until}` | `play()` starts the ticker |
| `pause` | `{time}` | `pause()` |
| `seek` | `{time, duration}` | `seek()`, and after a `reset()` |
| `speed` | `{factor, branch, time}` | `speed()` |
| `step` | `{time, token}` | `step()` |
| `tick` | `{time, duration}` | every ticker frame while playing |
| `end` | `{time}` | `play()`'s target is satisfied |
| `cancel` | `{time}` | the pending `play()` was superseded/destroyed before it settled |
| `recompile` | `{time, duration}` | a graph mutation or `speed()` triggered a recompile |
| `remap` | `{sources, target, progress, ghosts, time}` | a `condense` remapped tokens sitting on the merged sources onto the new node |
| `destroy` | `{time}` | `destroy()` |

**Forwarded engine events** (Mode A's compiled schedule, `sim().events`):

| type | payload | meaning |
|---|---|---|
| `enter` | `{t, tokenId, nodeId, edgeId}` | a token arrives at a node (before any join gate) |
| `start` | `{t, tokenId, nodeId, dwellMs}` | dwell begins |
| `finish` | `{t, tokenId, nodeId}` | dwell completes, node fans out |
| `fail` | `{t, tokenId, nodeId, reason?}` | dwell completes, node fails instead (`data.fail`) |
| `spawn` | `{t, tokenId, parentId, nodeId, edgeId}` | fan-out created a new token (2nd+ out-edge) |
| `join` | `{t, nodeId, tokenId, arrived, needed, merged}` | a join policy fired |
| `drop` | `{t, tokenId, nodeId, edgeId}` | an arrival after the join already fired |
| `loop` | `{t, tokenId, edgeId, nodeId, iteration, max}` | a loop edge's arc-cross or in-place tick |
| `warn` | `{t, nodeId, message, value}` | an unparseable/negative `data.duration` |
| `done` | `{t, stalled}` | the compiled schedule's own end marker |

## See also

- `docs/LIVE.md` — Mode B, event-log replay instead of declared durations.
- `docs/PRESETS.md` — writing a decoration layer that reads `g.run()`'s state (or the spec)
  and draws onto `g.renderer.node(id)`.
- `docs/RECORDING.md` — `run.play` inside a storyboard, and why Mode B scripts refuse to
  record.
