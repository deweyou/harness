# Changelog

## 1.1.0 - 2026-07-20

### Added

- ddev: add personal harness workflow
## 1.0.1 - 2026-05-26

### Fixed

- init: avoid agents file for skills-only installs
## 1.0.0 - 2026-05-26

### Breaking Changes

- delegate init skill installs to skills cli
## 0.5.1 - 2026-05-25

### Fixed

- ci: diagnose trusted publishing oidc
## Unreleased

### Added

- add `--global` shortcut for global skill and rule installs

### Changed

- clarify global init success output and help text
- delegate `agent init` skill installs to `npx skills` and remove the extra
  Dewey skills wrapper commands

## 0.5.0 - 2026-05-17

### Added

- add deweyou-cli help and version flags
## 0.4.0 - 2026-05-17

### Added

- add interactive rule install prompts
- wire rule installs into init
- add rule install adapters
- parse rule install init flags

### Fixed

- refuse agents symlink writes
- harden rule install safety
- preserve explicit init mode
- preserve init flags in wizard
- omit claude preview without rules
- include agents preview for claude installs
- read inline project rules from cache
- forward init rule install flags
- handle Claude rule install validation
- preserve only AGENTS Claude symlink
- document rule install init flags

### Changed

- share managed markdown sections

### Documentation

- document rule install targets
## 0.3.1 - 2026-05-17

### Changed

- streamline agent skills
## 0.3.0 - 2026-05-17

### Added

- default agent update to cached source
## 0.2.1 - 2026-05-17

### Fixed

- publish cli as deweyou-cli package
## 0.2.0 - 2026-05-17

### Added

- automate cli release changelog
- colocate deweyou cli package

### Changed

- generate cli registry from assets
All notable `deweyou-cli` package changes will be documented in this file.
