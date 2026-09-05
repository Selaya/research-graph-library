# Feature-gap research corpus

Raw material behind [../feature-gaps.md](../feature-gaps.md), the synthesized report. Produced 2026-09-05 by one orchestrated workflow ([workflow.js](./workflow.js)) of 37 agents; the synthesized report merges and de-duplicates what is here, so this corpus is where to look for the full description, design notes and evidence behind any single row of the report.

## How it was produced

1. **Inventory** ([inventory.md](./inventory.md)): one sonnet agent read the shipped library (README, types, docs, src/index.js) and wrote the capability baseline every later claim was judged against.
2. **Survey** (`cohorts/`): twelve sonnet agents, one per cohort of related libraries, each given the inventory and asked for 10 to 25 concrete features the cohort has that this library lacks, with evidence, design notes and a 1 to 5 fit score. Web access went through the sandbox proxy, which blocked several documentation sites; claims that could not be fetched are marked as from memory.
3. **Verify** (same files): for each cohort a second sonnet agent, at low effort, checked every claimed gap against this repository with Grep/Read and labelled it `present`, `partial` or `missing` with file and line evidence. Rows are matched to claims by position; where the verifier rephrased the claim its wording is shown too.
4. **Use cases** (`use-cases/`): eight opus agents, each adopting one professional perspective, proposed 6 to 10 use-cases with required features, honest coverage by today's library, missing pieces, demand, effort and competing tools.
5. **Critique** ([critic.md](./critic.md)): a sonnet critic reviewed the digest of all first-round gaps for missed prior art, thin feature areas and dubious claims; its findings scoped a thirteenth catch-up survey and verification round.
6. **Synthesis**: an opus agent at high effort wrote [../feature-gaps.md](../feature-gaps.md) from everything above. Two counts in its summary were corrected by hand against this corpus.

## Cohort surveys

261 claimed gaps in total: 212 missing, 45 partial, 4 present.

| Cohort | Claimed gaps | Missing | Partial | Present |
| --- | --- | --- | --- | --- |
| [cytoscape-sigma](./cohorts/cytoscape-sigma.md) | 20 | 15 | 5 | 0 |
| [vis-echarts-plotly](./cohorts/vis-echarts-plotly.md) | 23 | 19 | 3 | 1 |
| [antv-g6-x6](./cohorts/antv-g6-x6.md) | 26 | 17 | 9 | 0 |
| [commercial-diagramming](./cohorts/commercial-diagramming.md) | 25 | 22 | 3 | 0 |
| [react-flow-family](./cohorts/react-flow-family.md) | 23 | 19 | 4 | 0 |
| [text-to-diagram](./cohorts/text-to-diagram.md) | 21 | 20 | 1 | 0 |
| [d3-and-layout-engines](./cohorts/d3-and-layout-engines.md) | 20 | 17 | 3 | 0 |
| [node-editors](./cohorts/node-editors.md) | 21 | 19 | 2 | 0 |
| [pipeline-orchestrator-uis](./cohorts/pipeline-orchestrator-uis.md) | 20 | 15 | 5 | 0 |
| [observability-and-state](./cohorts/observability-and-state.md) | 4 | 4 | 0 | 0 |
| [animation-and-presentation](./cohorts/animation-and-presentation.md) | 20 | 14 | 5 | 1 |
| [large-scale-and-analytics](./cohorts/large-scale-and-analytics.md) | 21 | 17 | 3 | 1 |
| [catch-up](./cohorts/catch-up.md) | 17 | 14 | 2 | 1 |

The `observability-and-state` agent returned only 4 gaps against a 10 to 25 target; it spent its budget on fetching and reading rather than on breadth. The critic noticed the thinness of that area (time-travel replay, XState inspect) and the catch-up cohort covers part of it, but that cohort remains the least complete survey in the corpus.

## Use-case passes

| Perspective | Use-cases | Good | Partial | Poor |
| --- | --- | --- | --- | --- |
| [Developer tooling, CI/CD and build systems](./use-cases/devtools-ci.md) | 9 | 4 | 5 | 0 |
| [Data and ML platform engineering](./use-cases/data-eng.md) | 10 | 3 | 6 | 1 |
| [LLM agent systems](./use-cases/ai-agents.md) | 9 | 4 | 5 | 0 |
| [Business process and operations analysis](./use-cases/ops-process.md) | 9 | 3 | 6 | 0 |
| [Education and technical writing](./use-cases/education.md) | 9 | 2 | 7 | 0 |
| [SRE and observability](./use-cases/observability.md) | 9 | 5 | 3 | 1 |
| [Product management and solutions engineering](./use-cases/product-sales.md) | 9 | 3 | 5 | 1 |
| [Systems, control and simulation modeling](./use-cases/systems-modeling.md) | 9 | 5 | 4 | 0 |

## Models and effort

No agent ran on the session model. Inventory, surveys, critic: sonnet at medium effort. Verifiers: sonnet at low effort. Use-case passes: opus at medium effort. Synthesis: opus at high effort. Total agent count 37, about 2.7M tokens, 58 minutes wall clock.
