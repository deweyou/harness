# Run resource pinning

- Date: 2026-08-26
- Status: accepted
- Scope: Run-scoped Context and Skill activation

Run-scoped capability discovery uses the Run's frozen configuration snapshot.
The first activation lazily copies the actual Context file or complete Skill
directory into `cache/resources/`, records its digest and optional Git revision,
and returns a locator inside the Run bundle.

Later activations verify and reuse that pinned content even after Harness server
restart or source changes. Calls without `runId` continue to inspect current
workspace configuration. New Runs may resolve newer resource content; active
Runs do not silently change execution context.
