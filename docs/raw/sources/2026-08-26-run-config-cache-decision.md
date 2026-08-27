# Run configuration cache

- Date: 2026-08-26
- Status: accepted
- Scope: Run bundle and Plan validation

The resolved configuration snapshot is stored at
`cache/config.snapshot.yaml` inside each Run bundle. It remains persistent for
the Run lifetime even though it is grouped under `cache/`; deleting it makes
the Run non-executable.

Public Plan proposal, execution start and finish, and Dashboard projection all
consume this snapshot. Workspace `harness.yaml` changes after Run creation
affect only new Runs. Plan proposal validates Node identity, minimum authority,
and input values against the snapshot, while execution start repeats input
validation defensively.
