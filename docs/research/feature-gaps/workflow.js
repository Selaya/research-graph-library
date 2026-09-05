export const meta = {
  name: 'graph-lib-gap-research',
  description: 'Survey other node/edge libraries for features sparkle-motion-visualizer lacks, verify each gap against the repo, and map additional use-cases',
  phases: [
    { title: 'Inventory', detail: 'one reader builds a capability inventory of this library', model: 'sonnet' },
    { title: 'Survey', detail: 'one agent per library cohort, web research + comparison', model: 'sonnet' },
    { title: 'Verify', detail: 'each claimed gap checked against the codebase', model: 'sonnet' },
    { title: 'Use cases', detail: 'perspective-diverse use-case brainstorm', model: 'opus' },
    { title: 'Critique', detail: 'completeness critic + one catch-up survey round', model: 'sonnet' },
    { title: 'Synthesize', detail: 'final prioritized report', model: 'opus' },
  ],
}

const REPO = '/home/user/research-graph-library'
const COMMON = `You are working inside the git repo at ${REPO} (library: sparkle-motion-visualizer, an embeddable animated SVG graph/pipeline visualization library, no framework, no build step). Your final output is raw data consumed by a script, not a message to a human. Web tools: call ToolSearch with query "select:WebSearch,WebFetch" to load them; the sandbox proxy may block some sites, so if a fetch fails, fall back to your own knowledge and mark that claim as "from memory" rather than "verified". Never invent version numbers; say "unknown" if you could not confirm.`

// ---------- Phase 1: inventory ----------
phase('Inventory')
const INVENTORY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    categories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          capabilities: { type: 'array', items: { type: 'string' } },
          knownLimits: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'capabilities'],
      },
    },
    publicApi: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'categories', 'publicApi'],
}

const inventory = await agent(`${COMMON}

Task: build a precise capability inventory of THIS library as shipped today. Read README.md fully, types/index.d.ts, package.json, docs/RUN.md, docs/LIVE.md, docs/RECORDING.md, docs/PRESETS.md, docs/THEMING.md, docs/EMBED.md, docs/DEVIATIONS.md, and skim src/index.js for anything undocumented. Also skim the file list in src/ and bin/.

Produce categories such as: data model (nodes/edges/compound/ports/labels/weights), layout (algorithms, directions, stability, component ordering), rendering (SVG, node shapes, edge routing, labels, culling), interaction (pan/zoom, tap, selection, drag, hover, tooltips, context menu), animation & transitions, execution/token engine (simulate + live modes), storyboard/director/camera/captions/recording, styling/theming, export (what formats), accessibility, querying, events, error model, tooling (CLIs, harness), distribution (CDN/ESM/types/bundle size), integrations/adapters. For each category list concrete capabilities AND known limits (things the docs explicitly say are NOT supported, e.g. "storyboards drive Mode A only", "no ports", "no drag"). Be exhaustive and concrete; another agent will use this to decide which features of other libraries are missing here, so a false "supported" or a missed capability both cause bad conclusions.`, {
  label: 'inventory', phase: 'Inventory', model: 'sonnet', effort: 'medium', schema: INVENTORY_SCHEMA,
})
if (!inventory) throw new Error('inventory agent failed')
const INV = JSON.stringify(inventory, null, 1)
log(`Inventory: ${inventory.categories.length} categories, ${inventory.publicApi.length} API entries`)

