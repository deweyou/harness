# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Dashboard Design Decisions

- Use Tailwind CSS and shadcn/ui-compatible components with Deweyou Harness tokens.
- Preserve the selected Evidence Workbench direction, but keep the default screen focused on the current run, blocking next action, and execution state.
- Treat the global Run list as its own full-width page with rich cross-workspace summaries and separate active/archive scopes.
- Keep Run counts inside the Active, Needs attention, and Archived filters; do not repeat them as standalone summary cards above the list.
- Present the Run scopes as the same compact segmented-control pattern used by the List and Graph view switcher.
- Keep the Run toolbar transparent and flush with the Run-list card edges; do not wrap it in the list card background or add horizontal padding.
- Open each Run on a dedicated detail route with a clear return to the global list; do not keep the Run list as a permanent sidebar.
- Open node evidence as an on-demand detail panel instead of a permanent column.
- Keep secondary metadata, activity history, and future destinations hidden or collapsed until they support a real task.
- Support matching light and dark themes.
- Present the DAG as equal List and Graph views backed by the same node data and selection state.
- Use the supplied Harness logo and Phosphor icons; do not recreate brand or interface icons with CSS drawings.
