# Flat Node kinds

- Date: 2026-08-25
- Source: product design conversation
- Status: accepted

A Node directly declares `kind: agent` or `kind: command`. The nested
`executor` object and speculative `capability` executor kind are removed.

Agent Nodes may reference Skills. Command Nodes declare one string `command`.
The string is one shell execution and has one result; commands that need
independent status, retry, or dependency edges are separate Nodes.
