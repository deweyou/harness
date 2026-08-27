# Relative-only Harness imports

- Date: 2026-08-25
- Source: product design conversation
- Status: accepted

Harness configuration imports must use paths relative to the configuration file
that declares them. Absolute POSIX paths, Windows drive paths, and Windows
root-relative or UNC paths are invalid. Relative parent traversal remains
available so a repository can compose nearby configuration fragments without
embedding machine-specific locations.
