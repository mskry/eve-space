# SDE Ingestion Guide

These instructions apply to `sde-ingest` in addition to the repository-wide guide.

## Use The CLI First

- Start with [README.md](README.md) for setup, execution, outcomes, retries, and verification.
- Use `pnpm sde:ingest` from the repository root. The CLI has no supported flags, positional
  arguments, or subcommands.
- Confirm the target database and apply its migrations before running ingestion. The command uses
  `DATABASE_URL`, downloads the latest official Tranquility SDE when needed, and replaces the
  published SDE projection in that database.
- Do not print `DATABASE_URL` or otherwise expose its credentials while diagnosing a run.
- Treat an optional-dataset skip as a successful import with reduced raw retention. A command error
  means the required projection was not published; preserve the error chain when reporting it.
- Retry a failed run after correcting its cause. Follow the README's archive-reuse instructions
  instead of deleting temporary downloads speculatively.

## Load Only Relevant Context

- For operating or troubleshooting the CLI, read the README and the command output first. Inspect
  Rust source only when the documented workflow does not explain the result.
- For CLI entry or output changes, start with `src/main.rs` and `src/workflow.rs`.
- For download or retained-archive behavior, inspect `src/feed.rs`.
- For database publication or dataset changes, inspect `src/projection.rs` and then only the
  projector or database module involved.
- Keep operational instructions in the README and link to them here instead of duplicating them.
