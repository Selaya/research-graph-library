// Public API. One-way data flow, once per mutation:
//   store -> viewstate.view() -> layout(pinnedReversals) -> styleCommit -> scene.commit
//   -> anchored viewport correction (D10)
// Everything animated goes through the single scene/ticker, so an overlapping mutation
// cancels-and-retargets instead of queueing or double-writing (D9).

import { emitter } from "./events.js";
import { Store, GraphError, isConvex, containmentClosure } from "./store.js";
import { layout } from "./layout.js";
import { createTicker, EASE, prefersReducedMotion } from "./anim.js";
import { createScene } from "./scene.js";
import { createRenderer } from "./render.js";
import { createViewport } from "./viewport.js";
import { injectStyles } from "./styles.js";
import { createViewState } from "./viewstate.js";
import { runCondense, CONDENSE_PHASES } from "./condense-anim.js";
import { runSplit } from "./split-anim.js";
import { createDirector, resolveCameraTarget } from "./director.js";
import { makeQuery, cloneItem } from "./query.js";
import { attachA11y } from "./a11y.js";
import { attachTapToggle } from "./interact.js";
import { createRunTransport } from "./run-transport.js";
import { createRunRender } from "./run-render.js";
import { createStoryboard } from "./storyboard.js";
import { createTransport } from "./transport.js";
import { applyPipelinePreset } from "./preset-pipeline.js";

export const version = "0.1.0";

// Re-exported so consumers can `instanceof`-check a caught error and read `.code` off a
// real class instead of only structurally (finding: GraphError was internal-only, and its
// ~17 codes were discoverable nowhere but source). Also folded into the default export
// below so it rides into the IIFE global the same way mount/presetPipeline do.
export { GraphError };

/** A camera move with no declared `dur`. */
const CAMERA_MS = 600;
/** What condense/split actually cost — the M3 timeline's flat 400ms guess was wrong here
 *  by more than a factor of two, which is what D12 exists to fix. */
const CHOREO_MS = CONDENSE_PHASES.highlight + CONDENSE_PHASES.converge + CONDENSE_PHASES.reveal;

const EASINGS = {
  "linear": EASE.linear,
  "cubic-out": EASE.cubicOut,
  "cubic-in-out": EASE.cubicInOut,
  "overshoot": EASE.overshoot,
};

/** The director ops: instantaneous state flips (plus the camera, whose tween is scenery,
 *  not graph state) — the only ops a forward scrub replays at zero duration. */
const DIRECTOR_OPS = new Set(["camera", "highlight", "clearHighlight", "caption", "props"]);

/** Inside a batch, these are the ops that keep their own clock instead of folding into the
 *  one shared relayout — so they, and only they, can make the batch step cost more than
 *  that commit (D12: the declared duration must be the awaited one). */
const PARALLEL_IN_BATCH = new Set(["wait", "camera", "condense", "split"]);

/** True when `steps` (batches included) contains at least one camera op — D13's trigger for
 *  the script taking ownership of the viewport. */
function hasCameraOp(steps) {
  return (steps || []).some((s) => {
    if (!s) return false;
    if (s.op === "camera") return true;
    if (s.op !== "batch") return false;
    return hasCameraOp(Array.isArray(s.steps) ? s.steps : (s.args && s.args[0]) || []);
  });
}

