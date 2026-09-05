# Cohort survey: pipeline-orchestrator-uis
> Part of the [feature-gap research corpus](../README.md) · 2026-09-05 · sonnet survey agent, then a sonnet verifier that checked every claim against this repo.

**Scope given to the survey agent:** Apache Airflow graph/grid view, Dagster asset graph & run timeline, Prefect flow run graph, Argo Workflows UI, Temporal UI, Kubeflow Pipelines, GitHub Actions workflow graph, GitLab pipeline graph (stages, needs DAG), Jenkins Blue Ocean, Tekton dashboard, Azure DevOps/Buildkite — how real pipeline UIs show status, logs, retries, durations, timelines/gantt, critical path, grouping, backfills

**Verification tally:** 20 claimed gaps: 15 missing, 5 partial, 0 present.

## Libraries

| Library | Version | License | URL | Verified | Role |
| --- | --- | --- | --- | --- | --- |
| Apache Airflow | unknown (rolling; 2.x/3.x UI referenced) | Apache-2.0 | https://airflow.apache.org/docs/apache-airflow/stable/ui.html | no | Grid view (matrix of DAG runs x tasks over time) + Graph view (DAG topology) with per-task-instance retry history, gantt view, and duration/landing-time charts. |
| Dagster | unknown | Apache-2.0 | https://docs.dagster.io/guides/operate/webserver | yes | Asset graph UI with horizontal/vertical layouts, run Gantt chart, global run timeline grouped by code location, and partitioned time-range timeline view. |
| Prefect | unknown | Apache-2.0 | https://docs.prefect.io | no | Flow run graph with radar/timeline views, task run states, and a run timeline (flow-run duration bar with nested task spans). |
| Argo Workflows | 3.6.x referenced in blog | Apache-2.0 | https://argoproj.github.io/workflows/ | yes | Argo Server UI renders DAG/steps templates, per-node logs, retry-from-failed-node, suspend/resume, and template-ref node grouping. |
| Temporal UI | unknown | MIT | https://docs.temporal.io/web-ui | yes | Event History Timeline groups related raw events (scheduled/started/completed) into single spans, hover tooltips with exact ms duration, live pause/filter, and nested child-workflow timelines inline. |
| Kubeflow Pipelines | unknown | Apache-2.0 | https://www.kubeflow.org/docs/components/pipelines/ | no | Pipeline run graph UI with per-step artifacts/metrics panel, run comparison, and cached-step visual indicator. |
| GitHub Actions | n/a (SaaS feature) | proprietary (GitHub) | https://docs.github.com/actions/managing-workflow-runs/using-the-visualization-graph | yes | Real-time color-coded job dependency graph per run, click-through to logs, matrix-job fan-out visualization, partial re-run (only re-run jobs appear in downloaded logs). |
| GitLab CI/CD Pipelines | n/a (SaaS/self-managed feature) | proprietary/MIT-mixed (GitLab CE/EE) | https://gitlab.com/gitlab-org/gitlab/-/work_items/328538 | yes | Pipeline graph with toggleable 'Group jobs by' stage-view vs job-dependencies(needs)-view, showing needs-based DAG columns distinct from declared stage order. |
| Jenkins Blue Ocean | unknown (project now in maintenance mode) | MIT | https://www.jenkins.io/projects/blueocean/ | no | Simplified linear/parallel pipeline visualization with inline step logs, per-stage duration bars, and a dedicated parallel-branches view. |
| Tekton Dashboard | unknown | Apache-2.0 | https://tekton.dev/docs/dashboard/ | no | Web UI for TaskRun/PipelineRun DAG visualization with live log streaming per step and pipeline run duration display. |
| Azure DevOps Pipelines | n/a (SaaS) | proprietary (Microsoft) | https://learn.microsoft.com/en-us/azure/devops/pipelines/ | no | Stage/job dependency graph view plus a separate timeline/analytics view showing historical run-duration trends per stage. |
| Buildkite | n/a (SaaS) | proprietary (Buildkite) | https://buildkite.com/resources/blog/visualize-your-ci-cd-pipeline-on-a-canvas/ | yes | Build 'canvas' DAG view of pipeline steps/dependencies, rich Markdown/HTML annotations attached to a build, manual+automatic retries, and a Job Retries report showing flakiness trends over 30 days. |

