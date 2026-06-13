---
name: ACE Portal codegen + Vite restart
description: After running codegen, Vite's module graph is stale and must be restarted.
---

## Rule
`pnpm --filter @workspace/api-spec run codegen` cleans the output folder before regenerating. Vite caches module resolution at startup, so after a clean+regenerate cycle the old resolved paths are gone and Vite shows "Failed to load url" errors.

**Fix:** Always restart the `ace-results-portal: web` workflow immediately after running codegen.

**Why:** Vite's dev server pre-bundles dependencies and caches resolution. When codegen removes and recreates files, the in-memory module graph still points to the (now deleted) old file inodes.

**How to apply:** After any `codegen` run, call `restart_workflow("artifacts/ace-results-portal: web")`.