// ---------- Phase 2/3: survey cohorts, then verify gaps ----------
const COHORTS = [
  { key: 'cytoscape-sigma', libs: 'cytoscape.js (plus key extensions: expand-collapse, dagre/elk/fcose layouts, edgehandles, context-menus, popper, undo-redo, navigator), sigma.js + graphology (graph data model + algorithms package)' },
  { key: 'vis-echarts-plotly', libs: 'vis-network (incl. DataSet/DataView, physics, clustering, manipulation, hierarchical layout), Apache ECharts graph/sankey/tree series, Plotly network figures' },
  { key: 'antv-g6-x6', libs: 'AntV G6 v5 (combos, behaviors, plugins, animations, themes, layouts) and AntV X6 (ports, stencil, snapline, history, keyboard, clipboard, selection, minimap, dnd)' },
  { key: 'commercial-diagramming', libs: 'JointJS core + JointJS+ (commercial), GoJS, yFiles for HTML, Syncfusion Diagram — focus on what premium diagramming tiers offer (routing, ports, layouts, groups, undo/redo, palette, overview, printing, etc.)' },
  { key: 'react-flow-family', libs: 'React Flow / @xyflow/react + Svelte Flow (xyflow), Vue Flow, reaflow — node-based UI builders: handles/ports, edge types, node resizer/toolbar, minimap, controls, background, connection validation, sub-flows, helper lines, elkjs/dagre layout recipes' },
  { key: 'text-to-diagram', libs: 'mermaid (flowchart, sequence, state, gantt, gitGraph, timeline, block, architecture diagrams, themes, interaction callbacks), D2 (layouts, animations, icons, sql_table, sequence), Graphviz/viz.js/d3-graphviz (dot attributes, ports, clusters, rankdir, splines, animated transitions in d3-graphviz), PlantUML' },
  { key: 'd3-and-layout-engines', libs: 'd3 (d3-dag, d3-sankey, d3-hierarchy, d3-zoom, d3-drag, d3-transition, d3-force), dagre-d3, elkjs (ELK layout options: ports, orthogonal edge routing, layered/stress/mrtree/radial/disco, hierarchy handling, port constraints), cola.js (webcola constraints)' },
  { key: 'node-editors', libs: 'Rete.js, litegraph.js, drawflow, Baklava.js, Node-RED editor, n8n canvas, ComfyUI graph, Blender-style node editors (as a design reference), Unreal Blueprints visual language — editing/authoring features: sockets, typed connections, subflows, groups, comments, undo, copy/paste, minimap, execution highlighting' },
  { key: 'pipeline-orchestrator-uis', libs: 'Apache Airflow graph/grid view, Dagster asset graph & run timeline, Prefect flow run graph, Argo Workflows UI, Temporal UI, Kubeflow Pipelines, GitHub Actions workflow graph, GitLab pipeline graph (stages, needs DAG), Jenkins Blue Ocean, Tekton dashboard, Azure DevOps/Buildkite — how real pipeline UIs show status, logs, retries, durations, timelines/gantt, critical path, grouping, backfills' },
  { key: 'observability-and-state', libs: 'Jaeger/Grafana Tempo trace views & service graphs, Kiali service graph (animated traffic, health), Grafana node graph panel, Datadog/New Relic service maps, Perfetto/Chrome trace viewer (flame + flow arrows), XState/Stately visualizer & inspector (state machines, actor events), bpmn-js (BPMN modeling, token simulation plugin), Camunda' },
  { key: 'animation-and-presentation', libs: 'Motion Canvas, Manim (graph mobjects), Remotion, GSAP/Flip plugin, anime.js, Excalidraw & tldraw (hand-drawn diagrams, collaboration, frames, laser pointer, presentation mode), reveal.js/Slidev auto-animate, Figma Smart Animate, Loom/Screen Studio recording — what narrative/explainer/recording tooling offers' },
  { key: 'large-scale-and-analytics', libs: 'Cosmograph / cosmos.gl, Ogma (Linkurious), KeyLines/ReGraph (Cambridge Intelligence), Gephi Lite, ngraph/vivagraph, G6 large graph mode, graphology algorithms (centrality, communities, shortest path) — scale (WebGL, LOD, clustering), analytics, filtering, time bar/timeline, geo mode, search' },
]

const GAPS_SCHEMA = {
  type: 'object',
  properties: {
    cohort: { type: 'string' },
    libraries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' }, version: { type: 'string' }, license: { type: 'string' },
          url: { type: 'string' }, verified: { type: 'boolean' }, oneLine: { type: 'string' },
        },
        required: ['name', 'oneLine'],
      },
    },
    gaps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          category: { type: 'string' },
          libraries: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
          whyItMatters: { type: 'string' },
          designNotes: { type: 'string' },
          evidence: { type: 'string' },
          verified: { type: 'boolean' },
          fitScore: { type: 'integer' },
        },
        required: ['feature', 'category', 'libraries', 'description', 'whyItMatters', 'fitScore'],
      },
    },
    borrowableIdeas: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['cohort', 'libraries', 'gaps'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    cohort: { type: 'string' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          feature: { type: 'string' },
          status: { type: 'string', enum: ['missing', 'partial', 'present'] },
          evidence: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['feature', 'status', 'evidence'],
      },
    },
  },
  required: ['cohort', 'results'],
}

