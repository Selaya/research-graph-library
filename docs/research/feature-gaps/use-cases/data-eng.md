# Use-case pass: Data and ML platform engineering
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · opus agent adopting the perspective of a data / ML platform engineer (ETL DAGs, dbt lineage, feature pipelines, training runs, backfills, data quality gates).

**Coverage tally:** 10 use-cases: 3 good, 6 partial, 1 poor.

## The agent's stance

Data / ML platform engineer — I build and operate ETL DAGs (Airflow/Dagster), dbt model lineage, feature pipelines, training runs, backfills and data-quality gates. What I need from a graph library is almost never a static picture: it's time (when did each task run, how long, what blocked), tokens (partitions/batches/trials moving through fan-outs and joins), retries and failures as first-class states, and the ability to hand a non-engineer a 90-second animation explaining a pipeline they will never read code for. Against that, sparkle-motion-visualizer is unusually strong on time/tokens/narration/embed, and weak on ingest (no importers), on numbers-on-the-graph (live throughput/row counts/timestamps), on temporal layout (no Gantt), and on scale (SVG, culling above 150 elements, budgets tuned to ~300 nodes).

## 1. Postmortem replay of a failed nightly DAG run

- **Coverage today:** `good` · **Demand:** high · **Effort:** small
- **What the user is doing:** After a production pipeline fails, an on-call data engineer builds a short, scrubable, narrated replay of the run — tokens moving, the gate that failed, the retry loop that exhausted, the downstream branches that never fired — and drops it into the incident doc as an embedded page or an mp4.
- **Example scenario:** orders_nightly fails at 03:14: ingest_orders finishes in 45m, dq_null_check fails with 'null_rate 4.2% > 1%', the retry edge ticks 3/3, and the three downstream marts never start. The engineer authors a storyboard: camera on ingest, caption 'ingest completed on time', camera to the gate, highlight warn + dim spotlight, caption with the failure reason, then a fit-all shot showing the dark downstream, recorded with smv-record for the postmortem page.
- **Required features:** Mode A simulate with per-node data.duration from real task durations; data.fail with string reason carried into the fail event; Bounded retry loop edges with iteration badges (iter N/M); Storyboard camera/highlight(dim)/caption ops with per-step dur; Backward scrub through structural changes (snapshotted steps); smv-record to mp4 plus --cues chapters; smv-pack single self-contained HTML for wiki embedding
- **Missing pieces:** A converter from real run metadata (Airflow task instance start/end, Dagster run events) into a GraphSpec with data.duration + data.fail — today every postmortem starts by hand-writing the spec; Wall-clock timestamp rendering: only relative simulated ms exist; no absolute '03:14:22 UTC' node label, caption token, or time formatter; No duration-compression mapping (log scale / skip-idle) so a faithful 6-hour run either records as 6 hours or must be hand-rescaled per node; smv-fit refuses any storyboard containing run.play, so a narrated postmortem that actually plays the token run cannot be voice-over-fitted
- **Tools used for this today:** Airflow Grid/Graph view + Gantt tab, Dagster run timeline, Loom recordings of the scheduler UI, hand-drawn Excalidraw/Mermaid in the postmortem doc, Datadog/Grafana traces

## 2. Live pipeline wallboard fed from the scheduler's event stream