## Claimed gaps, with verification

Status and repo evidence come from the verifier; everything else from the survey. Fit is the survey agent's 1 to 5 score for how well the feature belongs in this library's remit.

### 1. Gantt / timeline layout mode (x-axis = time)

- **Category:** layout/time · **Fit:** 5/5 · **Verified in repo:** `missing`
- **Who has it:** Airflow (Gantt view); Dagster (run Gantt chart, global run timeline); Temporal UI (Timeline view); Prefect (timeline/radar view); GitLab (job duration bars)
- **What they offer:** A dedicated view where node/step boxes are positioned and sized along a horizontal time axis rather than by graph rank, so parallel steps stack as rows and duration is directly readable as bar width.
- **Why it matters here:** This is the single most common feature across every real pipeline UI in the cohort — for narrating an actual run (not just topology), viewers expect to see 'this took 4x longer than that' spatially, not just via a number in a token.
- **How it could fit:** The inventory already explicitly flags this as skipped by design ('No Gantt/temporal layout mode ... explicitly skipped'). Could be a second LayoutSolver variant driven by run.state() node timings rather than rank, or a separate lightweight renderer reusing node/edge styling.
- **Survey evidence:** https://docs.dagster.io/guides/operate/webserver ; https://docs.temporal.io/web-ui (verified)
- **Repo check:** docs/DEVIATIONS.md:273-278 explicitly: '## 11. Gantt/temporal layout mode: skipped (M3) ... Implementation: not built. No demand has materialized... a temporal mode is another opts.solver, not a fork of layout.js.' Explicitly deferred, never implemented.
- **Verifier note:** Also referenced only as a research idea in docs/research/ux.md, never shipped in src/layout.js.

### 2. Manual retry-from-failed-node in the UI (partial re-run)

- **Category:** execution/interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** Argo Workflows (retry single failed node); GitHub Actions (re-run failed jobs); GitLab (retry job); Buildkite (manual + automatic retry, Job Retries report)
- **What they offer:** An interactive affordance to re-run only the failed step (or failed branch downstream) rather than the whole pipeline, with the retried attempt visually distinguished (attempt count, prior-failure ghost).
- **Why it matters here:** Retry is one of the most common real-world pipeline actions users watch/narrate; the library has bounded loop-edge iteration for simulated retries but no notion of 'retry this failed step from here' as a run-engine action distinct from a pre-declared loop edge.
- **How it could fit:** Could extend Mode B with a run.retry(nodeId) transport op that resets a failed node to pending and re-fires just its subtree, plus a 'retryCount' badge alongside the existing loop-iteration badge.
- **Survey evidence:** https://github.com/argoproj/argo-workflows/issues/12022 ; https://buildkite.com/docs/pipelines/configure/retry (verified)
- **Repo check:** src/run-live.js and README.md only support declared `loop: true` / `maxIterations` edges replayed automatically from a pre-supplied event log (run.fail(), replayLive()); grep for 'attempt', 'ghost', 'prior-failure', 'retry button' across README.md and src/ found nothing.
- **Verifier note:** There is no interactive UI affordance to click-retry a failed node; the library has no click/UI operational actions at all (only tap-to-expand/collapse in src/interact.js).

### 3. needs/DAG vs stage-order dual grouping toggle

- **Category:** data model/layout · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** GitLab (Group jobs by: stage vs job dependencies)
- **What they offer:** Same pipeline data can be viewed either grouped by declared stage (sequential swimlanes) or grouped by actual dependency depth via 'needs' — a live toggle between two different structural groupings of the identical job set.
- **Why it matters here:** Pipeline narration often needs to contrast the declared/authored grouping (stages, phases) against the true execution dependency depth; this library only has one computed rank order per layout call.
- **How it could fit:** Could be modeled as an alternate 'group by' key on nodes (e.g. node.data.stage) with a toggle that swaps componentOrder/rank grouping between topology-rank and declared-stage without a full relayout choreography change.
- **Survey evidence:** https://gitlab.com/gitlab-org/gitlab/-/work_items/328538 (verified)
- **Repo check:** Searched src/layout.js, src/viewstate.js, README.md, types/index.d.ts for 'swimlane', 'stage', 'grouping toggle' — no matches. Layout is single dependency-rank based (dagre-derived in-house layered layout, README.md:120).
- **Verifier note:** No concept of a second grouping mode or a toggle between them exists anywhere in the codebase.

