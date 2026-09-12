// sequence-solver.js — a sequence-diagram layout for sparkle-motion-visualizer.
//
// The library's layout() is a shell around a pluggable solver (README "Layout", INTERNALS
// §M3): the shell breaks cycles, routes back edges as arcs, pads containers to their
// children, and hands the solver `{nodes:[{id,w,h,parent?}], edges:[{id,source,target}]}`
// plus the merged layout opts. This solver ignores ranking entirely and places every
// node on a grid instead:
//
//     column = the ACTOR (a lifeline)      row = TIME (one row per message/activation)
//
// Actors are container nodes; each activation ("the app sends POST /login", "auth
// validates the credentials") is a child of its actor. Because the shell grows a
// container to its children's bounding box, an actor container becomes a tall column
// box — the lifeline — and every edge between activations is a message arrow that a
// run token can travel along: app -> auth -> app -> orders -> db -> orders -> app.
//
// Usage (IIFE global `SequenceLayout`; also an ES module when imported):
//
//     const seq = SequenceLayout.create({ actors: ["app", "gateway", "auth", "db"] });
//     seq.place("app.1", "app", 0);       // (id, actor, row) — rows are integers; gaps allowed
//     seq.place("gateway.1", "gateway", 1);
//     mount(el, spec, { layout: { solver: seq.solver, dir: "TB", nodesep: 40, ranksep: 28 } });
//
// `seq.place(id, actor, row)` registers a placement (call it before addNode); `seq.forget(id)`
// drops one; `seq.placement(id)` reads it back. Ids the solver has no placement for land in
// an extra column on the right, one per row, with a console.warn naming them. Opts read from
// the layout opts: `nodesep` = horizontal gap between actor columns, `ranksep` = vertical gap
// between rows, `marginx` / `marginy`, and `containerPad` (defaults mirror the shell's
// {top:40, side:12, bottom:12}). Pass `minColWidth` / `minRowHeight` under `layout` to keep
// columns from collapsing around short labels (defaults 120 / 0).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SequenceLayout = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var PAD = { top: 40, side: 12, bottom: 12 };

  function create(config) {
    var cfg = config || {};
    var actors = (cfg.actors || []).slice();
    var placements = new Map(); // id -> { actor, row }

    function colOf(actor) {
      var i = actors.indexOf(actor);
      if (i < 0) { actors.push(actor); i = actors.length - 1; }
      return i;
    }

    function place(id, actor, row) {
      if (typeof id !== "string" || !id) throw new Error("SequenceLayout.place: id must be a non-empty string");
      if (typeof actor !== "string" || !actor) throw new Error("SequenceLayout.place: actor must be an actor id");
      if (!(typeof row === "number" && isFinite(row))) throw new Error("SequenceLayout.place: row must be a finite number");
      colOf(actor);
      placements.set(id, { actor: actor, row: row });
      return api;
    }

    function solver(input, opts) {
      opts = opts || {};
      var nodes = Array.isArray(input && input.nodes) ? input.nodes : [];
      var edges = Array.isArray(input && input.edges) ? input.edges : [];
      var pad = Object.assign({}, PAD, opts.containerPad || {});
      var colGap = num(opts.nodesep, 40), rowGap = num(opts.ranksep, 28);
      var mx = num(opts.marginx, 20), my = num(opts.marginy, 20);
      var minColW = num(opts.minColWidth, 120), minRowH = num(opts.minRowHeight, 0);

      var byId = new Map();
      nodes.forEach(function (n) { byId.set(n.id, n); });
      var isContainer = new Set();
      nodes.forEach(function (n) { if (n.parent !== undefined && byId.has(n.parent)) isContainer.add(n.parent); });

      // 1. resolve every leaf to (col, row); unknown ids go to a spare column, stacked.
      var cells = new Map(); // id -> {col,row}
      var spareCol = actors.length, spareRow = 0, unknown = [];
      nodes.forEach(function (n) {
        if (isContainer.has(n.id)) return;
        var p = placements.get(n.id);
        if (p) { cells.set(n.id, { col: colOf(p.actor), row: p.row }); return; }
        if (n.parent !== undefined && actors.indexOf(n.parent) >= 0) {
          // A child of an actor with no explicit row: after the last row of that actor.
          cells.set(n.id, { col: colOf(n.parent), row: nextRow() }); return;
        }
        unknown.push(n.id);
        cells.set(n.id, { col: spareCol, row: spareRow++ });
      });
      if (unknown.length) console.warn("[seq] no placement for: " + unknown.join(", ") + " — parked in a spare column");

      function nextRow() {
        var max = -1;
        cells.forEach(function (c) { if (c.row > max) max = c.row; });
        return max + 1;
      }

      // 2. column widths and row heights from the measured node sizes.
      var ncol = actors.length + (unknown.length ? 1 : 0);
      var colW = [], rowH = new Map();
      for (var c = 0; c < ncol; c++) colW[c] = minColW;
      actors.forEach(function (a, i) {
        var cn = byId.get(a);
        if (cn && cn.w) colW[i] = Math.max(colW[i], cn.w + 2 * pad.side);
      });
      cells.forEach(function (cell, id) {
        var n = byId.get(id);
        colW[cell.col] = Math.max(colW[cell.col], (n.w || 0) + 2 * pad.side);
        rowH.set(cell.row, Math.max(rowH.get(cell.row) || minRowH, n.h || 0));
      });
      var colX = [], x = mx + pad.side;
      for (var k = 0; k < ncol; k++) { colX[k] = x + colW[k] / 2; x += colW[k] + colGap; }
      var rows = Array.from(rowH.keys()).sort(function (a, b) { return a - b; });
      var rowY = new Map(), y = my + pad.top;
      rows.forEach(function (r, i) {
        // An integer gap in the row numbering (a deliberate pause) reads as extra space.
        if (i > 0) y += rowGap * Math.max(1, Math.min(3, r - rows[i - 1]));
        rowY.set(r, y + rowH.get(r) / 2);
        y += rowH.get(r);
      });

      // 3. positions.
      var out = {};
      cells.forEach(function (cell, id) {
        var n = byId.get(id);
        out[id] = { x: colX[cell.col], y: rowY.get(cell.row), w: n.w || 0, h: n.h || 0 };
      });
      // Containers: exactly the children bbox + pad, so the shell's own padding is a no-op.
      // An actor with no activations yet is a header-only box at the top of its column.
      var bottom = y;
      actors.forEach(function (a, i) {
        var cn = byId.get(a);
        if (!cn) return;
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        cells.forEach(function (cell, id) {
          if (cell.col !== i) return;
          var r = out[id];
          x0 = Math.min(x0, r.x - r.w / 2); y0 = Math.min(y0, r.y - r.h / 2);
          x1 = Math.max(x1, r.x + r.w / 2); y1 = Math.max(y1, r.y + r.h / 2);
        });
        if (x0 === Infinity) {
          out[a] = { x: colX[i], y: my + pad.top / 2, w: colW[i], h: pad.top };
          return;
        }
        var l = Math.min(colX[i] - colW[i] / 2, x0 - pad.side), rt = Math.max(colX[i] + colW[i] / 2, x1 + pad.side);
        var t = Math.min(my, y0 - pad.top), b = Math.max(bottom + pad.bottom, y1 + pad.bottom);
        out[a] = { x: (l + rt) / 2, y: (t + b) / 2, w: rt - l, h: b - t };
      });

      // 4. edges are straight message arrows; the shell clips the ends to the boxes.
      var outEdges = {};
      edges.forEach(function (e) {
        var s = out[e.source], t = out[e.target];
        if (!s || !t) return;
        outEdges[e.id] = { points: [{ x: s.x, y: s.y }, { x: t.x, y: t.y }] };
      });

      // 5. reading order for the a11y tree: row-major, left to right.
      var order = rows.map(function (r) {
        var ids = [];
        cells.forEach(function (cell, id) { if (cell.row === r) ids.push(id); });
        return ids.sort(function (a, b) { return cells.get(a).col - cells.get(b).col; });
      });

      return { nodes: out, edges: outEdges, order: order };
    }

    var api = {
      actors: actors,
      place: place,
      forget: function (id) { placements.delete(id); return api; },
      placement: function (id) { var p = placements.get(id); return p ? { actor: p.actor, row: p.row } : null; },
      solver: solver,
    };
    return api;
  }

  function num(v, d) { return typeof v === "number" && isFinite(v) ? v : d; }

  return { create: create, PAD: PAD };
});