- **Coverage today:** `partial` · **Demand:** high · **Effort:** large
- **What the user is doing:** An always-on embedded panel in the internal ops dashboard showing current state of critical DAGs as events arrive — what is running, occupancy of a fan-out, what just failed — with the ability to scrub back a few hours without leaving the page.
- **Example scenario:** A team dashboard embeds a 40-node view of ingest→dbt→publish. A webhook/SSE consumer calls run.start('dbt_run'), run.finish('dbt_run'), run.fail('freshness_gate',{reason:'source stale 9h'}) as Airflow emits them; the frontier clock advances in real time, and an operator drags the scrubber back 90 minutes to see the graph when the alert fired, then hits follow() to snap back to live.
- **Required features:** Mode B live append-only log with {at} timestamps and frontier/view two-clock model; run.log()/run.reset({log}) for reconnect and refresh persistence; Non-throwing self-healing unknown-id calls for events on not-yet-known nodes; Heap-based replay + memoized state (40k events ~73ms); Occupancy badges and node status vocabulary; Single script tag / packed HTML embed into an existing dashboard
- **Missing pieces:** No live numeric labels bound to events: no per-node 'rows processed', per-edge throughput/lag label, or elapsed counter updating from the log — g.props only accepts --smv-* custom properties, so text cannot be written from live events without a custom preset; No auto-follow camera in live mode (camera is a director/storyboard op; no 'keep the active node in frame' viewport behavior); No wall-clock axis or 'last updated 12s ago' staleness affordance — run.now() is elapsed ms, not a clock; Token pulses are not culling-aware, so a zoomed-in wallboard on a large DAG shows orphan pulses; No tooltip/details-on-demand — an operator cannot hover a node for the log link, owner, or last error; Storyboards (hence captions/highlight choreography) are Mode-A-only, so a live board cannot reuse a scripted annotation layer
- **Tools used for this today:** Airflow Graph view auto-refresh, Dagster asset/run pages, Prefect UI, Grafana Node Graph panel, Datadog/Kibana service maps, custom React Flow dashboards

## 3. dbt lineage onboarding tour for a large project

- **Coverage today:** `partial` · **Demand:** high · **Effort:** medium
- **What the user is doing:** New analytics engineers get a guided animated walkthrough of the warehouse model graph: staging collapsed into a container, then intermediate, then marts; camera moves per layer; captions on naming conventions and ownership; shipped as an mp4 in the onboarding course and an interactive page in the handbook.
- **Example scenario:** A 900-model dbt project. Containers per folder (staging/, intermediate/, marts/finance, marts/growth) render collapsed as stacked cards with child-count badges and weighted meta-edges; the storyboard expands marts/finance, frames the fct_revenue subtree, captions 'every finance mart reads from exactly one intermediate', then collapseAll and fit for the closing shot.
- **Required features:** Compound container nodes with animated expand/collapse and meta-edge weight aggregation; expandAll/collapseAll in one shared transition; Camera ops (node/nodes/fit) and caption overlay; g.cues() to SRT/chapters for the course platform; exportSVG stills for the handbook; CSS custom property theming to match the docs site
- **Missing pieces:** No dbt manifest.json / OpenLineage / DOT importer — the spec requires a bespoke transformer (nodes, parent from fqn, edges from depends_on); Column-level lineage is unrepresentable: no ports, so 'fct_revenue.amount comes from stg_orders.total' cannot be drawn between named connection points; Scale: 900 models is far past the 150-element culling threshold and the ~300-node performance sample; no LOD/auto-aggregation beyond manual containers and no documented behavior at 1k+ nodes; No path-finding/query API (edge-following upstream/downstream — g.descendants is the container tree), so 'everything downstream of stg_orders' must be computed by the caller before highlight()
- **Tools used for this today:** dbt docs DAG viewer, DataHub / OpenMetadata / Atlan lineage, Select Star, Mermaid diagrams in the wiki

## 4. Backfill progress visualization (N partitions through one DAG)

- **Coverage today:** `partial` · **Demand:** medium · **Effort:** medium
- **What the user is doing:** Show a multi-month backfill as many tokens flowing through the same graph so the operator can see where partitions pile up, which stage is the bottleneck, and how far the job is from done.
- **Example scenario:** Re-running 180 daily partitions of the events pipeline. 180 tokens enter parse, occupancy badges show 12 in-flight at transform, a quorum join {count:150} on publish_snapshot fires early, and the operator uses speed(0) on one branch and step({token}) on the slow one to see whether it is the S3 read or the warehouse write.
- **Required features:** Multi-token simulation with occupancy badges; spawn(id,n) in live mode / implicit fan-out in simulate; join {count:k} quorum with slot pips and drop events; Per-branch speed and step({token}); Progressive traversed-edge width
- **Missing pieces:** No completion-count readout on a node ('142/180 done') — occupancy badges show in-flight count only, and RunState progress is a 0..1 dwell fraction, not progress against a declared total; No queue/backlog depth visual per node (a number or growing pip stack) to make the bottleneck legible; No aggregate ETA / remaining-work derived from the run — Mode A duration is a fixed compiled total and Mode B duration is the growing frontier, neither is 'time to finish this backfill'; Per-branch speed() is Mode A only, so the freeze-one-branch inspection trick does not work on a real backfill replayed live
- **Tools used for this today:** Airflow grid view task-instance coloring, Dagster partition/backfill matrix, custom Grafana counters, tail -f and spreadsheets