### 4. Event-grouping / collapsing raw events into a single meaningful span

- **Category:** execution/rendering · **Fit:** 4/5 · **Verified in repo:** `partial`
- **Who has it:** Temporal UI (Event Groups: Scheduled/Started/Completed collapse into one Activity row/span)
- **What they offer:** Related low-level events for one logical unit are automatically merged into a single visual span with a start/end/duration, rather than showing each raw event as a separate marker.
- **Why it matters here:** Mode B's append-only event log (start/finish/fail/spawn) is exactly this shape; currently each event maps to a status transition but there's no first-class 'span' abstraction bundling start->finish into one visual/queryable unit with duration.
- **How it could fit:** Could be a computed helper on RunState — e.g. run.spans() returning {nodeId, start, end, duration, status} per node occupancy — useful both for the (currently absent) Gantt layout and for tooltips/export.
- **Survey evidence:** https://docs.temporal.io/workflow-execution/event (verified)
- **Repo check:** src/condense-anim.js and src/split-anim.js implement `g.condense([ids], newNode)` (README.md:92-95) which visually merges N *nodes* into one with a duration-shrink/odometer animation — but this operates on declared graph nodes via an explicit API call, not on automatically collapsing raw low-level run *events* into a derived span.
- **Verifier note:** Closest analog is node condense/split, which is topologically similar but event-log based grouping (e.g. many log lines -> one span) was not found; grep for 'event.*group'/'collapse.*event' returned nothing.

### 5. Rich per-step annotations (Markdown/HTML attached to a run, not just a caption)

- **Category:** rendering/interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Buildkite (buildkite-agent annotate — Markdown+HTML+images attached to a build); Argo (per-step logs)
- **What they offer:** Steps can attach arbitrary rich content (test summaries, links, images) surfaced in the UI beyond a simple text label, persisted with the run/build.
- **Why it matters here:** The library's caption overlay is a single global narration overlay; it has no notion of a per-node rich annotation panel a viewer can open to see build/test output detail.
- **How it could fit:** Could extend node.data with an optional `annotation` (markdown/html string) and a click/tap affordance (already has tap-to-toggle for containers) to open a detail panel — but this pushes toward building actual UI chrome, a bigger scope increase than most other gaps.
- **Survey evidence:** https://buildkite.com/docs/pipelines/best-practices/pipeline-design-and-structure (verified)
- **Repo check:** grep -rniE 'annotation|markdown' across README.md/src/types found zero matches. Node data model in types/index.d.ts only exposes `label`, `data`, `status`, duration-chip fields for the pipeline preset (src/preset-pipeline.js) — plain text/number fields only.
- **Verifier note:** No mechanism for arbitrary rich content (HTML/Markdown) attached to a node/run was found.

### 6. Live log streaming per node/step

- **Category:** execution/interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Argo Workflows (per-step logs); Tekton Dashboard (live log streaming per step); GitHub Actions (click job -> log viewer with search); Jenkins Blue Ocean (inline step logs)
- **What they offer:** Clicking/selecting a node opens a scrollable, often live-tailing, text log panel specific to that step's execution.
- **Why it matters here:** Universal across every real pipeline UI in the cohort as the primary debugging surface; this library has no built-in tooltip/detail-panel system at all (explicitly a known limit) so it's structurally furthest from this.
- **How it could fit:** Out of the library's stated remit (it's a visualization/narration layer, not a log viewer) — best left to consumer-built presets via the existing preset contract and click events, rather than a core feature.
- **Survey evidence:** from memory (Argo/Tekton/GH Actions/Blue Ocean log viewers are longstanding, well-known features) (from memory / unverified)
- **Repo check:** grep -rniE 'log stream|tail|live log' across the repo returned no relevant hits (only unrelated words). No log-panel component exists in src/ (render.js, scene.js, viewport.js contain no text-panel/log UI).
- **Verifier note:** Library renders only the graph/tokens/status; it has no concept of a per-step scrollable log.

