# Verification Stage

Match evidence to the claim. Prefer the smallest meaningful check that proves
the configured acceptance criterion.

Possible evidence is domain-owned: tests and runtime checks for software,
rendered and editorial review for articles, upload status and playback checks
for video, or another workflow-specific proof. The Harness does not prescribe a
coding-specific test stack.

For each claim record:

- claim identity and expected result
- verification method and why it is relevant
- evidence identity or external reference
- observed result
- pass, reject, or explicit gap

Source inspection alone is insufficient when behavior depends on a running
system, renderer, generated artifact, external destination, or integration.
When verification fails, return only the affected work to execute and preserve
all earlier timings and evidence. When the failure reveals a wrong objective or
scope, return to align.