## 5. Data-quality gate blast-radius explainer

- **Coverage today:** `partial` · **Demand:** high · **Effort:** small
- **What the user is doing:** When a contract or test fails, show stakeholders exactly what is now untrustworthy: the failing gate lit, the halted branch, every downstream asset dimmed — as a shareable artifact for the incident channel or the data-status page.
- **Example scenario:** freshness_check on stg_payments fails at 02:00. The generated page spotlights the gate in warn, dims unaffected assets to 28%, shows the 14 downstream marts and 3 exec dashboards in mute, captions 'these 17 assets are stale until the 06:00 rerun', and a still SVG goes to Slack.
- **Required features:** data.fail halting fan-out (branch stops, no finish event); highlight() variant + dim spotlight, replace-not-accumulate; Container status roll-up from earliest-failing descendant; exportSVG/exportPNG stills for chat; props() override layer for custom severity colors
- **Missing pieces:** No edge-following reachability query in the library, so the blast-radius node set must be computed externally before highlight(); No 'stale/untrusted' terminal status distinct from failed/pending in the run-driven status vocabulary (fakeable with custom data-status + CSS, but not run-driven); Node-level annotation text (which test failed, threshold vs actual) has no home — labels are static spec strings and props() accepts only --smv-* keys; exportPNG is browser-only, so a server-side alerting job cannot render the still without headless chromium
- **Tools used for this today:** Monte Carlo / Bigeye / Soda impact analysis, dbt test output in CI logs, Great Expectations data docs, a screenshot of the lineage graph pasted into Slack

## 6. Always-in-sync pipeline diagram embedded in platform docs

