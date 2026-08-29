# Research: Token-based execution semantics (loops & parallelism)

> One of 7 parallel research passes behind docs/PLAN.md · 2026-08-29

## Summary

A linear playhead cannot represent loops/concurrency, so the core primitive must be individually-tracked tokens (not a scalar index or a collective Petri-net marking) that live on nodes/edges with their own clock, rate, and loop-iteration counters. Prior art converges on three ideas worth borrowing directly: (1) token/marking semantics from Petri nets and BPMN token simulation (bpmn-js-token-simulation) for the state model and fork/join visualization; (2) workflow-engine run views (Temporal Timeline, Airflow Grid/dynamic task mapping, Dagster/Prefect dynamic fan-out) for how to render N concurrent, variable-duration activations and retries legibly; (3) animation-timeline architecture (GSAP nested timelines, WAAPI Animation.currentTime/playbackRate) for driving many concurrently-running, independently-rated tweens off one shared, seekable, scrubbable playhead. The recommended design: a deterministic "compile a schedule, then sample it" architecture for hypothetical/demo playback (trivial seek/scrub/speed), plus an event-log-replay backend with the same token-state interface for mirroring a real running pipeline (Temporal-style time-travel). Joins are restricted to statically-decidable policies (all / any / k-of-n) rather than full dynamic OR-join, because YAWL's research on OR-join semantics shows the general case is deadlock-prone and requires expensive reachability lookahead. Fan-out is implicit on multiple out-edges (spawn-per-edge, no gateway node required) so the simple linear pipeline needs zero extra syntax, while an explicit gateway node type is offered only where BPMN-style visual/exclusive-branch semantics are wanted. Loops are modeled as a back-edge primitive (with a mandatory iteration cap) plus a `group + iterate` sugar that maps directly onto the required hierarchical compound-node expand/collapse feature.

## Recommendation

Adopt a token-automaton execution model with two interchangeable backends behind one `TokenState[] = stateAt(t)` interface:

