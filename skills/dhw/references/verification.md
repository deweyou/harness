# Claim Verification

Match Evidence to the Claim. Prefer the smallest meaningful check that proves
the expected result.

For each Claim record:

- identity and current Commitment revision
- expected result and verification method
- Evidence digest and locator
- input digests or artifact identities on which the Evidence depends
- observed result and the resulting status

Source inspection alone is insufficient when behavior depends on a running
system, renderer, generated artifact, external destination, or integration.
A successful node only produces candidate Evidence; it never implicitly
satisfies a Claim.

When inputs or the Commitment change, stale Evidence remains historical but
cannot satisfy the current Claim. Attribute resource feedback only when the
Evidence identifies a specific skill, rule, or knowledge resource as causal.
