# ECC-Inspired Codex Notes

This file supplements the root `AGENTS.md` with Codex-specific guidance for this workspace.

## Model Guidance

- Routine coding, tests, and formatting: use the default coding model.
- Complex features, debugging, architecture, and security review: prefer higher reasoning effort.

## Skills And MCP

- Treat `.codex/config.toml` as the local Codex baseline for this workspace.
- Prefer MCP servers when they improve grounding, especially for docs, browser automation, and structured search.
- Keep heavyweight or credentialed MCP usage opt-in when not needed.

## Multi-Agent Roles

- `explorer`: read-only evidence gathering before implementation.
- `reviewer`: correctness, security, regression, and testing review.
- `docs_researcher`: documentation and release-note verification.

## Security

- Validate inputs at system boundaries.
- Never hardcode secrets.
- Review diffs before pushing.
- Prefer workspace-write sandboxing over broader access.
