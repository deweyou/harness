# Problem framing, Spec, Export, and knowledge initialization decision

- Captured at: 2026-08-24
- Type: user-confirmed design decision
- Scope: Harness Work controller guidance, Node Export contract, Dashboard
  preview, and repository knowledge initialization

The Harness should provide lightweight Problem Framing together with a small,
domain-neutral Spec lifecycle. Framing remains a natural conversation rather
than a fixed workflow stage. Whether a Spec needs maintenance depends on the
whole task context, so a small correction inside a larger requirement may still
update the current Spec.

Spec is not a special Core object. Node executions may publish immutable JSON
or Markdown Exports, and a Spec is a Markdown Export identified by role. The
Dashboard should provide generic JSON and Markdown viewers for these Exports.

Repository knowledge initialization may establish `CLAUDE.md` as a safe symlink
to canonical `AGENTS.md`, prefer Mermaid when it makes relationships clearer,
and place a compact update footer on maintained knowledge. Active knowledge
contains current useful truth; design evolution may remain in the Spec.