function surveyPrompt(c) {
  return `${COMMON}

Cohort to research: ${c.libs}

Here is the capability inventory of THIS library (sparkle-motion-visualizer), produced by reading its docs and source:
${INV}

Task: research the cohort libraries (documentation sites, GitHub READMEs, npm) and identify functionality they have that this library DOES NOT have, or has only partially. Think broadly: data model (ports/handles, typed edges, multi-edges, hyperedges, undirected, edge labels, node shapes/HTML nodes/images/icons), layout (algorithms, incremental, constraints, orthogonal/spline routing, edge bundling, radial/tree/force/grid), interaction (drag, select, box-select, edge creation, resize, context menus, tooltips, hover, minimap, navigator, search, filters, undo/redo, clipboard, keyboard), rendering (canvas/WebGL, LOD, themes, badges, progress rings), analytics (shortest path, centrality, clustering), time (timelines, gantt, time bar), collaboration, export (PNG/SVG/PDF/JSON/URL state), text DSL input, plugin architecture, i18n, server-side rendering, framework wrappers, testing tools. Only report as a gap what the inventory does not cover; if the inventory says it exists, do not list it. Aim for 10-25 concrete, specific gaps, not generic categories. For each gap give: which cohort libraries have it, a concise description of how they expose it (API names help), why it would matter for a pipeline/process-narration library like this one, optional design notes on how it could fit this library's model (spec/opts/method/storyboard op), evidence (URL or "from memory"), verified flag, and fitScore 1-5 (5 = obviously belongs in this library's remit; 1 = out of scope like physics simulation). Also list up to 8 "borrowable ideas": API shapes or UX patterns worth copying even where not a strict gap. Also report each library's current version/license/url if confirmed.`
}

function verifyPrompt(survey) {
  const gaps = survey.gaps.map(g => `- ${g.feature}: ${g.description}`).join('\n')
  return `${COMMON}

Another agent surveyed other graph libraries and claims the following features are missing or partial in THIS library. Your job: check each claim against the actual repo. Use Grep/Glob/Read over README.md, docs/, types/index.d.ts, src/, bin/, demo/ and test/. For each feature, decide: "present" (the library already does this, cite file:line or doc heading), "partial" (some of it exists, say which part and cite), or "missing" (you searched and found nothing; say what you searched for). Be skeptical of both directions: do not accept "missing" just because it was claimed, and do not accept "present" from a keyword match — read enough to be sure. Keep evidence concrete.

Cohort: ${survey.cohort}
Claimed gaps:
${gaps}`
}

const surveyed = await pipeline(
  COHORTS,
  c => agent(surveyPrompt(c), { label: `survey:${c.key}`, phase: 'Survey', model: 'sonnet', effort: 'medium', schema: GAPS_SCHEMA }),
  (survey, c) => survey ? agent(verifyPrompt(survey), { label: `verify:${c.key}`, phase: 'Verify', model: 'sonnet', effort: 'low', schema: VERIFY_SCHEMA })
    .then(v => ({ cohort: c.key, survey, verify: v })) : null,
)
const cohortResults = surveyed.filter(Boolean)
log(`Surveyed ${cohortResults.length}/${COHORTS.length} cohorts; ${cohortResults.reduce((n, r) => n + r.survey.gaps.length, 0)} claimed gaps`)
if (cohortResults.length < COHORTS.length) {
  log(`Dropped cohorts: ${COHORTS.filter((c, i) => !surveyed[i]).map(c => c.key).join(', ')}`)
}