- **Coverage today:** `good` · **Demand:** medium · **Effort:** small
- **What the user is doing:** Replace hand-drawn Lucidchart/Mermaid pipeline diagrams in the platform handbook and RFCs with a generated, animated, self-contained page produced from the same source of truth as the pipeline and refreshed in CI.
- **Example scenario:** A nightly CI job reads the Airflow DAG definitions, emits spec.json, runs smv-pack to produce platform-overview.html, and publishes it to the docs site; the page autoplays one token so a reader immediately sees direction and dependency, and it opens offline from file:// during an outage review.
- **Required features:** smv-pack single-file HTML (no build step, no CDN dependency, file:// openable); Zero-dependency IIFE under 50KB gzip for docs embedding; CSS custom property theming (auto/light/dark) matching the docs site; ARIA tree + linearized table fallback for the docs a11y gate; Deterministic order-stable layout so nightly regeneration does not reshuffle the diagram
- **Missing pieces:** No importers — the CI job must hand-write and maintain a DAG-to-GraphSpec transformer per orchestrator; No DOT/GraphML/Mermaid import or export, so existing diagrams cannot be migrated in and the spec cannot be handed to graphviz for a print figure; exportSVG is ESM-only and exportPNG browser-only, so a pure-Node docs build cannot emit a static fallback image without headless chromium; Version 0.1.0 pre-1.0 with no semver guarantee is a real objection for something wired into a nightly build for years
- **Tools used for this today:** Mermaid in Markdown, Lucidchart/Excalidraw screenshots, Graphviz/dot in CI, dbt docs, Structurizr/C4

## 7. Hyperparameter sweep / training-run visualization

- **Coverage today:** `partial` · **Demand:** medium · **Effort:** medium
- **What the user is doing:** Show an ML training workflow fanning out into N trials, some failing or early-stopped, survivors joining into model selection, winner going to eval and registry — for a training-platform status page or a model-review deck.
- **Example scenario:** A 24-trial sweep: prepare_features fans out to 24 trial nodes inside a collapsed container (stacked card, count badge 24), 9 trials fail with data.fail 'OOM on GPU', select_best uses join {count:15} so it fires as soon as enough land, extra arrivals ghost-fade with drop events, and the storyboard camera pushes into the container to show which trials survived.
- **Required features:** Container collapse with child-count badge and meta-edge aggregation; Implicit fan-out and quorum join with drop events; data.fail with per-trial reason strings; Duration grammar for realistic per-trial times; Spotlight highlight for the winning path
- **Missing pieces:** Trials must be materialized as explicit nodes up front; there is no 'spawn K child nodes from an event' primitive in live mode (spawn(id,n) adds tokens, not nodes), so a dynamic sweep size means rebuilding the spec; No per-node metric display (loss, accuracy, step count) — nothing on a node can render a live number, only status and a static label; No small-multiples or metric-over-time affordance, yet comparing trial curves is the point of a sweep; Rounded rects only — no shape vocabulary to distinguish dataset vs job vs artifact vs model, so it must be faked with color
- **Tools used for this today:** Weights & Biases sweeps, MLflow experiment UI, Kubeflow / Vertex Pipelines run graph, Ray Dashboard, Metaflow UI

## 8. 'Why does the report land at 06:00?' critical-path explainer

- **Coverage today:** `partial` · **Demand:** medium · **Effort:** large
- **What the user is doing:** Explain SLA math to stakeholders: which chain of tasks determines the landing time, where the slack is, and what happens if one step gets faster — as an interactive page a data PM can play with before a planning meeting.
- **Example scenario:** The exec dashboard is due at 06:00 but lands at 06:40. The page plays the run once at real proportions, highlights the eight critical-path tasks in focus while everything else dims, then a second scene shows vendor_extract cut from 2h to 20m and the token arriving 80 minutes earlier, with the pipeline preset's odometer showing the delta.
- **Required features:** Compiled Mode A schedule with exact run.timeOf(nodeId); durationAgg sum/max container roll-ups; Spotlight highlight of a path, camera framing, captions; Storyboard update() ops changing a duration mid-story with re-animation; Pipeline preset duration chips and total-duration bar
- **Missing pieces:** No critical-path or slack computation — timeOf() gives per-node instants but nothing returns the determining chain, so the caller must reimplement CPM over the spec; No Gantt/temporal layout (x = time with a sweeping playhead), explicitly skipped and never built, though it is the canonical form for this question; No before/after comparison mode (two specs in one view, diffed) — the what-if can only be told sequentially; No time axis or duration ruler rendering of any kind
- **Tools used for this today:** Airflow Gantt tab, Dagster run timeline, Excel/Sheets CPM models, Datadog Data Streams / trace flame charts, hand-made slides

## 9. Streaming topology with backpressure (Kafka/Flink)

- **Coverage today:** `poor` · **Demand:** medium · **Effort:** large
- **What the user is doing:** Visualize a streaming topology where the interesting quantity is flow rate and lag rather than task completion: which operator is the bottleneck, where consumer lag grows, which topics are hot.
- **Example scenario:** A Flink job reading three topics: an operator's input rate is 40k/s, output 12k/s, checkpoint duration climbing. The panel should thicken hot edges, badge each edge with events/sec, and pulse the lagging consumer group.
- **Required features:** Edge weight rendering (heavier line + badge); Live event feed driving visual state; Emphasis/pulse for attention; Cycle/back-edge support for feedback loops
- **Missing pieces:** Edge weight is a static spec property for meta-edge aggregation, not a live-updatable numeric — no per-edge throughput label updating from a feed and no continuous width mapping from a rate; No node-level gauge, sparkline, or metric slot; this use case is fundamentally numbers-on-a-graph, which the token model does not express; No continuous-flow rendering mode (particles proportional to rate) distinct from discrete duration-bearing tokens; No time-series drilldown or linked-chart affordance
- **Tools used for this today:** Flink Web UI job graph, Kafka Streams topology viewer / Conduktor, Grafana Node Graph + dashboards, Confluent Stream Lineage, Datadog Data Streams Monitoring

## 10. Migration narrative: manual runbook to automated pipeline

- **Coverage today:** `good` · **Demand:** medium · **Effort:** small
- **What the user is doing:** Sell or document a platform migration by animating before/after: manual handoff steps condensing into one orchestrated job, the total-duration bar collapsing, the retry loop disappearing — as a 60-second clip for an all-hands or a funding ask.
- **Example scenario:** The finance close pipeline: 'analyst exports CSV', 'email to ops', 'ops uploads', 'manual reconcile' condense() into one 'automated_close' node with the highlight→converge→reveal choreography, the preset odometer ticking 14h → 25m, caption 'four handoffs, zero at 3am', recorded frame-deterministically with smv-record and fitted to voice-over with smv-fit.
- **Required features:** condense()/split() staged choreography with slot-preserving reseat; Pipeline preset odometer, delta badge, total-duration bar; Storyboard JSON as the portable artifact with per-step dur pacing; smv-record deterministic mp4 and smv-fit voice-over fitting; g.cues() for chapters/subtitles
- **Missing pieces:** smv-record needs chromium on disk and ffmpeg for video — a real barrier for a platform team's CI image; smv-fit cannot price a run.play step, so any narrative that includes the token actually flowing (this one does) cannot be auto-fitted to a recorded voice-over; condense() requires a convex source set; real 'these seven manual steps' selections in a messy runbook DAG are often non-convex and throw, with no preview or suggested repair of the offending path; No before/after split-screen or A|B compare shot type — the transformation can only be told as a temporal transition
- **Tools used for this today:** Slides with two static diagrams, Loom walkthroughs, After Effects / motion designers, Mermaid before/after pairs

## Cross-cutting needs from this perspective

- Importers for the ecosystem's real sources of truth — dbt manifest.json, Airflow DAG/task-instance API, Dagster GraphQL, OpenLineage/Marquez events, plus DOT/GraphML in — so the spec is generated rather than hand-written; every high-demand use case above currently begins with a bespoke transformer.
- Live numeric labels bound to events: a text/number channel per node and per edge (rows processed, throughput, lag, elapsed, 142/180) updatable from Mode B events. props() accepts only --smv-* custom properties and labels are static spec strings, which blocks the wallboard, backfill, streaming and training use cases alike.
- Wall-clock time support: absolute timestamp formatting, a time axis or ruler, and a duration-compression mapping (log scale / skip-idle) so hours-long real runs can be narrated in seconds without hand-rescaling every node.
- Temporal/Gantt layout mode (x = time with a sweeping playhead) — explicitly never built, and the single most-repeated gap across SLA, critical-path, backfill and postmortem use cases.
- Graph-algorithm queries over the spec: edge-following upstream/downstream reachability, critical path, slack. Blast radius and SLA explanation both need them and both currently push the computation onto the caller.
- Storyboard/director ops usable over Mode B (live) runs — at minimum camera-follow-active-node, highlight and caption — since the Mode-A-only restriction blocks annotating exactly the runs operators watch.
- Details-on-demand: a tooltip/popover or click-to-inspect hook carrying owner, last error, log link. Operational graphs are entry points into other systems, and today there is nothing beyond a CSS hover stroke.
- Scale headroom past the 150-element culling threshold and ~300-node performance sample — real dbt projects and warehouse lineage are 1k-10k nodes, needing a documented LOD story (automatic container rollup, neighborhood-of-node views) rather than only manual containers.
- Headless/server-side still rendering without a browser: exportSVG is ESM-only and exportPNG browser-only, so CI docs builds and alerting bots cannot produce a figure without dragging in chromium.
- Lower deployment friction for the recording toolchain (chromium + ffmpeg) and smv-fit's inability to price run.play — together they make the narrated-video story, the library's most distinctive asset, harder to automate in a platform team's CI than it should be.
- Pre-1.0 versioning with no semver guarantee is a live adoption objection for anything wired into a nightly docs or dashboard build.