1. **State model**: individual, uniquely-IDed tokens (not a collective marking) sitting on a node or mid-traversal on an edge, each carrying its own `rate` multiplier and a `loopCounters` map keyed by loop/back-edge id. This is the only representation expressive enough for "step advances what, exactly" to have a well-defined per-branch answer, for per-branch speed multipliers, and for rendering per-token pulses/badges.
2. **Spec mapping**: plain nodes+edges with per-node `duration` is enough for the linear case (zero extra syntax). Fan-out is *implicit* on out-degree > 1 (each out-edge spawns a child token cloning the parent's loop context) — no gateway node needed for the common parallel-branches case. An explicit `type: "gateway:parallel"` / `"gateway:exclusive"` node is opt-in sugar, needed only for BPMN-style diamonds or for conditional (exclusive, single-path) branching, which is not distinguishable from parallel fan-out by edge shape alone. Fan-in join policy lives on the node (`join: "all" | "any" | {count:k}`), deliberately restricted to statically-decidable thresholds rather than YAWL's full dynamic OR-join, which is known to be deadlock-prone in "vicious circle" configurations and requires costly reachability analysis to resolve correctly. Loops are a `loop:true` back-edge (mandatory `maxIterations` safety cap, engine rejects an unbounded one at authoring time) or, more commonly, a `group` compound node with `iterate:{maxTimes, until}` that desugars to that back-edge — this composes directly with the required hierarchical expand/collapse (collapsed = one node with an "iteration i/n" badge; expanded = the back-edge animates).
3. **Control API**: one authoritative virtual clock `t` (ms) independent of wall time. `play()/pause()/seek(t)/speed(mult)` operate on `t` exactly like a GSAP/WAAPI timeline. `step()` is defined generally as "advance `t` to the minimum next event-boundary over all live tokens" — which collapses to the obvious "advance to next node" when only one token is live (trivial linear case) and generalizes to "whichever branch finishes its current hop soonest" under parallelism; `step({token})` advances one branch only, freezing the others' dwell clocks, for branch-level debugging. Per-token/per-branch `speed(mult, {token})` reshapes only that token's downstream sub-schedule, mirroring GSAP's nested-timeline `timeScale` and WAAPI's per-`Animation.playbackRate` under one shared reference clock. Two backends satisfy "simulate vs replay": Mode A ("simulate") does an upfront discrete-event-simulation compile pass (classic event-queue: pop soonest pending token event, push its successors) since durations are known/estimated ahead of time, producing a flat sorted per-token event list that `stateAt(t)` samples in O(log n) — this is what makes scrubbing, reversing, and arbitrary speed trivial and is appropriate for demos, docs, and the "manual steps condense into one automated step" morph narrative. Mode B ("live") is an append-only event log fed by an imperative API (`token.start(nodeId)`, `token.finish(id)`, `token.expand(nodeId, n)` for dynamic/unknown-cardinality fan-out as in Airflow dynamic task mapping / Dagster `DynamicOut`) and `stateAt(t)` is a deterministic replay of that log up to `t`, giving Temporal-style time-travel scrub into history while `now` keeps advancing; you cannot scrub past `now` since the future is unknown. Both modes share one renderer.
4. **Rendering**: don't depend on GSAP or spin up one WAAPI `Animation` per token (footprint budget and potential large dynamic-fan-out cardinalities argue against it) — drive everything from one rAF loop calling `stateAt(t)` and writing interpolated positions/progress fills directly, reserving real DOM/WAAPI animations only for a bounded number of transient "hero" effects (join-fire burst, node pulse-on-arrival). Represent each live token as a moving pulse on its current edge (position = edge-path interpolation at `localProgress`); give duration-bearing nodes an internal progress fill driven by the token's own dwell progress; show an occupancy badge ("×3", or "iter 3/5" for loop groups) whenever more than one token is resident, plus one border-pulse per arrival so concurrent throughput is visually countable; render a join node as k filled/pending slots that converge-and-burst the instant its policy (all/any/k-of-n) is satisfied, with any not-yet-arrived branches (under any/k-of-n) shown as fading "ghost" tokens rather than snapping away.

## Details


## 1. Grounding from prior art

**Petri nets / token semantics** — states are "markings": multisets of tokens over places; a transition fires by consuming one token per input place and producing one per output place (van der Aalst, "Everything You Always Wanted to Know About Petri Nets" — https://www.vdaalst.rwth-aachen.de/publications/p1066.pdf). Two philosophies exist: *collective* marking (tokens in a place are indistinguishable, just a count) vs *individual* token semantics, where a token is an indexed pair `(place, i)` with its own identity (per search result on individual token game semantics). **This library must use individual-token semantics** — a collective count can't answer "which token do I speed up" or "which token does `step()` advance," both required by the spec.

**BPMN token simulation (bpmn-js-token-simulation)** — a bpmn-js plugin that animates BPMN-spec-compliant tokens through a diagram, with explicit engineering effort around making parallel-gateway *join* behavior spec-compliant (GitHub: bpmn-io/bpmn-js-token-simulation; changelog documents "fix parallel join" and "make parallel join BPMN spec compliant"; live demo at bpmn-io.github.io/bpmn-js-token-simulation/). This validates: (a) fork/join at parallel gateways is exactly the hard part worth getting right, (b) a token-animation layer is naturally built as an add-on over a base graph renderer, matching this project's likely architecture (core graph model + animation layer).

**YAWL OR-join semantics** — YAWL's research page and the van der Aalst YAWL tech report establish that naive AND-joins deadlock when not every branch is guaranteed to fire, motivating an "OR-join" that should fire once no further tokens *can* arrive — but this requires non-local reachability/lookahead analysis, and mutually-dependent OR-joins ("vicious circles") can still deadlock; YAWL's own engine falls back to an "optimistic" approximation (treating some OR-joins as XOR) rather than solving the general case (yawlfoundation.org/pages/research/orjoin.html; yawlrevtech.pdf). **Design implication**: do not implement general dynamic OR-join. Offer only statically-decidable join policies — `all` (=AND, wait for every declared incoming edge), `any` (=XOR-merge, first arrival wins), `{count:k}` (k-of-n threshold, decided purely from a local counter, no reachability analysis needed). This covers the requested "wait-all / wait-any / count-based" exactly and sidesteps a known-hard/deadlock-prone problem.

**Workflow-engine run visualizations**:
- *Temporal* Timeline view groups the 3 raw events of an activity (Scheduled/Started/Completed) into one span; span horizontal position/overlap conveys parallelism directly, span color conveys outcome (green=completed, red=failed), and retries appear as repeated/extended spans within the same row (temporal.io/blog/lets-visualize-a-workflow; docs.temporal.io/web-ui). Temporal's state reconstruction is fully event-sourced: History Events have monotonic EventIDs, and "Replay" deterministically re-derives state at any point, enabling time-travel debugging (docs.temporal.io/workflow-execution/event; keithtenzer.com Temporal replay post). **This is the direct model for this library's "live" backend**: an append-only, monotonically-ordered event log + a deterministic replay function from log→state-at-t, used when the graph mirrors a real, already-running pipeline (as opposed to a hypothetical/estimated walkthrough).
- *Airflow* Grid View + Dynamic Task Mapping: task cardinality can be unknown until runtime (`.expand()` over a runtime-computed list rather than a parse-time Python loop), and the Grid view surfaces the resulting mapped-task instances individually with per-instance state/retry history (airflow.apache.org dynamic-task-mapping docs; note also a known rough edge — apache/airflow#28988 — that the classic Graph view could go blank for DAGs using dynamic mapping, i.e. rendering *unbounded* dynamic fan-out is a real, previously-hit failure mode to design around, not a hypothetical one).
- *Dagster* `DynamicOut` / dynamic graphs and *Prefect* `.map()`/`.submit()` both build the fan-out cardinality at *runtime*, not at spec-authoring time (docs.dagster.io/guides/build/ops/dynamic-graphs; docs.dagster.io/examples/best-practices/dynamic-fanout). **Design implication**: the declarative spec should allow a node to be marked `dynamic: true` with fan-out cardinality resolved either from spec data (`fanout: 5`) or, in live mode, from an imperative call at execution time (`token.expand(nodeId, n)`), directly mirroring Dagster's DynamicOutput / Airflow's mapped-task-instance pattern — spawning `n` sibling tokens the UI did not know about in advance.

**Discrete-event simulation** — the standard DES architecture keeps a priority queue of pending events ordered by time and repeatedly pops-and-processes the soonest one, "jumping" between events rather than stepping continuously (cs.bu.edu DES notes; softwaresim.com DES intro). Because this library's durations are either declared estimates or already-known real durations (not stochastic *during rendering*), this event-queue algorithm can run once, ahead of time, as a **compile step** that produces a flat per-token schedule — turning an otherwise-live simulation into a static, randomly-seekable artifact. This is the key architectural move that makes scrubbing cheap.

**Animation timeline coordination** — GSAP: a single `gsap.timeline()` gives all child tweens one shared playhead so related motion stays coordinated; nested child timelines each get their own position offset *and* their own `timeScale`, scoped under the parent's single scrub/seek/reverse controls (gsap.com/docs/v3/GSAP/Timeline). WAAPI: each `Animation` exposes read/write `currentTime` (enables scrubbing) and `playbackRate` (independent per-animation speed), with `document.timeline` or a shared `startTime` used to keep a *group* of otherwise-independent Animations synchronized against one reference clock (MDN Web Animations API; Smashing Magazine "Orchestrating Complexity With Web Animations API"). **Design implication**: model per-token `rate` exactly as a nested-timeline `timeScale` / per-Animation `playbackRate` under one shared master `t` — well-precedented pattern for "N things animating concurrently at different, individually-adjustable rates, all seekable from one control."

## 2. State model (code sketch)

```ts
type LoopId = string; // id of a loop-group or a loop:true back-edge

interface Token {
  id: string;                 // unique per spawned instance, e.g. "t7" or "build[3]" for mapped fan-out
  branchId: string;           // stable across a lineage of splits, used for color/identity in the UI
  parentId?: string;          // set for tokens spawned at a fan-out
  loc:
    | { kind: 'node'; nodeId: string; enteredAt: number; duration: number }
    | { kind: 'edge'; edgeId: string; enteredAt: number; duration: number };
  rate: number;                // per-token speed multiplier, default 1 (like WAAPI playbackRate / GSAP timeScale)
  loopCounters: Record<LoopId, number>;
  status: 'live' | 'waiting-join' | 'done' | 'dropped';
}

interface JoinRuntime {
  nodeId: string;
  policy: 'all' | 'any' | { count: number };
  expectedBranches: Set<string>;   // known incoming branchIds (for 'all'; for dynamic fan-out this can grow)
  arrivedBranches: Set<string>;
}
```

Scheduling pass (Mode A, "simulate" — classic DES event-queue, run once at compile time):

```ts
function compileSchedule(spec: GraphSpec): TokenEvent[] {
  const pq = new MinHeap<PendingEvent>();        // ordered by time
  for (const src of spec.sourceNodes()) pq.push({ t: 0, tokenId: spawn(src), kind: 'enter-node', nodeId: src });
  const out: TokenEvent[] = [];
  while (!pq.empty()) {
    const ev = pq.pop();
    out.push(ev);
    for (const next of advance(ev, spec)) pq.push(next);   // handles fan-out spawn, join wait, loop counter++
  }
  return out; // flat, per-token, time-sorted — this is the artifact stateAt(t) samples
}
```

`advance()` is where fan-out/join/loop live:
- **fan-out**: `nodeId` has `k` out-edges and no explicit join semantics required on itself → spawn `k` child tokens (clone `loopCounters`, fresh `branchId` per child, `parentId` = source token), one entering each out-edge. Dynamic cardinality (`dynamic:true`) resolves `k` from spec data at compile time in Mode A, or is unknown at compile time in Mode B (handled by `token.expand()` instead, see below).
- **join**: when a token reaches a node with in-degree > 1, register its `branchId` as arrived in that node's `JoinRuntime`; only emit `enter-node` for the merged token once the policy is satisfied (`all`: arrivedBranches ⊇ expectedBranches; `any`: arrivedBranches.size ≥ 1, discard the rest as `dropped`; `{count:k}`: arrivedBranches.size ≥ k, discard remainder). No reachability analysis needed — this is the deliberate simplification vs. YAWL's OR-join.
- **loop**: an edge flagged `loop:true` (or the back-edge a `group{iterate}` desugars to) increments `loopCounters[loopId]` on traversal; if `loopCounters[loopId] >= maxIterations` (or the declared `until` condition is met, evaluated against a passed-in `ctx`), route the token forward past the loop exit instead of back around. `maxIterations` is mandatory on every `loop:true` edge — the compiler rejects an unbounded loop rather than risk an infinite compile pass.

Sampling (shared by both backends):

```ts
function stateAt(schedule: TokenEvent[], t: number): TokenState[] {
  // group schedule by tokenId once; per token, binary-search the segment containing t
  return liveTokensAt(t).map(tok => ({
    tokenId: tok.id, branchId: tok.branchId,
    kind: tok.loc.kind, targetId: tok.loc.kind === 'node' ? tok.loc.nodeId : tok.loc.edgeId,
    localProgress: clamp((t - tok.loc.enteredAt * tok.rate) / tok.loc.duration, 0, 1),
    loopCounters: tok.loopCounters,
  }));
}
```

## 3. Declarative spec

**Trivial linear case** (no gateways, no join keys, no loop syntax at all):

```json
{
  "nodes": [
    { "id": "build",  "duration": 30000 },
    { "id": "test",   "duration": 45000 },
    { "id": "deploy", "duration": 5000 }
  ],
  "edges": [
    { "from": "build", "to": "test" },
    { "from": "test",  "to": "deploy" }
  ]
}
```
One token, one path, `step()` == "go to next node" — no new concept for a user only building a pipeline diagram.

**Parallel fan-out/fan-in, implicit gateway, explicit join policy, per-branch rate difference visible directly in each node's own `duration`:**

```json
{
  "nodes": [
    { "id": "collect" },
    { "id": "lint",  "duration": 8000 },
    { "id": "unit",  "duration": 40000 },
    { "id": "e2e",   "duration": 180000 },
    { "id": "report", "join": "all" }
  ],
  "edges": [
    { "from": "collect", "to": "lint" },
    { "from": "collect", "to": "unit" },
    { "from": "collect", "to": "e2e" },
    { "from": "lint",  "to": "report" },
    { "from": "unit",  "to": "report" },
    { "from": "e2e",   "to": "report" }
  ]
}
```
No `type:"gateway"` node needed — 3 out-edges from `collect` *is* the fan-out. Explicit gateway sugar, only where wanted for visual/exclusive semantics:
```json
{ "id": "route", "type": "gateway:exclusive",
  "edges": [ { "to": "fastPath", "when": "ctx.score > 0.5" }, { "to": "slowPath" } ] }
```

**Dynamic (runtime-determined) fan-out**, mirroring Airflow dynamic task mapping / Dagster `DynamicOut`:
```json
{ "id": "process_files", "dynamic": true, "duration": "ctx.fileSize / ctx.throughput" }
```
Mode A resolves `fanout`/duration expressions against spec-provided sample data at compile time; Mode B resolves them live via `token.expand('process_files', n)` and per-child `token.finish(id, { duration })`.

**Loop / retry substep**, composing with required hierarchical compound-node expand/collapse:
```json
{
  "id": "deploy_with_retry",
  "type": "group",
  "children": [
    { "id": "deploy", "duration": 5000 },
    { "id": "healthcheck", "duration": 2000 }
  ],
  "iterate": { "maxTimes": 5, "until": "ctx.healthy === true" }
}
```
Desugars to a `loop:true` back-edge `healthcheck → deploy` with `maxIterations: 5`. Collapsed rendering: one node with a badge `retry 2/5`. Expanded: the literal back-edge, animated, with the pulse visibly looping. Power-user low-level form for irregular (non-subgraph) loops:
```json
{ "from": "healthcheck", "to": "deploy", "when": "ctx.status==='fail'", "loop": true, "maxIterations": 5 }
```

## 4. Control API

```js
const gv = new GraphViz(container, spec);        // Mode A: 'simulate' (default) — compiles schedule immediately

gv.play();                 // t advances at speed*wallClock via rAF
gv.pause();
gv.seek(12000);             // absolute ms; O(active tokens) — trivial because schedule is precomputed
gv.speed(2);                 // global multiplier (like GSAP timeline.timeScale)
gv.speed(0.25, { branch: 'e2e' }); // per-branch multiplier — reshapes only that branch's downstream schedule

gv.step();                   // advance t to min(next event boundary) over ALL live tokens
                              //   1 live token (linear case) -> "go to next node", unambiguous
                              //   N live tokens -> advances whichever branch's current hop finishes soonest;
                              //   ties (e.g. two branches with equal remaining duration) resolve together
gv.step({ token: 'unit' });   // advance only this token's next boundary; other tokens' dwell clocks hold

gv.on('join', e => {});          // {nodeId, policy, arrivedBranches, droppedBranches}
gv.on('loop-iteration', e => {}); // {loopId, nodeId, iteration, maxIterations}

gv.morph(newSpec, { duration: 800 }); // structural graph-morph transition (separate from playhead time)
```

Live mode (mirrors a real running pipeline; Temporal-style event-sourced replay):
```js
const gv = new GraphViz(container, spec, { mode: 'live' });
gv.token.start('build');                 // append EnterNode(build, now) to the log
gv.token.finish('build');                // append ExitNode(build, now); auto-spawns into out-edges
gv.token.expand('process_files', 12);    // dynamic fan-out realized at runtime -> 12 sibling tokens
gv.seek(pastTimestamp);                  // deterministic replay of the log up to that point (read-only)
gv.live();                                // resume following "now"; seeking past "now" is disallowed (future unknown)
```
The two modes differ only in how `TokenEvent[]`/log is produced; `stateAt(t)` and the renderer are identical, so switching a diagram from "here's an estimate" (docs/demo, morph-condensing narrative) to "here's the real run" (ops dashboard) is a constructor-option change, not a different API.

## 5. Rendering concurrent tokens legibly

- **Per-token pulse**: each live token renders as a moving dot/particle positioned by interpolating its current edge's path at `localProgress`. One rAF loop calls `stateAt(t)` for *all* tokens and imperatively sets `transform`/`stroke-dashoffset`; avoid instantiating one WAAPI `Animation` per token (footprint + potential dynamic-fan-out cardinalities of dozens/hundreds, cf. Airflow mapped-task counts, make per-token native Animation objects both unnecessary weight and a scaling risk — the previously-hit Airflow graph-view blank-out on large dynamic mappings, apache/airflow#28988, is exactly the failure mode to design away from). Reserve real WAAPI/CSS transitions for a small, bounded number of "hero" effects: a join-fire burst, a node arrival pulse.
- **Node occupancy**: a small badge shows count of tokens currently resident (`×3`) or, for a loop-group, `iteration i/n`; each new arrival triggers one border pulse, so throughput is visually countable by pulse-count even before reading the badge.
- **Progress fill**: duration-bearing nodes get an internal fill bar driven by the resident token's `localProgress`. Default policy: a node instance must fully complete before it accepts a new token in the *same* loop context (no overlap), keeping the default visualization to one fill per node; `node.concurrency: n` opts into overlapping fills (stacked mini-bars) for advanced concurrent-iteration scenarios.
- **Join rendering**: an `all`/`any`/`{count:k}` join node shows k labeled slots, filling as each expected branch's token arrives; the instant the policy is satisfied, filled slots animate a brief converge-and-merge burst into the outgoing token. Branches that arrive after the join has already fired (under `any`/`{count:k}`) render as fading "ghost" tokens continuing a short distance along their edge before disappearing, rather than vanishing abruptly — communicating "this branch's work was made moot" (directly serves the "automation condenses steps, animation communicates time saved" requirement when paired with a morph).

## Sources
- Petri net markings/token firing: https://www.vdaalst.rwth-aachen.de/publications/p1066.pdf
- Individual vs collective token semantics (search-surfaced overview of indexed-token game semantics)
- bpmn-js-token-simulation (repo, changelog, demo): https://github.com/bpmn-io/bpmn-js-token-simulation , https://github.com/bpmn-io/bpmn-js-token-simulation/blob/main/CHANGELOG.md , https://bpmn-io.github.io/bpmn-js-token-simulation/
- YAWL OR-join semantics / deadlock in vicious circles: http://www.yawlfoundation.org/pages/research/orjoin.html , https://yawlfoundation.github.io/assets/files/yawlrevtech.pdf
- Temporal Timeline view (event groups, span parallelism, retries): https://temporal.io/blog/lets-visualize-a-workflow , https://docs.temporal.io/web-ui
- Temporal event sourcing / deterministic replay / time-travel debugging: https://docs.temporal.io/workflow-execution/event , https://keithtenzer.com/temporal/temporal_time_travelling_replay/
- Airflow Grid View + Dynamic Task Mapping (and its known large-dynamic-graph rendering issue): https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/dynamic-task-mapping.html , https://github.com/apache/airflow/issues/28988
- Dagster dynamic graphs / DynamicOut: https://docs.dagster.io/guides/build/ops/dynamic-graphs , https://docs.dagster.io/examples/best-practices/dynamic-fanout
- Prefect dynamic mapping (`.map()`/`.submit()` at runtime): surfaced via https://www.datasops.com/blog/prefect-workflow-orchestration
- Discrete-event simulation event-queue model: https://www.cs.bu.edu/faculty/matta/Teaching/cs655-papers/shankar-des.pdf , https://softwaresim.com/blog/a-gentle-introduction-to-discrete-event-simulation/
- GSAP timeline shared playhead / nested timeScale: https://gsap.com/docs/v3/GSAP/Timeline/
- WAAPI Animation.currentTime / playbackRate / synchronizing multiple Animations: https://developer.mozilla.org/en-US/docs/Web/API/Animation , https://www.smashingmagazine.com/2021/09/orchestrating-complexity-web-animations-api/
- Camunda multi-instance loopCardinality / loop counter (context for loop-iteration badge idea): https://github.com/camunda/camunda/issues/2853

Note: two direct fetches (bpmn.io blog post, yawlfoundation.org OR-join page) were blocked by this environment's egress proxy (domain not allowlisted); the corresponding claims above rely on the WebSearch-surfaced summaries of those same sources rather than the fetched full text, and are flagged as slightly softer citations for that reason.


## Risks & caveats


- **OR-join restriction is a deliberate scope cut**: real BPMN/YAWL-style processes sometimes need genuine dynamic OR-join (fire once no more tokens *can* arrive, determined by graph reachability). This design explicitly does not support that — only `all`/`any`/`{count:k}` — because the general case is provably deadlock-prone/expensive (YAWL). If a future user needs true OR-join, they must model it manually (e.g., an exclusive gateway upstream that makes the branch count statically knowable). This should be stated as a documented limitation, not silently absorbed.
- **`step()` semantics under ties**: defining `step()` as "advance to the minimum next event boundary across all live tokens" is clean for the common case, but when many tokens tie or nearly tie (e.g., a 50-way dynamic fan-out where durations cluster), a single `step()` call can advance dozens of tokens at once, which may surprise users expecting one visible thing to happen. Mitigating options (offer `step({token})` for scoped stepping) are included, but the default global `step()` UX needs usability testing, not just correctness.
- **Mode A (precompiled schedule) assumes durations are known/deterministic at compile time**, including for `dynamic:true` nodes evaluated against sample data. If real cardinality/durations are data-dependent and only available at actual run time, Mode A produces a *representative* rather than *accurate* animation — acceptable for docs/demos/morph narratives, actively wrong if presented as "this is what will happen." The two-mode split is designed to prevent this confusion, but the API must make the active mode visually obvious (e.g., a persistent "estimated" vs "live" indicator) or users will over-trust simulated timing.
- **Loop safety cap (`maxIterations` mandatory)** is a deliberate hard requirement to keep Mode A's compile pass terminating. This forecloses genuinely open-ended loops (e.g., "retry until a human intervenes, no bound") from ever being precompiled — such cases must run in Mode B (live) only, where iteration count grows with real events rather than needing to be bounded in advance. This constraint should be surfaced clearly in docs/validation errors, not just silently enforced.
- **Rendering performance at scale is unverified**: the recommendation to avoid per-token WAAPI Animations in favor of one shared rAF loop is reasoned from the stated footprint budget and Airflow's real large-dynamic-mapping rendering failure, but no load-testing was done here (out of scope for this research pass) — before committing, prototype with a few hundred concurrent tokens (a plausible dynamic-fan-out ceiling) to confirm the single-rAF-loop approach holds up versus, e.g., needing to cap/cluster rendered pulses beyond some N.
- **Two blocked fetches** (bpmn.io blog, yawlfoundation.org) mean the bpmn-js-token-simulation animation-parameter details and the precise YAWL OR-join deadlock argument are sourced from WebSearch summaries rather than primary-source full text; the architectural conclusions drawn from them (join-policy restriction, token-as-first-class-object) are well-supported by multiple corroborating sources (van der Aalst YAWL tech report PDF fetched via search summary, Petri net paper) but worth a follow-up direct read if this becomes a load-bearing design decision in synthesis.
- **Interaction with the "graph morphing" requirement** (several manual steps condensing into one automated step) was only sketched here (`gv.morph()` treated as orthogonal to the playhead) since that is a different dimension's focus; this dimension's design assumes morph transitions are structural (spec A → spec B) rather than token-timeline events, and the two systems' boundary (e.g., does a morph mid-playback need to remap in-flight tokens onto the new spec's nodes?) needs explicit reconciliation with whichever other research dimension owns morphing.

