# Dashboard feature-density audit

## Scope

Current local prototype at `http://127.0.0.1:7777/`, reviewed in both List and Graph views on 2026-08-22.

## Conclusion

The prototype demonstrates the intended capability, but the default screen exposes too many future or secondary controls. Roughly one third of the visible controls can be removed or deferred without weakening the core run-observation workflow.

## Keep in the primary flow

- Current run title, status, elapsed time, and blocking next action.
- List/Graph switch as equal views over the same run.
- Stage and node status.
- Node detail and evidence after selection.

## Remove from the first version

- Primary-rail entries for Decisions and Resources until those destinations are real.
- Persistent Notifications, Help, version, and avatar controls from the main work surface.
- Always-visible keyboard hints.
- Mock-only Download and Open preview actions.
- Repeated Live, Required, and connection status labels.

## Defer or collapse

- Merge the icon rail and run navigator into one sidebar.
- Open the evidence panel only for a selected node or blocking state.
- Move the activity timeline behind a disclosure.
- Show run IDs, attempts, and evidence counts on demand rather than in every row.
- Keep the warning banner only while user action is genuinely required.

## Accessibility caution

The screenshot suggests very small metadata and low-contrast secondary text. This is a visual observation, not a compliance claim; keyboard order, focus visibility, contrast ratios, and screen-reader semantics still need a dedicated audit.

## Evidence

- `01-current-list.png`
- `02-current-graph.png`