### 7. Run comparison / diff between two runs of the same pipeline

- **Category:** analytics/rendering · **Fit:** 3/5 · **Verified in repo:** `partial`
- **Who has it:** Kubeflow Pipelines (run comparison UI); Airflow (grid view compares task-instance state across many DAG runs at once)
- **What they offer:** Side-by-side or overlaid comparison of two executions of the same graph (durations, statuses, outputs) to spot regressions.
- **Why it matters here:** Pipeline narration often wants to say 'this run vs last run' — a natural extension of Mode B's log/state model, but nothing in the inventory computes a diff between two RunState snapshots.
- **How it could fit:** Could be a pure function `diffRuns(stateA, stateB)` returning per-node status/duration deltas, consumed by a preset to color nodes by delta rather than absolute status — no core rendering change needed.
- **Survey evidence:** from memory (Kubeflow's run comparison view is a known, documented feature); Airflow grid view cross-run comparison verified conceptually only (from memory / unverified)
- **Repo check:** src/diff.js implements `diffKeys(oldIterable, newIterable)` -> {enter,update,exit}, but this is the internal keyed diff used by scene.commit() to animate spec mutations, not a run-vs-run comparison feature; README.md 'small-multiples diff' is mentioned only in docs/research/ux.md:7 as a research proposal, not shipped.
- **Verifier note:** No UI/API for comparing two separate run executions (durations/status side-by-side) was found in src/run.js, src/run-live.js, or README.md.

### 8. Matrix/fan-out job visualization with collapsible combination count

- **Category:** data model/rendering · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** GitHub Actions (matrix strategy visual indicator with combination count)
- **What they offer:** A single declared step that expands into N parallel job instances (one per matrix axis combination) is shown as a group with a count badge, expandable to see each combination's individual status.
- **Why it matters here:** The library's container collapse/expand + meta-edge weight aggregation is conceptually close (data-count badge, weight badge) but is structural (parent/child), not tied to a 'this one step ran N times with different params' concept generated implicitly from a spec.
- **How it could fit:** Likely achievable today via existing container + join:'any'/duration-per-child modeling rather than a new primitive — flagging as a partial/soft gap, not a hard one.
- **Survey evidence:** https://docs.github.com/actions/managing-workflow-runs/using-the-visualization-graph (verified)
- **Repo check:** README.md:328 `run.spawn("test", 3)` creates runtime fan-out tokens shown as an 'occupancy badge ×3' (src/render.js:290 `st.count > 0 ? \`×${st.count}\` : ""`), and collapsed container nodes show a similar ×N child-count badge with expand/collapse (src/interact.js, src/viewstate.js).
- **Verifier note:** Generic count-badge + expand/collapse exists, but it is not matrix-axis-aware (no per-combination labeling of e.g. os×version); it is a general occupancy/child-count mechanism repurposed for this use.

### 9. Historical duration trend / flakiness analytics across many runs

- **Category:** analytics · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Buildkite (Job Retries report: 30-day flakiness graphic); Azure DevOps (timeline/analytics view of historical stage durations); Airflow (duration/landing-time charts across DAG runs)
- **What they offer:** Aggregate charts (not single-run visualization) showing how a given step's duration or failure/retry rate trends over many historical executions.
- **Why it matters here:** This library's Mode A/B model is single-run-scoped (one GraphSpec, one run); there's no concept of aggregating N runs' worth of durationAgg/status into a trend, which every mature pipeline UI provides as an operational feature.
- **How it could fit:** Genuinely out of scope for an SVG graph/pipeline visualization+narration library — this is a metrics/observability product feature, not a graph-rendering one; consumer would compute and feed via node.data or a separate chart, not this library.
- **Survey evidence:** https://buildkite.com/docs/pipelines/configure/retry (verified)
- **Repo check:** grep -rniE 'trend|flak' across repo returned nothing relevant. src/run.js and src/run-live.js model a single run's simulated/live token flow only; there is no store of multiple historical runs or aggregate chart component.
- **Verifier note:** n/a

### 10. Suspend/resume (manual gate) mid-run with UI resume button

- **Category:** execution/interaction · **Fit:** 4/5 · **Verified in repo:** `missing`
- **Who has it:** Argo Workflows (suspend/resume steps, resumable via UI or CLI); Azure DevOps (manual approval gates between stages)
- **What they offer:** A run can pause at a designated node awaiting explicit human action (click 'resume' / 'approve') rather than a timer or upstream completion, shown as a distinct 'waiting for approval' status.
- **Why it matters here:** Mode B has start/finish/fail/spawn but no 'awaiting manual approval' status distinct from 'active'/'pending'; approval gates are a very common real pipeline step (deploy-to-prod approvals) that pipeline-narration content frequently needs to depict.
- **How it could fit:** Could be a new node status value ('waiting') settable via a Mode B call like run.suspend(id) / run.approve(id), rendered via existing data-status CSS hook — low structural cost, fits the append-only event model.
- **Survey evidence:** from memory (Argo Workflow suspend template + Azure DevOps manual approval gates are well-documented standard features) (from memory / unverified)
- **Repo check:** grep -rniE 'resume|approve|gate' across README.md/src returned no relevant matches beyond generic English word collisions; run status enum in types/index.d.ts:336 is only "pending"|"active"|"done"|"failed" — no 'waiting'/'paused' status, and no resume() API in src/run.js or src/run-live.js exports.
- **Verifier note:** No manual-gate concept exists.

### 11. Backfill visualization (many historical DAG runs replayed/queued at once)

- **Category:** execution/time · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Airflow (backfill runs shown in grid view as additional run columns)
- **What they offer:** Triggering execution for a range of historical logical dates at once, visualized as multiple run-columns filling in past time slots in the grid view.
- **Why it matters here:** Cohort brief explicitly calls out backfills; this is fundamentally a multi-run, calendar-indexed concept the single-graph/single-run model here has no representation for.
- **How it could fit:** Out of scope for a single-graph-instance library; would require a wrapper concept ('many mounted instances or a meta-timeline of runs') outside this library's current unit of work (one GraphSpec + one run).
- **Survey evidence:** from memory (Airflow grid view backfill display is a well-known, longstanding feature) (from memory / unverified)
- **Repo check:** grep -rniE 'backfill' across the repo returned zero hits. The library visualizes one graph/one run at a time (README.md scope); no run-grid/columns-of-runs feature found in src/ or README.md.
- **Verifier note:** n/a

### 12. Critical-path highlighting

- **Category:** analytics/rendering · **Fit:** 5/5 · **Verified in repo:** `missing`
- **Who has it:** Argo Workflows / general pipeline UI convention (bottleneck identification via DAG + duration); implied across Dagster/Temporal gantt views
- **What they offer:** Automatic computation and visual emphasis (distinct edge/node color) of the longest-duration dependency chain through the graph — the path actually determining total run time.
- **Why it matters here:** Directly explains 'why did this take so long' — a natural fit given the library already has durationAgg on nodes and a full run/state model; currently there's no shortest/longest-path graph algorithm at all (explicit known limit: 'no path-finding').
- **How it could fit:** A pure function over spec+durations (or RunState) returning the critical-path node/edge id set, consumable via existing g.style(fn)/highlight director op (data-emph='focus') — no rendering primitive needed, just an analytics helper.
- **Survey evidence:** from memory (critical path / bottleneck highlighting is a widely cited feature across Argo/Buildkite/general CI dashboards, though no single cohort doc page was fetched verifying an explicit UI toggle named 'critical path') (from memory / unverified)
- **Repo check:** grep -rniE 'critical.path|criticalPath' across the entire repo (including docs/) returned zero matches.
- **Verifier note:** No automatic longest-chain computation or distinct styling for it exists anywhere.

### 13. Minimap / navigator overlay for large graphs

- **Category:** interaction/rendering · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** Kubeflow Pipelines (canvas minimap); Buildkite (canvas pipeline view); general large-DAG UIs in the cohort (Airflow graph view, Argo)
- **What they offer:** A small always-visible overview thumbnail of the whole graph with a viewport rectangle, letting users jump-pan on large graphs.
- **Why it matters here:** Given viewport culling kicks in above 150 elements, the library already anticipates large graphs, but has no wayfinding aid — panning/zooming is the only navigation for a big graph.
- **How it could fit:** Could be a preset (per the preset contract) reading g.bounds()/viewport state and rendering a secondary small SVG with a draggable rect calling viewport.anchor() — buildable without core changes given the documented public API.
- **Survey evidence:** from memory (minimaps are a standard feature of most large-canvas pipeline/DAG UIs, including Kubeflow's pipeline canvas) (from memory / unverified)
- **Repo check:** docs/research/ux.md:17 and docs/research/critique.md:150,230 discuss a minimap only as a proposed *optional, not-core* component ('Minimap as an optional overlay component, not core' / 'keeping ... minimap ... as ESM-only optional entries'); no minimap implementation file exists in src/ (no minimap.js, no references in render.js/viewport.js).
- **Verifier note:** Purely a research/planning idea, never implemented in shipped code.

### 14. Search / filter across nodes by name or status

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `partial`
- **Who has it:** Airflow (search DAGs/tasks); GitHub Actions (log search box); Temporal UI (filter by Event Type / Pending & Failed Only)
- **What they offer:** A text/status filter that highlights or isolates matching nodes/steps in a large graph or log, common as a toolbar affordance.
- **Why it matters here:** The library's g.nodes(filter) is a read-only query API, not an interactive UI filter with visual highlight/dim of matches — no built-in search box or filter-to-spotlight wiring.
- **How it could fit:** g.nodes(filter) + g.highlight({nodes, dim:true}) already compose to build this; genuinely just missing UI chrome (an input box), which is arguably out of scope for a headless-styling library — flagging as a soft/thin gap.
- **Survey evidence:** https://docs.temporal.io/web-ui (verified)
- **Repo check:** src/query.js's `makeQuery(store).nodes(filter)` / `.edges(filter)` supports a predicate or match-object filter (e.g. README.md:222 `g.nodes({ data: { status: "done" } })`), giving a programmatic API-level filter/query.
- **Verifier note:** This is a JS query API for developers, not a toolbar UI affordance that highlights/isolates matching nodes visually for an end user — no such UI component found in src/render.js or src/interact.js.

### 15. Progress ring / percentage indicator per node

- **Category:** rendering · **Fit:** 4/5 · **Verified in repo:** `partial`
- **Who has it:** general pipeline dashboards (progress bars per running step, e.g. Azure DevOps, Buildkite job progress)
- **What they offer:** A radial or linear progress indicator on an in-flight node showing % complete of its expected duration, not just a binary active/done state.
- **Why it matters here:** Mode A/B track occupancy and status but node rendering has pulses/badges, not a proportional progress visualization tied to elapsed/expected duration — useful for long-running steps in narration.
- **How it could fit:** Could be driven by run.state().nodes[id].progress (already exists per the RunState shape: '{status,progress,occupancy}') via a --smv-* custom property (e.g. --smv-progress) consumed by a conic-gradient or stroke-dasharray ring — the data already exists, only the visual isn't documented as shipped.
- **Survey evidence:** from memory; cross-referenced against the inventory's own RunState.progress field which is undocumented as driving any specific visual (from memory / unverified)
- **Repo check:** types/index.d.ts:330,336-337 defines token position as `{kind, id, progress: number}` and node run-state includes `progress: number` ("A failed node reports progress:1 and occupancy:0"), used to drive the animated token pulse along edges/nodes (src/run-render.js).
- **Verifier note:** Progress is tracked and animated as motion along the path/node (a moving pulse implies traversal %), but there is no radial/linear progress-ring visual widget on the node itself distinct from binary status styling — no 'ring'/'percent' rendering code found in src/render.js or src/preset-pipeline.js.

### 16. Parallel-branch dedicated lane view (Blue Ocean-style)

- **Category:** layout/rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Jenkins Blue Ocean (distinct simplified parallel-branch visualization, branches as horizontal lanes)
- **What they offer:** A specialized, simplified layout mode purpose-built for parallel stages, rendering each branch as a clean horizontal lane rather than a general layered graph.
- **Why it matters here:** The general Sugiyama engine handles this structurally but doesn't offer a named 'lane view' mode; mostly redundant with the existing layered engine's LR mode, so a thin gap.
- **How it could fit:** Achievable today via dir:'LR' plus componentOrder pinning; likely doesn't need a new capability, just documentation/preset guidance.
- **Survey evidence:** from memory (Blue Ocean's parallel-stage lane visualization is a well-known distinguishing UI feature, though the project itself is now community-maintained/legacy) (from memory / unverified)
- **Repo check:** grep -rniE 'swimlane|lane' across src/, README.md, types/ returned no matches (only unrelated hits in docs/research). src/layout.js only implements one general layered/rank-based DAG layout (README.md:120), no alternate simplified branch-lane layout mode.
- **Verifier note:** n/a

### 17. URL/deep-link state (shareable link to a specific run/step/time position)

- **Category:** export/state · **Fit:** 3/5 · **Verified in repo:** `missing`
- **Who has it:** GitHub Actions, GitLab, Argo, Temporal — all support linking directly to a specific run/job/step via URL; Airflow (deep link to a DAG run + task instance)
- **What they offer:** Encoding current view state (which run, which node selected, current scrub time) into the URL/query string so it's shareable and restorable on load.
- **Why it matters here:** For narration/report use cases (this library's storyboard/recording niche), a 'link straight to time T of storyboard step X' complements existing g.timeline()/g.cues() nicely but isn't itself provided.
- **How it could fit:** Could be a thin helper exporting/importing {storyStep, runTime, viewport} as a URLSearchParams-serializable object, layered on existing g.timeline()/run.seek()/viewport.anchor() — no core engine change, a small optional module akin to cues/fit.
- **Survey evidence:** from memory (deep-linkable run/job URLs are standard across GitHub Actions, GitLab, Argo, and Temporal UIs) (from memory / unverified)
- **Repo check:** grep -rniE 'deep.link|deeplink|hash.*state|URL state' across the repo returned zero hits; src/viewstate.js manages only expand/collapse view state in-memory (createViewState(store)), with no serialization to/from URL/query string.
- **Verifier note:** n/a

### 18. Undo/redo of graph edits

- **Category:** interaction · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** general workflow-graph editors (Kubeflow Pipelines' visual editor, workflow-editor style tools referenced in GH Actions ecosystem)
- **What they offer:** History stack allowing an editor-mode user to step backward/forward through structural graph edits.
- **Why it matters here:** This library is a visualization/playback tool, not a graph *editor* (no node dragging, no drag-to-connect edges) — undo/redo of edits is only relevant if editing is in scope, which it explicitly isn't.
- **How it could fit:** Out of scope given the library has no edit-by-dragging interaction model at all; would only matter if the library grew an editing mode.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** grep -rniE 'undo|redo' across the repo returned zero hits in src/, README.md, or types/.
- **Verifier note:** There is no editor mode at all — the library is a visualization/animation layer over programmatically-supplied specs, not an interactive graph editor.

### 19. Context menu (right-click actions per node: retry, view logs, skip, etc.)

- **Category:** interaction · **Fit:** 2/5 · **Verified in repo:** `missing`
- **Who has it:** Argo Workflows UI, GitLab pipeline graph, Azure DevOps (right-click/kebab menu per job: retry, cancel, skip)
- **What they offer:** Per-node contextual action menu exposing operational actions (retry, cancel, view logs, download artifact).
- **Why it matters here:** Directly named as a known limit already ('No context menu (right-click menu) support') — cohort confirms this is standard in real pipeline UIs for surfacing retry/cancel/logs actions.
- **How it could fit:** Given the library is explicitly not an editor/ops console, this is best left to a consumer-built preset wired to click events + g.props()/highlight rather than a core feature; the library's stance (imperative API + presets) already supports building it externally.
- **Survey evidence:** from memory, corroborated generally by Argo/GitLab retry-in-UI and Buildkite manual retry findings above (from memory / unverified)
- **Repo check:** grep -rniE 'context menu|contextmenu' across the repo returned zero hits. src/interact.js (the only pointer-interaction module) implements exactly one gesture: tap-to-toggle expand/collapse of container nodes; no right-click/contextmenu handler exists.
- **Verifier note:** n/a

### 20. Multiple simultaneous run/lane overlay (compare live parallel executions of different graphs)

- **Category:** execution/rendering · **Fit:** 1/5 · **Verified in repo:** `missing`
- **Who has it:** Azure DevOps multi-stage pipeline overview, Airflow grid view (many runs as rows)
- **What they offer:** Dashboard-level view stacking multiple pipeline runs (possibly of different graphs) as rows/lanes for at-a-glance fleet monitoring, distinct from visualizing one graph's one run.
- **Why it matters here:** This library's unit of work is one mounted graph with one run; fleet/dashboard-level multi-run overview is a different product layer entirely.
- **How it could fit:** Out of scope — would be a consumer application built by mounting multiple instances, not a capability the library itself should add.
- **Survey evidence:** from memory (from memory / unverified)
- **Repo check:** src/run.js/src/run-live.js compileRun()/replayLive() operate against a single store/graph instance per `g` (see README.md:281 `run.state()` returning one run's {tokens,nodes,edges,joins,loops,done}); no multi-graph/multi-run dashboard aggregation code found in src/index.js or README.md.
- **Verifier note:** README.md:405 mentions drawing 'four parallel pipelines in one graph' with no edges between them as a layout trick, but that is still one graph/one g instance, not a dashboard of independent runs as rows/lanes.

## Borrowable ideas

- Temporal's Event Group abstraction (collapse raw scheduled/started/completed events into one span with duration) — worth adding as a pure `run.spans()` helper even without a Gantt renderer, since it's cheap and unlocks tooltips/export/Gantt later.
- GitLab's dual grouping toggle (stage-order vs dependency-order) as a UX pattern: same data, switchable structural view, is a clean model for 'declared grouping' vs 'computed rank' without needing two separate graphs.
- Argo's template-ref node grouping (collapse repeated invocations of the same template into one visual group) parallels this library's condense() nicely — worth citing as a naming/UX precedent for condense in docs/examples.
- Buildkite's Job Retries report (aggregate flakiness view) — even though out of scope as a core feature, the *pattern* of exposing retry/failure counts as data (not just visual) suggests exporting a simple `run.retryStats()`-style summary alongside run.log() would be low-cost and useful for consumers building dashboards.
- GitHub Actions' 'only re-run jobs appear in the downloaded log archive' pattern — a precedent for scoping exports (e.g. exportSVG of only the retried subtree) that could inform a future partial-export option.
- Temporal's live-pause-then-inspect timeline (pause live event stream to freeze and investigate) maps directly onto this library's Mode B follow()/seek() two-clock model — good validation that the two-clock design matches real-world UI expectations; worth highlighting as a doc example ('pause a live run like Temporal's UI').
- Dagster's Overview page grouping the run timeline 'by code location' — a precedent for optional grouping/lane keys on the global timeline concept, relevant if a Gantt mode is ever built (group lanes by node.data.group or similar).
- GitLab/Argo's consistent color-coding + iconography convention (status -> color mapped 1:1, reused everywhere) validates this library's data-status/--smv-* token approach; no action needed, just confirms the design direction is aligned with real-world conventions.

## Survey notes

Research relied on a mix of live WebSearch results (Argo, GitLab, Dagster, GitHub Actions, Temporal, Buildkite queries all returned and were fetched successfully) and prior knowledge (Airflow, Prefect, Kubeflow, Jenkins Blue Ocean, Tekton, Azure DevOps) marked verified:false / 'from memory' since no direct fetch was performed for those in this pass. No version numbers could be confirmed for any cohort tool (most are rolling-release SaaS or fast-moving OSS docs without a single canonical version string on the pages found) — all left as 'unknown' per instructions rather than guessed. The single biggest, most consistently-cited gap across nearly every cohort tool is a time-axis (Gantt/timeline) view, which the inventory already flags as a deliberate, explicit exclusion — this is the headline finding. Critical-path highlighting and a manual 'suspend/awaiting-approval' node status are the two next-most-actionable, high-fit gaps given how close the existing data model (durationAgg, RunState, join policies) already is to supporting them with a pure-function/status-value addition rather than new rendering primitives.