// ---------- Phase 4: use-cases (runs concurrently with survey via parallel wrapper? keep after, needs inventory only) ----------
phase('Use cases')
const PERSPECTIVES = [
  { key: 'devtools-ci', who: 'a developer-tooling / CI-CD / build-system engineer (build graphs, CI pipelines, monorepo task graphs, deployment rollouts, dependency graphs)' },
  { key: 'data-eng', who: 'a data / ML platform engineer (ETL DAGs, dbt lineage, feature pipelines, training runs, backfills, data quality gates)' },
  { key: 'ai-agents', who: 'an engineer building or explaining LLM agent systems (multi-agent orchestration traces, tool-call graphs, planning trees, RAG pipelines, eval harnesses, agent replays for debugging)' },
  { key: 'ops-process', who: 'a business-process / operations analyst (approval workflows, order fulfillment, incident response runbooks, automation ROI storytelling: manual steps replaced by automated ones)' },
  { key: 'education', who: 'an educator or technical writer producing explainers (algorithm walkthroughs, distributed-systems protocols, request lifecycles, animated documentation, conference talks, YouTube videos)' },
  { key: 'observability', who: 'an SRE / observability engineer (service maps, distributed traces, dependency health, incident timelines, chaos experiments, capacity flows)' },
  { key: 'product-sales', who: 'a product manager or solutions engineer (interactive product demos, roadmap dependency maps, customer journey flows, embedded live status pages, before/after automation pitches)' },
  { key: 'systems-modeling', who: 'a systems / control / simulation modeler (state machines, Petri nets, queueing networks, supply chains, digital twins, discrete-event simulation replays)' },
]
const USECASE_SCHEMA = {
  type: 'object',
  properties: {
    perspective: { type: 'string' },
    useCases: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          exampleScenario: { type: 'string' },
          requiredFeatures: { type: 'array', items: { type: 'string' } },
          coverage: { type: 'string', enum: ['good', 'partial', 'poor'] },
          missingPieces: { type: 'array', items: { type: 'string' } },
          demand: { type: 'string', enum: ['high', 'medium', 'low'] },
          effort: { type: 'string', enum: ['small', 'medium', 'large'] },
          competingTools: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'description', 'requiredFeatures', 'coverage', 'missingPieces', 'demand', 'effort'],
      },
    },
    crossCuttingNeeds: { type: 'array', items: { type: 'string' } },
  },
  required: ['perspective', 'useCases', 'crossCuttingNeeds'],
}
const useCases = (await parallel(PERSPECTIVES.map(p => () => agent(`${COMMON}

Adopt the perspective of ${p.who}. Here is the capability inventory of THIS library:
${INV}

Also skim README.md's opening and demo/ (pipeline.html, sdlc.html) to feel what the library is built for today: narrating pipelines of work with tokens, expand/collapse, condense/split, storyboards, camera, captions, recording to video.

Task: propose 6-10 concrete use-cases from your perspective that a library like this could serve well (not generic "draw a graph"). For each: what the user is trying to do, a specific example scenario, the features required, honest coverage by today's library (good/partial/poor), the missing pieces named precisely (as features, e.g. "per-edge throughput label that updates from live events", not "better UX"), expected demand, implementation effort, and which existing tools people use for it today. Prefer use-cases that exploit what makes this library distinctive (animation, time, tokens, narration, embed-anywhere) over ones any generic graph library serves. End with cross-cutting needs that several of your use-cases share.`, {
  label: `usecase:${p.key}`, phase: 'Use cases', model: 'opus', effort: 'medium', schema: USECASE_SCHEMA,
})))).filter(Boolean)
log(`Use-case passes: ${useCases.length}/${PERSPECTIVES.length}, ${useCases.reduce((n, u) => n + u.useCases.length, 0)} use-cases`)

// ---------- Phase 5: completeness critic + one catch-up round ----------
phase('Critique')
const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    missingLibraries: { type: 'array', items: { type: 'string' } },
    missingFeatureAreas: { type: 'array', items: { type: 'string' } },
    dubiousGaps: { type: 'array', items: { type: 'object', properties: { feature: { type: 'string' }, why: { type: 'string' } }, required: ['feature', 'why'] } },
    notes: { type: 'string' },
  },
  required: ['missingLibraries', 'missingFeatureAreas', 'dubiousGaps'],
}
const gapDigest = cohortResults.map(r => `## ${r.cohort}\nlibs: ${r.survey.libraries.map(l => l.name).join(', ')}\n` +
  r.survey.gaps.map(g => `- [${(r.verify?.results || []).find(v => v.feature === g.feature)?.status || 'unverified'}] ${g.feature} (${g.category}; fit ${g.fitScore})`).join('\n')).join('\n\n')