/** Awaitable + cancelable handle handed back by every mutation (§5.3). */
function thenable(promise, cancel) {
  const p = Promise.resolve(promise);
  return {
    then: (a, b) => p.then(a, b),
    catch: (b) => p.catch(b),
    finally: (f) => p.finally(f),
    cancel,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/** Layers extra resolved fields onto an existing awaitable without disturbing its timing
 *  or `.cancel()` (finding: mutation handles used to resolve with only `{canceled}`, which
 *  cannot say whether the graph actually changed — cancel() never undoes add/remove/update,
 *  and for condense/split the structural change lands mid-flight, in the async phase, so
 *  `{canceled}` alone means something different before vs. after that phase). Additive: the
 *  `canceled` field callers already read is untouched. */
function withMeta(awaitable, meta) {
  return thenable(Promise.resolve(awaitable).then((r) => ({ ...r, ...meta })), awaitable.cancel);
}

const centerOf = (b) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function resolveEl(el, doc) {
  if (typeof el === "string") {
    const found = doc && doc.querySelector ? doc.querySelector(el) : null;
    if (!found) throw new GraphError("no-mount", `mount target "${el}" not found`);
    return found;
  }
  if (!el || typeof el.appendChild !== "function") throw new GraphError("no-mount", "mount needs an element or selector");
  return el;
}

export function mount(el, spec = {}, opts = {}) {
  const doc = (el && el.ownerDocument) || (typeof document !== "undefined" ? document : null);
  const root = resolveEl(el, doc);
  injectStyles(root.ownerDocument || doc);

  const store = new Store(spec);
  const vs = createViewState(store);
  const bus = emitter();
  // D15 — recording mode overrides the environment: a manual ticker is stepped frame by
  // frame by the renderer CLI (M4b) instead of riding rAF, and `data-smv-record` on the
  // root kills every wall-clock CSS transition so two captures of one frame are identical.
  const recording = opts.ticker === "manual";
  const ticker = createTicker({ manual: recording });
  const scene = createScene(ticker);
  const renderer = createRenderer(root, root.ownerDocument || doc);
  const viewport = createViewport(renderer.svg, renderer.viewportG, ticker);

  root.classList.add("smv-root");
  root.setAttribute("data-smv-theme", opts.theme || "auto");
  if (recording) root.setAttribute("data-smv-record", "");

  const layoutOpts = { dir: "LR", ...(opts.layout || {}) };
  const anim = opts.animation || {};
  // D15 — `motion:"full"` is the recorder saying "the environment is not the audience".
  const reduced = opts.motion === "full" ? false : prefersReducedMotion();
  // G9: reduced motion shrinks durations, it never removes steps.
  const baseDuration = reduced ? 1 : (anim.duration ?? 350);
  const easing = (typeof anim.easing === "function" ? anim.easing : EASINGS[anim.easing]) || EASE.cubicOut;

  let styleFn = null;
  let pinnedReversals = new Set();   // FAS pinning persisted across layouts (D3)
  let lastOrder = [];                // per-rank solver order persisted across layouts (M3)
  let lastLayers = [];               // the same per-rank order WITH edge bends (M3)
  let lastSlots = null;              // componentOrder: id -> slot, from the last drawing
  let slotsKey = null;               // the componentOrder that memory belongs to (JSON)
  let last = null;                   // previous layout result
  let transition = null;
  let batching = 0;
  let batchDefer = null;
  let batchFocal = null;
  let batchExtra = null;
  let destroyed = false;

  // ---- M4 director state (D12–D14) ---------------------------------------------------
  const director = createDirector({
    root,
    captions: opts.captions,
    // D1/D17 — the attention pulse rides the ONE shared clock, and G9 turns it into a
    // static hold instead of dropping it when the environment asks for less motion.
    ticker,
    reduced,
    lastLayout: () => last,
    emphasize: (id, v) => renderer.emphasize(id, v),
    dim: (id, v) => renderer.dim(id, v),
  });
  // D12 — the step's declared `dur` is ambient for the whole op, so every mutation op gets
  // per-step pacing without a single signature change. null = "the step didn't say".
  let stepDur = null;
  // Forward scrub replays director ops instantly: a camera tween is scenery, and a scrub
  // that animates it takes as long as the story it is skipping. Mutations deliberately keep
  // their real durations (test/e2e-m3 scrubForward leans on the condense choreography).
  let instant = false;
  // A DEPTH, not a boolean: the transport seeks on every `input` event of a drag, so scrubs
  // overlap, and a boolean would be cleared by whichever seek settled first — leaving the
  // newer replay to fly its camera moves at full length (exactly what this exists to stop).
  let scrubDepth = 0;
  // D13 — the script has taken the camera, so viewport state joins the G2 snapshot.
  let cameraOwned = false;

  /** A style-only commit: what g.style()/g.props() need, since neither moves any geometry
   *  and neither should pay for a relayout to be seen. Sizes are the LAST LAYOUT's where
   *  there is one, exactly as in relayout — a container's real box is solver-computed, and
   *  taking the spec's instead would re-truncate its label to a width it does not have. */
  function styleNow() {
    const v = vs.view();
    const sizes = { ...v.sizes };
    if (last) for (const [id, r] of Object.entries(last.nodes)) sizes[id] = { w: r.w, h: r.h };
    renderer.styleCommit({
      nodes: v.nodes, edges: v.edges, reversed: pinnedReversals,
      style: styleFn, sizes, props: director.propsLayer(),
    });
  }

  scene.onFrame((visual) => renderer.frame(visual));

  // M3 culling — the renderer asks for the visible world rect every frame it draws, and
  // viewport returns null (= cull nothing) whenever the svg has no usable size, e.g. in
  // Node/fake-DOM tests. render.js only engages the check above its own element threshold.
  renderer.setCull(() => viewport.visibleWorldRect());

  // Panning/zooming moves the rect without moving the graph, so no scene frame is due —
  // re-arm by repainting from the current visual state, but only when the transform has
  // actually changed (a pointermove that pans nothing must stay free). Driven off the
  // viewport itself rather than the svg's pointer events: fitView(), viewport.zoomBy() and
  // every tween tick move the rect with no pointer event anywhere in sight, and used to
  // leave whatever the previous transform had hidden hidden for good.
  let lastCullSig = null;
  function recull() {
    if (destroyed) return;
    // A live scene transition already repaints from `visual` every tick, and renderer.frame
    // re-reads the cull rect each time — piling a second frame on top of it buys nothing.
    if (scene.transition) return;
    const t = viewport.transform;
    const sig = `${t.x},${t.y},${t.k}`;
    if (sig === lastCullSig) return;
    lastCullSig = sig;
    renderer.frame(scene.visual);
  }
  const offCull = viewport.onChange(recull);

  /** Entering nodes bloom from a neighbour's previous position rather than popping in. */
  function enterFromFor(res, v) {
    if (!last) return {};
    const out = {};
    for (const id of Object.keys(res.nodes)) {
      if (last.nodes[id]) continue;
      for (const e of v.edges) {
        const other = e.target === id ? e.source : e.source === id ? e.target : null;
        if (other && last.nodes[other]) { out[id] = { x: last.nodes[other].x, y: last.nodes[other].y }; break; }
      }
    }
    return out;
  }

  /** enterFrom/exitTo may be objects or (layout, prevLayout) => object, and stack in a batch. */
  const asList = (m) => (m == null ? [] : Array.isArray(m) ? m : [m]);
  function resolveMaps(list, res, prev) {
    const out = {};
    for (const m of list) Object.assign(out, (typeof m === "function" ? m(res, prev) : m) || {});
    return out;
  }
  const orUndef = (o) => (Object.keys(o).length ? o : undefined);

  /**
   * componentOrder, as the SOLVER needs to see it. Two things the caller's raw list cannot
   * express on its own:
   *
   *  - Collapse. A listed id may not be in the view at all right now — hidden behind a
   *    collapsed container — so every id resolves to the leaf actually standing in for it.
   *  - STICKINESS. A slot is meant to belong to a component, but the spec can only name
   *    ids, and a user who removes a pipeline's head has removed the very id that named
   *    its slot; the component would drop into the trailing unlisted band, which is the
   *    reordering the option exists to prevent. So every entry is also joined by the ids
   *    the LAST drawing put in that slot and the store still has: the slot survives as
   *    long as any node of the component does, however many named ids are gone.
   *
   * The trailing "everything unlisted" slot (index === spec.length) is deliberately never
   * fed from memory — it is not an entry, and nothing should be pinned into it.
   */
  function resolveComponentOrder(spec) {
    const remembered = new Map(); // slot index -> ids from the previous drawing, still live
    for (const [id, slot] of Object.entries(lastSlots || {})) {
      if (!(slot < spec.length) || !store.hasNode(id)) continue;
      const live = vs.visibleAncestor(id) ?? id;
      const list = remembered.get(slot);
      if (list) list.push(live); else remembered.set(slot, [live]);
    }
    return spec.map((entry, i) => {
      const ids = (Array.isArray(entry) ? entry : [entry]).map((id) => vs.visibleAncestor(id) ?? id);
      return [...new Set(ids.concat(remembered.get(i) || []))];
    });
  }

  function relayout({ focal = null, duration, enterFrom, exitTo, easeOverride } = {}) {
    if (destroyed) return thenable(Promise.resolve({ canceled: true }), () => {});
    const v = vs.view();
    // M3 — `prevOrder` is the solver's order-stability channel, the exact counterpart of
    // pinnedReversals: feed the last drawing's per-rank order back in and appending a node
    // cannot reshuffle the ranks around it (mental-map preservation, D3's sibling rule).
    const lo = { ...layoutOpts, pinnedReversals, prevOrder: lastOrder, prevLayers: lastLayers };
    // The remembered slots belong to ONE componentOrder. A caller who hands g.layout() a
    // different list (or switches the option off) is redrawing from scratch, and replaying
    // the old memory over the new list would union components the new list separates —
    // so the memory dies with the list it was built for.
    const key = JSON.stringify(layoutOpts.componentOrder ?? null);
    if (key !== slotsKey) { lastSlots = null; slotsKey = key; }
    if (Array.isArray(lo.componentOrder)) lo.componentOrder = resolveComponentOrder(lo.componentOrder);
    const res = layout(v, lo);
    pinnedReversals = res.reversedEdgeIds || new Set();
    lastOrder = res.order || [];
    lastLayers = res.layers || [];
    lastSlots = res.slots || null;

    // Containers get their real (solver-computed) box here, so labels truncate to it.
    const sizes = { ...v.sizes };
    for (const [id, r] of Object.entries(res.nodes)) sizes[id] = { w: r.w, h: r.h };
    renderer.styleCommit({
      nodes: v.nodes, edges: v.edges,
      reversed: pinnedReversals, style: styleFn, sizes,
      // D16 — the director's override layer, merged over styleFn by the renderer. Read
      // here (and in styleNow) and nowhere else: propsLayer() rolls its own shadow
      // forward, so exactly one read per style commit is the contract.
      props: director.propsLayer(),
    });

    // D12 — an explicit argument still wins; `stepDur` is the storyboard step's declared
    // pacing, and baseDuration the mount-wide default.
    const dur = reduced ? 1 : (duration ?? stepDur ?? baseDuration);
    const prev = last;
    transition = scene.commit({ nodes: res.nodes, edges: res.edges }, {
      duration: dur, easing,
      enterFrom: orUndef({ ...enterFromFor(res, v), ...resolveMaps(asList(enterFrom), res, prev) }),
      exitTo: orUndef(resolveMaps(asList(exitTo), res, prev)),
      easeOverride,
    });
    last = res;

    // D10 — anchored, not auto-fit: hold the focal point still in screen space; only
    // refit when the user has never moved AND the new content lands outside the pane.
    if (prev) {
      const before = focal && prev.nodes[focal] ? prev.nodes[focal] : centerOf(prev.bounds);
      const after = focal && res.nodes[focal] && prev.nodes[focal] ? res.nodes[focal] : centerOf(res.bounds);
      viewport.anchor(before, after, dur);
      // The auto-refit rides the SAME computed duration, so reduced motion shrinks it too
      // (through M3 it was a flat 350ms tween whatever the environment asked for).
      if (!viewport.userMoved && !viewport.contains(res.bounds)) viewport.fit(res.bounds, { pad: 24, duration: dur });
    }

    bus.emit("commit", {
      nodes: res.nodes, edges: res.edges, bounds: res.bounds,
      reversedEdgeIds: pinnedReversals, meta: v.meta, focal, duration: dur, transition,
    });
    return handle(transition);
  }

  function handle(tr) {
    return thenable(tr.promise, () => tr.cancel());
  }

  /** Inside batch(): one relayout for many ops, one shared awaitable. `meta` (typically
   *  `{applied: true}`, sometimes with `ids`) rides on top — see withMeta(). */
  function commitOrDefer(focal, extra, meta) {
    let t;
    if (batching > 0) {
      if (!batchDefer) batchDefer = deferred();
      if (focal && !batchFocal) batchFocal = focal;
      if (extra) {
        if (!batchExtra) batchExtra = { enterFrom: [], exitTo: [], easeOverride: {} };
        batchExtra.enterFrom.push(...asList(extra.enterFrom));
        batchExtra.exitTo.push(...asList(extra.exitTo));
        Object.assign(batchExtra.easeOverride, extra.easeOverride);
      }
      const d = batchDefer;
      t = thenable(d.promise, () => transition && transition.cancel());
    } else {
      t = relayout({ focal, ...extra });
    }
    return meta ? withMeta(t, meta) : t;
  }

  /** For a mutation that turned out to be a no-op (e.g. expand() on an already-open
   *  container) — `applied:false` says nothing actually changed. */
  const settled = () => thenable(Promise.resolve({ canceled: false, applied: false }), () => {});

  /** Nearest positioned ancestor of `id` (itself first) in a layout's node map. What makes
   *  expandAll/collapseAll bloom from / fly into the RIGHT container when several, possibly
   *  nested, containers move in one commit: a child three levels down still finds the
   *  outermost box that is actually on screen in that layout. */
  function anchorFrom(nodes, id) {
    const seenUp = new Set();
    let cur = id;
    while (cur !== undefined && !seenUp.has(cur)) {
      const r = nodes && nodes[cur];
      if (r) return { x: r.x, y: r.y };
      seenUp.add(cur);
      const n = store.node(cur);
      cur = n ? n.parent : undefined;
    }
    return null;
  }

  // ---- M1: token run + storyboard + transport (D4/D8) --------------------------
  let runCtl = null;      // the run-transport driving compileRun on the shared ticker
  let runRender = null;   // the g.smv-tokens decoration layer
  let runOpts = {};
  let sb = null;          // the storyboard sequencer
  let sbSteps = null;
  let sbPlaying = false;
  let transport = null;
  let preset = null;
  let a11y = null;
  let tap = null;
  const tbus = emitter(); // transport-facing "something moved" channel
  const notify = () => tbus.emit("change", null);

  function disposeRun() {
    if (runRender) { runRender.destroy(); runRender = null; }
    if (runCtl) { runCtl.destroy(); runCtl = null; }
  }

  function createRun(o) {
    disposeRun();
    runOpts = o || {};
    runCtl = createRunTransport(internals, runOpts);
    runRender = createRunRender(internals, runCtl);
    runCtl.on("*", notify);
    notify();
    return runCtl;
  }

  const ensureRun = () => runCtl || createRun(runOpts);

  /** A storyboard `wait` on the shared clock — never a setTimeout racing the ticker (D1).
   *  Settles `{canceled:true}` if the clock is torn down under it, so g.destroy() during a
   *  wait never strands the storyboard's awaitable. */
  function waitMs(ms) {
    const d = reduced ? 1 : Math.max(0, ms || 0);
    return new Promise((res) => {
      const t0 = ticker.now();
      let off = null, done = false;
      const finish = (canceled) => {
        if (done) return;
        done = true;
        ticker.remove(tickWait);
        if (off) { off(); off = null; }
        res({ canceled });
      };
      const tickWait = (now) => { if (now - t0 >= d) finish(false); };
      ticker.add(tickWait);
      if (typeof ticker.onDestroy === "function") off = ticker.onDestroy(() => finish(true));
    });
  }

  /** A `run.play` step's stop node, written either way: `{op,until}` by hand, or
   *  `{op,args:[{until}]}` by the `timeline()` builder. applyStep and stepSlices MUST read
   *  it the same way, or a builder-written story is measured as a full run and its
   *  scrubber is mis-scaled and mis-seeked (the same double-count the base subtraction below
   *  exists to prevent). */
  const untilOf = (s) => (s.until != null ? s.until : (s.args && s.args[0] && s.args[0].until));

  /** The storyboard's op dispatch (§5.5). Mutation ops are just the public API.
   *  `step.dur` is published as the ambient `stepDur` for the whole call and restored to
   *  whatever enclosed it (a batch's own `dur` survives its children) — D12. */
  function applyStep(step) {
    const prevDur = stepDur, prevInstant = instant;
    stepDur = step.dur ?? null;
    if (scrubDepth > 0 && DIRECTOR_OPS.has(step.op)) instant = true;
    try { return applyOp(step); }
    finally { stepDur = prevDur; instant = prevInstant; }
  }

  function applyOp(step) {
    const args = step.args || [];
    switch (step.op) {
      case "wait":
        return waitMs(step.ms ?? args[0] ?? 0);
      case "run.play": {
        const r = ensureRun();
        const u = untilOf(step);
        r.play(u != null ? { until: u } : (args[0] || {}));
        return { run: r }; // the sequencer awaits r.promise; play/pause stay the run's job
      }
      case "run.step": {
        ensureRun().step(step.token != null ? { token: step.token } : (args[0] || {}));
        return null; // instantaneous: nothing to await
      }
      case "run.seek": {
        ensureRun().seek(step.ms ?? args[0] ?? 0);
        return null;
      }
      case "batch": {
        const list = Array.isArray(step.steps) ? step.steps : Array.isArray(args[0]) ? args[0] : [];
        // D12 — what the step is AWAITED for has to be what durOf() declares. g.batch()
        // hands back only the shared relayout, so a child that runs alongside it (a wait,
        // a camera move, a condense choreography) would be dropped on the floor and every
        // later step — and every cue offset after it — would land early, off the very cue
        // sheet the frame renderer shares.
        const kids = [];
        const tr = g.batch(() => {
          for (const s of list) {
            const r = applyStep(s);
            if (r && typeof r.then === "function") kids.push(r);
          }
        });
        if (!kids.length) return tr;
        return thenable(Promise.all([tr, ...kids]).then(() => ({ canceled: false })), () => tr.cancel());
      }
      default:
        return g[step.op](...args);
    }
  }

  // G2 — the snapshot taken before every step is spec + view state + run position, which is
  // the complete set of things a step can move. Restoring animates from the CURRENT visual
  // state through the ordinary keyed diff (D8), so a backward seek is just another commit.
  const host = {
    apply: applyStep,
    snapshot() {
      return {
        spec: store.snapshot(),
        collapsed: [...vs.collapsed],
        reversals: [...pinnedReversals],
        order: lastOrder.map((rank) => [...rank]),
        layers: lastLayers.map((rank) => [...rank]),
        // Same reasoning as `order` below: the componentOrder memory belongs to the
        // topology that produced it, so a backward seek has to replay the slots that spec
        // was drawn with rather than a future drawing's.
        slots: lastSlots ? { ...lastSlots } : null,
        slotsKey,
        runTime: runCtl ? runCtl.time() : 0,
        runOpts: runCtl ? runCtl.options() : null,
        // D14 — emphasis and the caption are state a step moves, so they are always here.
        ...director.snapshot(),
        // D13 — the camera is NOT, unless the script has taken it. Snapshotting it
        // unconditionally would yank an interactive storyboard's viewport back on every
        // seek, undoing a pan the reader made between two steps.
        ...(cameraOwned ? { camera: viewport.target, userMoved: viewport.userMoved } : null),
      };
    },
    restore(snap) {
      if (!snap) return settled();
      store.restore(snap.spec);
      vs.collapsed.clear();
      for (const id of snap.collapsed || []) vs.collapsed.add(id);
      // FAS pins belong to the topology that produced them, so they are part of what a
      // step moves and part of what a snapshot owns (G2). Carrying the CURRENT ones into a
      // restored spec pins an edge reversed that this state never reversed — a phantom
      // dashed back-edge arc and wrong ranks in a graph with no cycle, or the wrong edge
      // cut in one that has. Restore the pins the snapshot was taken with instead.
      pinnedReversals = new Set(snap.reversals || []);
      // The solver order is the same kind of thing (G2): it belongs to the topology that
      // produced it, so a backward seek that restores an older spec has to restore the
      // order that spec was drawn with — otherwise the restored drawing is seeded with a
      // *future* order and lands in a different arrangement than the one being replayed.
      lastOrder = (snap.order || []).map((rank) => [...rank]);
      lastLayers = (snap.layers || []).map((rank) => [...rank]);
      lastSlots = snap.slots ? { ...snap.slots } : null;
      slotsKey = snap.slotsKey ?? null;
      // BEFORE the relayout, unlike the camera below: the property override layer (D16) is
      // read by the style commit *inside* relayout, so restoring it afterwards would leave
      // the step's overrides on screen for a whole commit. Emphasis is re-asserted off the
      // "commit" event either way, so moving the whole director restore up is free.
      director.restore(snap);
      const tr = relayout({});
      // AFTER relayout, at duration 0: relayout's own anchor/auto-refit correction has just
      // been written into the viewport synchronously, so restoring the camera first would
      // simply be overwritten by it.
      if (snap.camera) {
        viewport.moveTo(snap.camera, { duration: 0 });
        viewport.userMoved = !!snap.userMoved;
      }
      // Re-seat the SAME transport in place: g.run() identity (and every listener on it)
      // has to survive a backward seek.
      if (snap.runOpts) {
        if (runCtl) { runOpts = { ...snap.runOpts }; runCtl.reset(snap.runOpts, snap.runTime || 0); }
        else createRun(snap.runOpts).seek(snap.runTime || 0);
      } else disposeRun();
      notify();
      return tr;
    },
  };

  function buildStoryboard(steps) {
    sbSteps = [...steps];
    // Decided up front, not on the first camera op: the snapshot for step 0 is taken before
    // any step runs, and it has to already know whether the camera is the script's (D13).
    if (hasCameraOp(sbSteps)) cameraOwned = true;
    sb = createStoryboard(host, sbSteps);
    sb.on("step", notify);
    sb.on("seek", notify);
    sb.on("done", () => { sbPlaying = false; notify(); });
    return sb;
  }

  /** Every step's share of the transport's cumulative timeline, as `{dur, base}`.
   *  `runCtl.timeOf()`/`duration` are ABSOLUTE times on the one run clock, which keeps
   *  climbing across successive `run.play` steps — so a step's own share is what is left
   *  between where the run already stood when the step began (`base`) and where it stops.
   *  Without that subtraction two run.play steps double-count the first one's time (a
   *  total longer than the run, a thumb that jumps at every step boundary, and a scrub
   *  that rewinds the engine). `base` is also what maps a position inside the step back
   *  onto the run's own clock. */
  /** D12 — the declared timeline IS the contract: what a step is worth is what it actually
   *  takes, and `dur` on the step overrides. The flat NOMINAL_STEP_MS=400 this replaces was
   *  a guess that no op honoured — condense really costs 900ms, a camera move 600, and a
   *  label or a highlight nothing at all. The scrubber, g.cues() and the frame renderer all
   *  read this one number, so they cannot disagree about where a step sits. */
  function durOf(step) {
    if (!step || step.op === undefined) return 0;      // labels are zero-duration positions
    if (step.dur != null) return Math.max(0, step.dur);
    const a0 = step.args && step.args[0];
    switch (step.op) {
      case "wait": return Math.max(0, step.ms ?? a0 ?? 0);
      case "camera": return Math.max(0, (a0 && a0.dur) ?? CAMERA_MS);
      case "highlight": case "clearHighlight": case "caption": case "props":
      case "run.step": case "run.seek": return 0;      // discrete state flips, D14/D16
      case "condense": case "split": return CHOREO_MS;
      case "batch": {
        const list = Array.isArray(step.steps) ? step.steps : (Array.isArray(a0) ? a0 : []);
        // One commit, run in parallel — the batch is worth its longest member, not their
        // sum. But a child that FOLDS into that shared commit cannot cost more than the
        // commit does: applyStep restores the batch's own `dur` around every child, so a
        // mutation child's `dur` is ignored at playback and counting it here would declare
        // a length nothing waits for. Only the children that genuinely run alongside the
        // commit can stretch the step.
        return list.reduce((m, s) => (s && PARALLEL_IN_BATCH.has(s.op) ? Math.max(m, durOf(s)) : m), baseDuration);
      }
      default: return baseDuration;
    }
  }

  function stepSlices() {
    let base = 0; // absolute run time at the start of the step being measured
    return (sbSteps || []).map((s) => {
      if (s.op === "run.play" && runCtl) {
        const u = untilOf(s);
        const end = u != null ? runCtl.timeOf(u) : runCtl.duration;
        const slice = { dur: Math.max(0, end - base), base };
        base = Math.max(base, end);
        return slice;
      }
      return { dur: durOf(s), base };
    });
  }

  function timeline() {
    if (!sb) {
      const d = runCtl ? runCtl.duration : 0;
      return {
        total: d || 1, time: runCtl ? runCtl.time() : 0,
        label: null, index: 0, steps: 0, playing: !!(runCtl && runCtl.playing),
      };
    }
    const slices = stepSlices();
    const durs = slices.map((s) => s.dur);
    let acc = 0;
    const offsets = durs.map((d) => { const o = acc; acc += d; return o; });
    const pos = sb.position();
    const i = Math.min(pos.index, Math.max(0, durs.length - 1));
    const step = sbSteps[i];
    const inRun = !!(step && step.op === "run.play" && runCtl);
    const within = inRun ? Math.min(Math.max(0, runCtl.time() - slices[i].base), durs[i]) : 0;
    const time = pos.done ? acc : (offsets[i] || 0) + within;
    return {
      total: acc || 1, time, label: pos.label, index: pos.index, steps: durs.length,
      playing: sbPlaying || !!(runCtl && runCtl.playing),
    };
  }

  /** Cumulative-timeline seek: land on the owning step, then run.seek inside it (§5.5). */
  function seekTimeline(ms) {
    if (!sb) {
      if (runCtl) runCtl.seek(ms);
      notify();
      return Promise.resolve();
    }
    // A scrub is a state restore, not a nudge: stop the story before moving its head, so
    // the step still in flight cannot land on top of the restored snapshot.
    sbPlaying = false;
    sb.pause();
    const slices = stepSlices();
    const durs = slices.map((s) => s.dur);
    if (!durs.length) return Promise.resolve();
    let acc = 0;
    const offsets = durs.map((d) => { const o = acc; acc += d; return o; });
    // A zero-duration label sitting exactly on `ms` wins over the step that follows it,
    // so scrubbing onto a marker lands on the marker (that is what labels are for).
    let idx = durs.length - 1;
    for (let i = 0; i < durs.length; i++) {
      if (ms <= offsets[i] || ms < offsets[i] + durs[i]) { idx = i; break; }
    }
    const off = Math.max(0, ms - offsets[idx]);
    // A forward scrub replays the ops it passes over. Camera moves replayed at full length
    // would make the scrub take as long as the story it is skipping, so applyStep snaps
    // director ops to zero while this flag is up (M4a: mutations keep their real timing).
    // Counted, not set: a drag issues overlapping seeks, and an earlier one settling (its
    // replay voided by the newer seek's stepGen bump) must not lower the flag under the
    // replay still running.
    scrubDepth++;
    const done = () => { scrubDepth = Math.max(0, scrubDepth - 1); };
    return Promise.resolve(sb.seek(idx)).then(() => {
      done();
      const step = sbSteps[idx];
      // `off` is story-relative; the run's clock is absolute, hence + the step's base.
      if (step && step.op === "run.play" && runCtl) runCtl.seek(slices[idx].base + Math.max(0, off));
      notify();
    }, (err) => { done(); throw err; });
  }

  const controller = {
    play() { if (sb) { sbPlaying = true; sb.play(); } else ensureRun().play(); notify(); },
    pause() { sbPlaying = false; if (sb) sb.pause(); if (runCtl) runCtl.pause(); notify(); },
    next() { if (sb) return Promise.resolve(sb.next()).then(notify); if (runCtl) runCtl.step(); notify(); },
    prev() { if (sb) return Promise.resolve(sb.prev()).then(notify); if (runCtl) runCtl.seek(0); notify(); },
    seek: seekTimeline,
    speed(f) { ensureRun().speed(f); notify(); },
    timeline,
    on: (type, fn) => tbus.on(type, fn),
  };

  /** D6 — condense/split mint ids the solver has never seen, and an unknown id sorts after
   *  everything known (INTERNALS: "append unknown ids in input order"), i.e. at the tail of
   *  its rank. That flatly contradicts the choreography, which flies the new node out of the
   *  sources' old centroid: it blooms there and then jumps past every untouched sibling on
   *  the way to the end of the rank. Give the new ids the slot the sources held instead —
   *  the merge happened *there*, so that is where the mental map expects the result. */
  function reseat(newIds, sourceIds) {
    const src = new Set(sourceIds);
    const fresh = [...new Set(newIds)].filter((id) => !src.has(id));
    if (!fresh.length) return;
    const seat = (ranks) => {
      let placed = false;
      const out = ranks.map((rank) => {
        const row = [];
        for (const id of rank) {
          if (fresh.includes(id)) continue; // never name a fresh id twice
          if (!src.has(id)) { row.push(id); continue; }
          if (!placed) { row.push(...fresh); placed = true; }
        }
        return row;
      });
      if (!placed) (out[0] || (out[0] = [])).push(...fresh);
      return out;
    };
    lastOrder = seat(lastOrder);
    lastLayers = seat(lastLayers);
  }

  // Handed to the choreography modules: everything they need, nothing DOM-shaped, so
  // they stay testable against a fake host (D6).
  const internals = {
    ticker, store, scene, renderer, bus, viewstate: vs,
    get reduced() { return reduced; },
    lastLayout: () => last,
    relayout,
    reseat,
    mark(ids, value) { for (const id of ids) renderer.mark(id, value); },
  };

  const g = {
    version,
    el: root,
    ticker,
    scene,
    renderer,
    viewport,
    viewstate: vs,

    on(type, fn) { return bus.on(type, fn); },
    off(type, fn) { bus.off(type, fn); },

    // Copies, not live store refs (same discipline as the plural query methods, M2): a
    // caller mutating what these return must never be able to corrupt internal state.
    node(id) { const n = store.node(id); return n ? cloneItem(n) : undefined; },
    edge(id) { const e = store.edge(id); return e ? cloneItem(e) : undefined; },
    spec() { return store.spec(); },
    bounds() { return last && last.bounds; },
    layoutResult() { return last; },

    addNode(node, o = {}) {
      const n = store.addNode(node);
      bus.emit("add", { kind: "node", id: n.id, item: n });
      if (o.after != null) {
        const e = store.addEdge({ id: `e:${o.after}->${n.id}`, source: o.after, target: n.id });
        bus.emit("add", { kind: "edge", id: e.id, item: e });
      }
      // `applied` is unconditionally true from here down: the store mutation above already
      // happened synchronously, and cancel() only ever interrupts the relayout tween, never
      // undoes it (finding #4).
      return commitOrDefer(n.id, undefined, { applied: true });
    },

    addEdge(edge) {
      const e = store.addEdge(edge);
      bus.emit("add", { kind: "edge", id: e.id, item: e });
      return commitOrDefer(e.target, undefined, { applied: true });
    },

    removeNode(id) {
      const edgesBefore = new Set(store.edges.keys());
      const removed = store.removeNode(id);
      for (const r of removed) bus.emit("remove", { kind: "node", id: r });
      const removedEdges = [];
      for (const eid of edgesBefore) {
        if (store.edges.has(eid)) continue;
        pinnedReversals.delete(eid);
        removedEdges.push(eid);
        bus.emit("remove", { kind: "edge", id: eid });
      }
      // The doomed cascade (store.js's removeNode): `id` plus every descendant it swallowed,
      // and every edge left dangling by any of them.
      return commitOrDefer(null, undefined, {
        applied: true,
        ids: { nodes: [...removed], edges: removedEdges },
      });
    },

    removeEdge(id) {
      store.removeEdge(id);
      pinnedReversals.delete(id);
      bus.emit("remove", { kind: "edge", id });
      return commitOrDefer(null, undefined, { applied: true });
    },

    update(id, patch) {
      const item = store.update(id, patch);
      bus.emit("update", { id, patch, item });
      return commitOrDefer(store.hasNode(id) ? id : null, undefined, { applied: true });
    },

    /** D5 — children bloom out of the container's *previous* centre. */
    expand(id) {
      if (!store.hasNode(id)) throw new GraphError("missing", `node "${id}" does not exist`);
      const at = last && last.nodes[id] ? { x: last.nodes[id].x, y: last.nodes[id].y } : null;
      if (!vs.expand(id)) return settled();
      bus.emit("expand", { id });
      return commitOrDefer(id, at && {
        enterFrom: (res, prev) => {
          const out = {};
          for (const k of Object.keys(res.nodes)) if (!prev || !prev.nodes[k]) out[k] = at;
          return out;
        },
      }, { applied: true });
    },

    /** The exact inverse: everything that just went away flies into the container's new centre. */
    collapse(id) {
      if (!store.hasNode(id)) throw new GraphError("missing", `node "${id}" does not exist`);
      if (!vs.collapse(id)) return settled();
      bus.emit("collapse", { id });
      return commitOrDefer(id, {
        exitTo: (res, prev) => {
          const c = res.nodes[id];
          const out = {};
          if (c && prev) for (const k of Object.keys(prev.nodes)) if (!res.nodes[k]) out[k] = { x: c.x, y: c.y };
          return out;
        },
      }, { applied: true });
    },

    /** D6 — merge N nodes into one over the 3-phase choreography. Guards fire synchronously. */
    condense(ids, node) {
      const list = [...ids];
      for (const id of list) if (!store.hasNode(id)) throw new GraphError("missing", `node "${id}" does not exist`);
      if (!node || node.id == null || node.id === "") throw new GraphError("node-id", "condense needs a new node with a non-empty id");
      if (store.hasNode(node.id)) throw new GraphError("dup-id", `duplicate node id "${node.id}"`);
      // Judged on the containment closure, exactly as store.condense() will judge it —
      // otherwise condensing a container passes here and throws 150ms later, out of
      // condense-anim's async phase 2, as an unhandled rejection.
      if (!isConvex(store, containmentClosure(store, list))) {
        throw new GraphError("non-convex", `condense set [${list.join(", ")}] is not convex: a path leaves the set and re-enters`);
      }
      const run = runCondense(g, internals, list, node);
      return thenable(run.promise, run.cancel);
    },

    /** D6 inverse — one node becomes N. Same discipline as condense: every guard that
     *  store.split() will apply is asked here, synchronously, so a bad call throws at the
     *  call site instead of 150ms later out of runSplit's async phase 2. */
    split(id, parts) {
      if (!store.hasNode(id)) throw new GraphError("missing", `node "${id}" does not exist`);
      if (store.children(id).length > 0) {
        throw new GraphError("split-container", `node "${id}" is a container (has children) and cannot be split`);
      }
      const list = (parts && parts.nodes) || [];
      if (!list.length) throw new GraphError("missing", "split requires at least one new node");
      const ids = new Set();
      for (const n of list) {
        if (!n || n.id == null || n.id === "") throw new GraphError("node-id", "every node needs a non-empty id");
        if (ids.has(n.id)) throw new GraphError("dup-id", `duplicate node id "${n.id}" in split`);
        // The split node itself is going away, so reusing its id is legal (store.split agrees).
        if (n.id !== id && store.hasNode(n.id)) throw new GraphError("dup-id", `duplicate node id "${n.id}"`);
        ids.add(n.id);
      }
      // Internal wiring with no entry (or no exit) has nowhere to redirect the split node's
      // former edges to, and store.split() refuses rather than dropping them silently.
      const internal = (parts && parts.edges) || [];
      const fedIn = new Set(internal.map((e) => e && e.target));
      const fedOut = new Set(internal.map((e) => e && e.source));
      let inc = 0, outg = 0;
      for (const e of store.edges.values()) {
        if (e.source === id && e.target === id) continue; // self-loop: dropped either way
        if (e.target === id) inc++; else if (e.source === id) outg++;
      }
      if (inc && list.every((n) => fedIn.has(n.id))) {
        throw new GraphError("split-no-entry", `split of "${id}" has no entry node to redirect its ${inc} incoming edge(s) to`);
      }
      if (outg && list.every((n) => fedOut.has(n.id))) {
        throw new GraphError("split-no-exit", `split of "${id}" has no exit node to redirect its ${outg} outgoing edge(s) from`);
      }
      const run = runSplit(g, internals, id, parts);
      return thenable(run.promise, run.cancel);
    },

    /** Every container open in ONE commit — the children bloom out of whichever box was
     *  actually holding them, not out of a single global centroid. */
    expandAll() {
      const changed = vs.expandAll();
      if (!changed.length) return settled();
      bus.emit("expandAll", { ids: changed });
      return commitOrDefer(changed[0], {
        enterFrom: (res, prev) => {
          const out = {};
          if (!prev) return out;
          for (const k of Object.keys(res.nodes)) {
            if (prev.nodes[k]) continue;
            const a = anchorFrom(prev.nodes, k);
            if (a) out[k] = a;
          }
          return out;
        },
      }, { applied: true });
    },

    /** The inverse: everything that just went away flies into its new collapsed box. */
    collapseAll() {
      const changed = vs.collapseAll();
      if (!changed.length) return settled();
      bus.emit("collapseAll", { ids: changed });
      return commitOrDefer(changed[0], {
        exitTo: (res, prev) => {
          const out = {};
          if (!prev) return out;
          for (const k of Object.keys(prev.nodes)) {
            if (res.nodes[k]) continue;
            const a = anchorFrom(res.nodes, k);
            if (a) out[k] = a;
          }
          return out;
        },
      }, { applied: true });
    },

    /** D4 — the token run. Called with opts it (re)compiles; bare it returns the live one.
     *  `{mode:'live'}` (Mode B) is a straight pass-through: run-transport owns the branch
     *  and returns a wider surface (start/finish/spawn/follow/now). Storyboards stay Mode A
     *  only in v1 — the op table is not live-aware. */
    run(o) { return o || !runCtl ? createRun(o || runOpts) : runCtl; },

    /** D8 — the JSON-op sequencer. Called with steps it (re)builds; bare it returns it. */
    storyboard(steps) { return steps ? buildStoryboard(steps) : sb; },

    /** The transport-facing view of where the story is (also what the bar renders from). */
    timeline,

    /** One relayout for many ops. An op that throws mid-batch still has to leave through
     *  the drain: the ops that DID land are in the store and must be rendered, the
     *  awaitables already handed out must settle, and batchDefer/batchFocal/batchExtra
     *  must not leak into the next, unrelated batch.
     *
     *  NOT transactional: `fn`'s ops run — and land in the store — one at a time, as `fn`
     *  itself executes; batch() only defers the relayout(s) they'd each have caused alone
     *  into one shared commit at the end. An op that throws partway through leaves every
     *  op before it committed (see the drain above) — batch buys one paint, not rollback. */
    batch(fn) {
      batching++;
      let failure = null, result;
      try { result = fn(g); } catch (err) { failure = err; } finally { batching--; }
      // A Promise-returning (async) fn is refused rather than silently mishandled: fn's
      // body keeps running after this synchronous call has already returned, so any op
      // after the first `await` would land outside the commit batch() just closed out —
      // or, for a nested batch, after the outer batch has already drained.
      if (result && typeof result.then === "function") {
        throw new GraphError("batch-async", "batch(fn) requires a synchronous fn — an async/Promise-returning callback keeps running after batch() has already returned, so its later ops would land outside this commit");
      }
      if (batching > 0) {
        if (failure) throw failure; // an outer batch owns the drain
        // The ops above DID land (batch is not transactional, see above) — only the
        // shared relayout is deferred to the outer batch's own drain.
        return thenable(Promise.resolve({ canceled: false, applied: true }), () => {});
      }
      const d = batchDefer, focal = batchFocal, extra = batchExtra;
      batchDefer = null; batchFocal = null; batchExtra = null;
      const tr = relayout({ focal, ...extra });
      if (d) d.resolve(tr);
      if (failure) throw failure;
      return withMeta(tr, { applied: true });
    },

    /** User style functions set --smv-* custom properties only (D7). */
    style(fn) {
      styleFn = typeof fn === "function" ? fn : null;
      styleNow();
      return g;
    },

    /** M4d — the per-step override layer (D16): `{id: {"--smv-fill": "#7c5cff"}}` merged
     *  OVER the style function, `g.props(null)` to clear. Replace-not-accumulate like
     *  highlight, and state like it too — snapshotted, restored, and re-applied to the
     *  fresh <g> a commit builds for a re-added id (it rides the style commit, which runs
     *  before the elements exist). Only --smv-* keys, same as every other styling path. */
    props(map) {
      director.props(map);
      styleNow();
      return g;
    },

    theme(t) { root.setAttribute("data-smv-theme", t); return g; },

    layout(o) {
      if (o) Object.assign(layoutOpts, o);
      return relayout({});
    },

    fitView(o = {}) {
      // G9 — the fit tween shrinks under reduced motion instead of running at full length.
      const dur = o.animate === false ? 0 : (reduced ? 1 : (o.duration ?? baseDuration));
      if (last) viewport.fit(last.bounds, { pad: o.pad ?? 24, duration: dur });
      viewport.userMoved = false;
      return g;
    },

    /** M4 — the scripted camera (D13). `{node}` / `{nodes}` / `{fit:true}` frame something,
     *  `{x,y,k}` sets the transform outright, `{by}` / `{zoom}` nudge it. The move rides the
     *  shared ticker like everything else, and a second call cancels-and-retargets (D9)
     *  rather than queueing. Deliberately NOT routed through viewport.fit(): fit's
     *  FIT_MAX_K=1.5 lid is an initial-auto-fit rule, and framing one node is exactly the
     *  case that wants to go past it (viewport's own MAX_K=4 still applies). */
    camera(o = {}) {
      // Taking the camera reuses the auto-refit suppression signal: from here on relayout
      // must not "helpfully" refit over a shot the script composed.
      cameraOwned = true;
      viewport.userMoved = true;
      const to = resolveCameraTarget(o, last, viewport.size(), viewport.target);
      // D12 — the declared timeline is the contract, and durOf() reads `step.dur` FIRST, so
      // the tween has to as well: args-first here would let a step declaring both durations
      // play for one length while the scrubber, cues and frame count measured the other.
      const dur = instant ? 0 : reduced ? 1 : Math.max(0, stepDur ?? o.dur ?? CAMERA_MS);
      const m = viewport.moveTo(to, { duration: dur, ease: EASINGS[o.ease] || EASE.cubicInOut });
      return thenable(m.promise, m.cancel);
    },

    /** M4 — emphasis (D14). Replace-not-accumulate: this IS the emphasis state, not an
     *  addition to it. `dim:true` makes it a spotlight (everything else drops back). */
    highlight(sel) { director.highlight(sel || {}); return g; },
    clearHighlight() { director.clearHighlight(); return g; },

    /** M4 — the caption overlay (D14). `g.caption(null)` clears it. */
    caption(text, o) { director.caption(text, o); return g; },

    /** The cue sheet: every label and caption in the story with its ABSOLUTE ms offset, off
     *  the same durOf() table the scrubber reads (D12). What a voice-over/subtitle tool
     *  consumes — and it stays truthful even when opts.captions is false. */
    cues() {
      const slices = stepSlices();
      const out = [];
      let at = 0;
      (sbSteps || []).forEach((s, index) => {
        const start = at;
        at += slices[index] ? slices[index].dur : 0;
        if (s.op === undefined) out.push({ kind: "label", at: start, label: s.label, index });
        else if (s.op === "caption") {
          const text = s.args && s.args[0];
          out.push({ kind: "caption", at: start, text: text == null ? null : String(text), index });
        }
      });
      return out;
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (a11y) { a11y.destroy(); a11y = null; }
      if (tap) { tap.destroy(); tap = null; }
      if (transport) { transport.destroy(); transport = null; }
      director.destroy();
      if (preset) { preset.destroy(); preset = null; }
      if (sb) { sb.pause(); sb = null; }
      offCull();
      renderer.setCull(null);
      disposeRun();
      scene.destroy();
      viewport.destroy();
      renderer.destroy();
      ticker.destroy();
      root.classList.remove("smv-root");
      root.classList.remove("smv-has-transport");
      root.removeAttribute("data-smv-theme");
      root.removeAttribute("data-smv-record");
    },
  };

  // Query sugar (M2): nodes/edges/children/descendants/roots read straight off the store.
  // The singular g.node/g.edge above are deliberately NOT clobbered — different arity,
  // different meaning.
  Object.assign(g, makeQuery(store));

  // The preset subscribes to "commit", so it has to exist before the first one.
  if (opts.preset === "pipeline") preset = applyPipelinePreset(g);

  // Highlight reassertion (D14): render.js builds a FRESH <g> for a re-added id, so a
  // commit that revives an emphasised node (a backward seek, an expand) hands back a blank
  // element. Re-writing after every commit is the cheapest place to keep the two in step —
  // scene.commit() has already fired one frame by the time "commit" is emitted, so the
  // elements exist.
  bus.on("commit", () => director.reassert());

  // Initial paint: land immediately (nothing to tween from), then fit once (D10).
  relayout({ duration: 0 });
  viewport.fit(last.bounds, { pad: 24 });

  // ARIA after the first layout: a11y.js reads reading order from g.layoutResult().
  if (opts.a11y !== false) a11y = attachA11y(g, { root, svg: renderer.svg });
  // Tap/click a container toggles it (same public path the keyboard uses).
  if (!(opts.interaction && opts.interaction.tapToggle === false)) {
    tap = attachTapToggle(g, { svg: renderer.svg });
  }

  if (opts.storyboard) buildStoryboard(opts.storyboard);
  if (opts.controls) {
    root.classList.add("smv-has-transport"); // the preset's total bar steps up out of the way
    transport = createTransport(root, controller);
  }
  if (opts.autoplay && sb) { sbPlaying = true; sb.play(); }

  return g;
}

/** `opts.preset: 'pipeline'` inline, or `SparkleMotion.presetPipeline(g)` after the fact. */
export const presetPipeline = applyPipelinePreset;

export default { mount, version, presetPipeline, GraphError };
