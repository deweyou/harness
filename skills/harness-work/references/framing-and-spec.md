# Problem Framing And Spec

Use this reference when the requested outcome is ambiguous, has materially
different solutions, asks for brainstorming or critique, or benefits from a
durable specification. The method applies to coding, writing, research,
operations, design, and other durable work.

## Choose The Lightest Conversation

Do not force every request through a questionnaire. Select the smallest useful
mode and move between modes naturally:

- **direct**: the outcome and acceptance boundary are already clear; proceed;
- **clarify**: ask only about ambiguity that changes behavior, scope, authority,
  cost, privacy, reversibility, or destination;
- **explore**: generate and compare plausible directions before commitment;
- **critique**: stress-test an existing proposal against goals, constraints,
  failure modes, and acceptance.

Framing may end as an answer without creating a Run. It may also recur after a
Run starts when new information changes the solution. It is not a Workflow,
Stage, or mandatory Planned Node.

## Frame The Problem

Establish enough shared context to act:

1. desired outcome and who benefits;
2. current situation and observed problem;
3. scope and explicit non-goals;
4. constraints, authority, and consequential decisions;
5. acceptance signals and important failure cases;
6. assumptions that still need Evidence.

Separate facts, inference, and user preference. Resolve material choices with
the user. Low-risk implementation details may remain delegated when the current
authority permits them.

## Decide Whether A Spec Is Durable

Judge the whole task, not the size of the current edit. A tiny correction inside
a large feature may still need to update that feature's current Spec. A
self-contained low-risk change with obvious acceptance may need no Spec.

Create or update a Spec when it preserves useful intent that cannot be recovered
cheaply from code or output, especially requirements, behavior, interfaces,
constraints, acceptance cases, trade-offs, or unresolved decisions. Prefer the
existing canonical Spec over creating a competing document.

The boundaries are:

- Commitment records the current objective, authority, destination, acceptance
  Claims, and unresolved material decisions;
- Spec explains intended behavior, rationale, constraints, examples,
  alternatives, and acceptance details;
- Plan records the executable delta for the current Commitment revision;
- active repository knowledge explains only the current useful system state.

Design history may remain in the Spec when it helps reviewers understand the
current decision. When design A becomes B, update canonical knowledge to B
only; the Spec may retain the relevant A-to-B trade-off.

## Publish The Spec As An Export

Maintain the working Spec in the task workspace when repository ownership is
appropriate. On the node attempt that creates or materially updates it, include
it in `execution_finish` as a Markdown Export with role `spec` and a workspace-
relative `sourcePath`. Core snapshots it into the Run bundle, and the Dashboard
renders it through the generic Export viewer.

Use the maintained-document footer convention from
[knowledge-maintenance.md](knowledge-maintenance.md). Do not put secrets,
transient logs, or unrelated conversation into the Spec.
