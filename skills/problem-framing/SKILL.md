---
name: problem-framing
description: >
  Problem framing workflow for Grilling, brainstorming, tradeoff critique, and
  recommendation. Use when the user asks to brainstorm, explore options, clarify
  requirements, think through a product/design/technical direction before
  implementation, or when another workflow needs a compact problem frame before
  building.
---

# Problem Framing

Problem framing turns blurry intent into a useful direction. It combines
Grilling and brainstorming: ask only the questions that change the path, then
generate, critique, and converge on options.

Use it as a standalone workflow or as a module inside `ddev`, `product-design`,
`ui-design`, or `spec-driven-coding`.

## Core Contract

- Start by finding the decision that actually needs help.
- Ask fewer, sharper questions instead of running a long intake form.
- Prefer concrete alternatives over abstract principles.
- Generate options that differ in strategy, risk, audience, or implementation
  shape, not just wording.
- Critique each option before recommending one.
- End with a decision-ready summary, not an endless ideation list.
- Do not use framing to delay an obvious low-risk next step.

## Modes

### Grill

Use when ambiguity changes direction, risk, acceptance, or cost.

Ask about:

- goal and user-visible outcome
- audience or primary user
- constraints and non-goals
- risk, reversibility, and time budget
- acceptance criteria and evidence
- taste, tone, or product posture when relevant

If the answer can be safely assumed, state the assumption and continue.

### Brainstorm

Use when the user wants ideas, alternatives, naming, product directions, UX
flows, technical approaches, visual concepts, or a demo before implementation.

Run this loop:

1. **Frame**: restate the problem, audience, constraints, and non-goals.
2. **Diverge**: produce 3-5 meaningfully different options.
3. **Stress-test**: list tradeoffs, risks, failure modes, and verification cost.
4. **Converge**: recommend one direction and one backup.
5. **Next move**: name the smallest useful next artifact, such as a demo,
   speclet, code spike, user test, or implementation step.

### Critique

Use when the user already has an idea and wants it challenged.

Check:

- hidden assumptions
- where the idea is strongest
- where it is fragile
- what would make it fail
- what evidence would change the recommendation

## DDev Integration

When invoked by `ddev`:

- Use `problem-framing` for `$DDev brainstorm`, high-risk Grilling, and
  pre-demo concept selection.
- Write durable working output to the current DDev session's `brainstorm.md`
  under `~/.deweyou/dev/repos/<repo-id>/sessions/<branch>/` when DDev local
  state exists.
- If the chosen direction needs to be seen, recommend
  `deweyou-cli dev demo --no-server` or `deweyou-cli dev demo --port 4173`.
- Return control to `ddev` after the recommendation so DDev can manage
  verification, delivery, memory, and cleanup.

## Output Shape

Use this compact shape unless the user asks for something else:

```markdown
**Frame**
- Goal:
- Audience:
- Constraints:
- Non-goals:

**Options**
1. Name: thesis, strengths, risks, evidence needed.
2. Name: thesis, strengths, risks, evidence needed.
3. Name: thesis, strengths, risks, evidence needed.

**Recommendation**
- Choose:
- Why:
- Backup:
- Next move:
```

For very small questions, collapse this to a short paragraph plus a recommended
next step.

## Boundaries

- Do not create product notes unless the user explicitly asks for durable
  product-note capture.
- Do not start coding unless the user asks to implement or the direction is
  already clear and low risk.
- Do not force a demo when text comparison is enough.
- Do not produce more options when the useful move is to choose.