const critic = await agent(`${COMMON}

A research sweep compared this library against these cohorts of node/edge libraries and produced this digest of claimed gaps (status in brackets is from a codebase verification pass):

${gapDigest}

Task, as a completeness critic: (1) name notable libraries, tools, or product categories in the node/edge/diagram/pipeline-visualization space that the sweep did not cover and that are likely to have features this library lacks (be specific: names, not categories); (2) name feature AREAS the digest is thin on, given this library's remit (animated, time-aware, narrated pipeline/process graphs, embeddable, no framework); (3) flag gaps in the digest that look dubious — out of scope, duplicated, or contradicted by the inventory. Keep each list tight and high-signal.`, {
  label: 'critic', phase: 'Critique', model: 'sonnet', effort: 'medium', schema: CRITIC_SCHEMA,
})
let catchup = null
if (critic && (critic.missingLibraries.length || critic.missingFeatureAreas.length)) {
  log(`Critic: ${critic.missingLibraries.length} missed libraries, ${critic.missingFeatureAreas.length} thin areas; running one catch-up survey`)
  const c = { key: 'catch-up', libs: `Libraries/tools the first sweep missed: ${critic.missingLibraries.join('; ')}. Feature areas the first sweep was thin on: ${critic.missingFeatureAreas.join('; ')}.` }
  const s = await agent(surveyPrompt(c), { label: 'survey:catch-up', phase: 'Critique', model: 'sonnet', effort: 'medium', schema: GAPS_SCHEMA })
  if (s) {
    const v = await agent(verifyPrompt(s), { label: 'verify:catch-up', phase: 'Critique', model: 'sonnet', effort: 'low', schema: VERIFY_SCHEMA })
    catchup = { cohort: 'catch-up', survey: s, verify: v }
    cohortResults.push(catchup)
  }
}

// ---------- Phase 6: synthesis ----------
phase('Synthesize')
const payload = JSON.stringify({ inventorySummary: inventory.summary, cohorts: cohortResults, useCases, critic }, null, 1)
const report = await agent(`${COMMON}

You are writing the final research report for the maintainer of sparkle-motion-visualizer. Below is the raw material: a capability inventory summary, per-cohort surveys of other node/edge libraries with each claimed gap's verification status against the codebase (present / partial / missing), use-case passes from eight perspectives, and a completeness critic's notes.

Write a Markdown document to be committed as docs/research/feature-gaps.md. Requirements:
- Title: "# Research: Feature gaps vs. other node/edge libraries, and additional use-cases". Below it a one-line note that this is a follow-up to landscape.md (which was a build-vs-adopt survey before the library existed) and that it compares the SHIPPED library.
- "## Summary": 6-10 sentences with the headline findings.
- "## Method": how the sweep worked (cohorts, verification against the repo, use-case perspectives, critic), and an honest limitations note (web access partially blocked; "from memory" claims; version numbers only where confirmed).
- "## Gap catalogue": group gaps by category (data model, layout & routing, interaction & editing, rendering & visuals, time & execution, analytics, input & export, integration & ecosystem, tooling, other). Each gap is ONE table row or bullet: feature; who has it; what this library does today (present/partial/missing, with the verifier's evidence); why it matters here; fit (1-5). DROP gaps verified as "present". Merge duplicates across cohorts. Keep every gap that survived — completeness matters more than brevity — but keep each entry tight.
- "## Borrowable ideas": API shapes and UX patterns worth copying, deduped, with the source library.
- "## Additional use-cases": one subsection per perspective; each use-case as a compact bullet: title, one-line scenario, coverage today, missing pieces, demand/effort. Then "### Cross-cutting needs": the requirements that recur across perspectives, each naming which use-cases want it.
- "## Prioritized recommendations": 10-15 items, ordered, each with: the feature, which gaps/use-cases it unlocks, rough effort, and a one-line sketch of how it fits the existing model (spec field / mount opt / g.method / storyboard op / run event / separate subpath export like a11y-table). Separate "in remit, do next", "in remit, later", and "out of scope, say no" (with reasons — e.g. physics, freeform editing, WebGL-scale rendering, if that is your judgement).
- "## Libraries surveyed": a table of every library touched: name, version (or "unknown"), license, one-line role, verified?.
- Cite evidence tersely. Use plain prose; no em-dashes; no emoji. Do not fabricate versions or URLs; carry through the verified flags.
Return ONLY the Markdown document.

RAW MATERIAL:
${payload}`, {
  label: 'synthesis', phase: 'Synthesize', model: 'opus', effort: 'high',
})

return { report, cohorts: cohortResults, useCases, critic, inventory }