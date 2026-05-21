# GitHub Pages Site Design

*Date: 2026-05-21*

## Purpose

Build a GitHub Pages site for this repository that helps external visitors
understand the agents hub as a reusable agent asset system. The site should make
the relationship between skills, rules, design contracts, and `deweyou-cli`
clear before asking users to install anything.

The site is English-first and supports Chinese switching where Chinese source
content already exists. It should reuse repository documentation as the source
of truth instead of creating a second long-lived content system.

## Approved Direction

Use VitePress for the GitHub Pages site.

VitePress is the right fit because the repository already keeps its public
knowledge in Markdown, every skill has human-facing README files, and the site
needs localized navigation, asset detail pages, and a deployable static build.
The implementation should customize VitePress enough to follow
`design/dewey-interface.md` without turning the project into a custom app.

## Audience

Primary audience:

- External GitHub visitors who want to understand what this repository provides.
- Agent-tooling users deciding whether these workflows, rules, and design
  contracts are useful for their own repositories.

Secondary audience:

- The repository owner and collaborators who need a pleasant browsable surface
  for existing README content.

## Information Architecture

### Home Page

The home page should be productized rather than a plain README mirror.

It should use a system-map-first structure:

1. Hero: explain that this is a reusable hub for agent workflows, rules, design
   contracts, and the CLI that installs them into local repositories.
2. System map: show how `Skills`, `Rules`, `Design`, and `deweyou-cli` relate.
3. Featured assets: highlight representative skills such as `repo-memory`,
   `git-delivery`, `spec-driven-coding`, and `ui-design`.
4. Setup path: point to `deweyou-cli agent update`, `agent init`, and
   `agent doctor` as the installation flow.
5. Repository links: provide clear routes to GitHub, CLI docs, and asset detail
   sections.

The home page may summarize README content, but it should not duplicate the full
README body.

### Documentation Sections

Use VitePress navigation and sidebars for:

- Guide
- Skills
- Rules
- Design
- CLI

The first version must include skill detail pages because every skill already
has `README.md` and `README_ZH.md`. Rule, design, and CLI pages can start as
curated pages linked from the existing root README and docs, with room to make
them more generated later.

### Localization

The default locale is English.

Chinese pages should exist where source files already exist:

- Root `README_ZH.md`
- `skills/<name>/README_ZH.md`

Each page should expose an `EN / 中文` language switch through VitePress locale
navigation. If a Chinese equivalent does not exist for a page, the site should
fall back to the English page rather than invent translated content.

## Content Source Strategy

The site should avoid manually copying long README bodies into VitePress pages.

Use a small generation or sync script to prepare VitePress content from existing
Markdown files:

- Root `README.md` and `README_ZH.md` for guide-level content.
- `skills/*/README.md` and `skills/*/README_ZH.md` for skill detail pages.
- `rules/*.md` and `design/*.md` for generated index metadata or simple detail
  pages when useful.

Generated site content should live under the VitePress site directory and should
be reproducible from tracked source Markdown. The source Markdown files remain
the authoritative content.

## Visual Design

Follow `design/dewey-interface.md`.

The site should feel restrained, typographic, component-driven, and functional:

- Neutral light-gray canvas.
- White or raised surfaces separated by 1px borders before shadows.
- Deep emerald primary emphasis.
- Compact hierarchy and clean lines.
- Low-radius rectangular surfaces.
- Source Han Sans for controls and interface copy when available.
- Source Han Serif for prose and display moments when appropriate.

Avoid:

- Decorative gradients as the main visual language.
- Glassmorphism, bokeh, stock-like atmosphere, or generic SaaS hero treatment.
- Oversized marketing cards that bury the asset system.
- Arbitrary raw colors, radii, and shadows where theme tokens can express the
  same intent.

The home page can be more polished than the documentation pages, but it should
still prioritize clarity and scanning over decoration.

## Technical Design

Add a VitePress site, likely under `site/`, with:

- `.vitepress/config.ts` for English and Chinese locales.
- `.vitepress/theme/` for Dewey Interface theme customization.
- Generated or synced Markdown pages for README-backed content.
- A script that prepares site content before build.
- Package scripts for local development and production build.
- A GitHub Actions workflow that builds and deploys the site to GitHub Pages.

The GitHub Pages base path should target the repository path:

```ts
base: '/agents/'
```

The implementation should use conservative dependencies. VitePress is the main
new dependency; avoid adding a separate content framework, CMS, or Markdown
processing stack unless VitePress cannot cover the need.

## GitHub Pages Deployment

Add a dedicated workflow for Pages deployment on `main`.

The workflow should:

1. Check out the repository.
2. Install dependencies with pnpm.
3. Generate or sync VitePress content.
4. Build the VitePress site.
5. Upload the static artifact.
6. Deploy through GitHub Pages.

Existing lint and CLI release workflows should remain independent.

## Testing And Verification

Implementation verification should include:

- `pnpm run lint:assets`
- Existing tests affected by root scripts, usually `pnpm test`
- The VitePress build command
- Local dev server inspection in the browser
- Desktop and mobile viewport checks
- Language switch checks for English and Chinese pages
- A check that generated content does not require manual README duplication
- A check that `.superpowers/` local brainstorming artifacts are ignored

If the implementation changes CLI behavior, run the CLI verification commands
from `AGENTS.md`; the current design does not require CLI behavior changes.

## Out Of Scope

- Publishing a separate package for the site.
- Building a custom search service.
- Translating content that does not already have Chinese source Markdown.
- Replacing the root README as the canonical repository overview.
- Adding analytics, comments, auth, or dynamic server behavior.

## Open Decisions For Implementation Plan

- Exact generated content layout under `site/`.
- Whether generated Markdown is committed or produced only during build.
- The smallest reliable way to preserve relative links from source README files.
- Whether rule and design detail pages should be generated in the first pass or
  only represented as index cards linking to source files.
