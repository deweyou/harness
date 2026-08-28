# Design QA

## Comparison target

- Previous implementation: `design-qa-global-final.png`, with active and archived Runs compressed into a permanent 260px sidebar.
- Current implementation: `design-qa-runs-page.png` and `design-qa-run-detail.png`.
- Additional state: `design-qa-runs-archived.png`.
- Browser viewport: 1280 x 720 CSS pixels.

## Findings

No actionable P0, P1, or P2 differences remain for the requested information-architecture change.

- Information architecture: `/runs` is now a dedicated global overview. `/runs/:runId` is a focused Run detail page with an explicit return link. The permanent Run sidebar is gone.
- Summary depth: each overview item now exposes workspace, workflow, elapsed time or duration, node completion, current stage, current node, status, and attention state.
- Density: the page uses a centered 1120px content area and three full-width Run rows instead of placing six Runs in a narrow persistent region.
- Active versus history: Active and Archived are separate tabs backed by the same searchable list pattern.
- Detail continuity: List/Graph parity, node selection, on-demand evidence, and the blocker action are preserved on the detail route.
- Theme: the shared header keeps the light/dark switch available on both pages.
- Responsive behavior: summary cards stack on small screens; secondary Run details collapse before primary identity and progress.

## Interaction evidence

- Active tab renders 3 Runs.
- Archived tab renders 3 Runs.
- Archived item navigation reached `/runs/run_7e9b1f3c`.
- Active item navigation reached `/runs/run_8f3c7a2d`.
- Graph view rendered 11 nodes for the selected Run.
- Review opened one node evidence panel.
- Theme toggle changed the root dark-mode state.

## Verification

- TypeScript: passed with `./node_modules/.bin/tsc --noEmit`.
- Production build: passed with Vite; Sites output prepared.
- Sites route tests: 4/4 passed.
- Browser QA: list, archived list, detail navigation, Graph, evidence panel, and light/dark mode passed.

## Residual test gaps

- The standalone prototype still uses realistic mock data until the singleton Dashboard HTTP service consumes the global `run_list` index.
- This pass inspected keyboard focus and semantic roles but does not claim formal WCAG certification.

final result: passed

## Annotation follow-up: transparent edge-aligned Run toolbar

- Source visual truth: the browser annotation screenshot for `/runs`, where the selected toolbar sits inside the list card background with horizontal inset padding.
- Rendered implementation: `design-qa-floating-toolbar.png`, captured from `/runs` in light mode at a 1280 x 720 CSS viewport (1280 x 720 image pixels; no density normalization required).
- Earlier P3 finding: the toolbar inherited the list card background and created an unnecessary padded header region around the segmented filter and search.
- Fix: made the toolbar and section background transparent, removed the toolbar border and horizontal padding, and moved the border, radius, clipping, and card background onto the Run list only.
- Post-fix full-view evidence: the toolbar floats above the list card while the filter and search align exactly to its left and right edges.
- Focused measurements: toolbar background is transparent, left/right padding and bottom border are 0px, and both toolbar-to-list edge deltas are 0px.
- Interaction evidence: Needs attention still filters to one Run and the browser console reports zero errors.
- Required fidelity surfaces: typography, tokens, assets, and copy remain unchanged; only container background and spacing ownership changed.

final result: passed

## Annotation follow-up: Run scopes use the view-switcher pattern

- Source visual truth: `design-qa-stage-caret.png`, whose detail toolbar contains the approved `List / Graph` segmented control.
- Rendered implementation: `design-qa-segmented-filters.png`, captured from `/runs` in light mode at a 1280 x 720 CSS viewport (1280 x 720 image pixels; no density normalization required).
- Earlier P3 finding: the integrated Run scopes still used an underline-tab treatment instead of matching the established view switcher.
- Fix: applied the same segmented-control anatomy and tokens: 8px outer radius, 3px padding, muted container, 31px buttons, 6px button radius, card-colored active state, and 0 1px 3px active shadow.
- Post-fix full-view evidence: the scope control remains compact beside search and no longer introduces a second navigation style on the page.
- Focused interaction evidence: Active, Needs attention, and Archived continue to render 3, 1, and 3 Runs; the browser console reports zero errors.
- Required fidelity surfaces: typography, palette, imagery, and copy remain unchanged; spacing and control affordance now match the existing List/Graph pattern.

final result: passed

## Annotation follow-up: summary counts integrated into filters

- Source visual truth: the browser annotation screenshot for `/runs`, where three standalone summary cards repeat counts already present in the Run scopes.
- Rendered implementation: `design-qa-integrated-filters.png`, captured from `/runs` in light mode at a 1280 x 720 CSS viewport (1280 x 720 image pixels; no density normalization required).
- Earlier P2 finding: Active and Archived counts were duplicated between summary cards and tabs, while Needs attention consumed a full card without being directly actionable.
- Fix: removed the summary-card region and merged all three counts into functional `Active`, `Needs attention`, and `Archived` filters.
- Post-fix full-view evidence: the Run list now follows the page heading directly, eliminating the repeated summary row while preserving the existing list width, typography, colors, logo, copy, and search control.
- Focused interaction evidence: Active renders 3 Runs, Needs attention renders only the single attention Run, and Archived renders 3 Runs. The summary grid is absent and the browser console reports zero errors.
- Required fidelity surfaces: typography, colors, image assets, and Run-card content are unchanged; spacing is intentionally compressed and the copy now maps directly to filter behavior.

final result: passed

## Annotation follow-up: stage disclosure alignment

- Source visual truth: the browser annotation screenshot for `/runs/run_7e9b1f3c`, where the text glyph disclosure marker sits off the `Align` label baseline.
- Rendered implementation: `design-qa-stage-caret.png`, captured from the same route in light mode at a 1280 x 720 CSS viewport (1280 x 720 image pixels; no density normalization required).
- Earlier P2 finding: the text characters `⌄` and `›` did not share a stable visual baseline with the stage label.
- Fix: replaced both glyphs with Phosphor `CaretDown` and `CaretRight` icons inside an 18 x 18 centered container; set the label to the same 18px line height.
- Post-fix focused evidence: the icon and `Align` label both measure top 311px, bottom 329px, height 18px; center delta is 0px.
- Interaction evidence: `aria-expanded` changes `true -> false -> true`, the icon remains present in both states, and the browser console reports zero errors.
- Required fidelity surfaces: typography and spacing alignment are corrected; colors, imagery, copy, layout, routes, and interactions are unchanged.

final result: passed
