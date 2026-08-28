# Host-owned Command execution decision

Captured: 2026-08-27

The user confirmed that Harness Core remains a deterministic control and state
plane rather than a process runner.

- The host executes a frozen Command Node once with the ready assignment's
  `workspace.path` as cwd.
- Shell, environment, timeout, cancellation, and isolation are host-owned and
  do not become Harness configuration fields.
- Exit code `0` maps to `succeeded`, non-zero to `failed`, intentional
  cancellation to `cancelled`, and unexpected process or session loss to
  `interrupted`.
- Raw stdout/stderr and useful process metadata belong in Evidence when retained.
- If outputs are declared, the host submits a separate bounded structured result
  for Core validation. Harness does not assume stdout is JSON or convert it.
