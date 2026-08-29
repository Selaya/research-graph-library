# Deviations from docs/PLAN.md

Per the ground rules: any place the implementation departs from the plan's core
decisions (D1–D11), with reasoning.

## 1. Back edges are excluded from dagre's ranking, not fed to it reversed (D3)

**Plan:** "edges are flipped only inside the ranking pass, tagged `reversed`, and
restored for rendering."

**Implementation (`src/layout.js`):** reversed edges (explicit `loop: true`, pinned
reversals, and DFS-detected back edges) are withheld from the dagre graph entirely.
Their geometry is synthesized as a consistent-side arc (below the flow for LR) after
dagre positions the forward subgraph.

**Why:** feeding a reversed loop edge to dagre lets it participate in rank compaction,
so appending unrelated nodes can re-shape or re-route the loop between layouts — exactly
the mental-map violation D3's pinning exists to prevent. Excluding the edge makes the
"back edge never flips sides" exit criterion true *by construction* (verified across
overlapping appends in `test/e2e-m0.mjs`), at the cost of loops not pulling their
endpoints closer together in rank. For the human-scale graphs in scope, side-stability
won over compaction. The `reversed` tag still feeds styling and token loop-back
semantics exactly as D3 specifies. Revisit at M3 when the in-house engine owns ranking.

## 2. Edges to an *expanded* container attach to an interior entry/exit child (D5)

**Plan:** "while expanded, edges attach to the actual child, not the container."

**Implementation (`src/viewstate.js`):** the same — but note it is also *forced*:
dagre throws on any edge incident to a cluster node, so `view()` re-attaches boundary
edges of expanded containers to the interior entry child (no incoming interior edge)
or exit child (no outgoing interior edge), deterministic first/last fallback. The edge
keeps its own id, so the attachment tweens smoothly across expand/collapse. This is a
sharpening of D5 (which child, chosen how), not a contradiction; recorded because the
"entry/exit child" rule is an implementation decision the plan left open.

## 3. D5's four-step relayout realized via dagre's compound layout + post-padding

**Plan:** the explicit four-step pipeline (child layout → resize → parent relayout →
translate).

**Implementation (`src/layout.js` `padContainers`):** dagre's native cluster handling
performs the space reservation and sibling reflow in one pass (that is what D2 chose it
for); a post-pass grows each cluster rect to the union of dagre's reservation and
(children bbox + header/side padding) so the 28px header strip always clears children.
Same result as the four steps — containers size to content, siblings never overlap —
with dagre doing steps 1–3. The literal four-step pipeline becomes the M3 in-house
engine's job, as the plan's M3 milestone already states.
