# Agent instructions

Read [README.md](README.md) for commands, [CONTRIBUTING.md](CONTRIBUTING.md) for the change workflow, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design. These rules add to them.

## Skills

Project skills live in `.agents/skills/`, which Codex, Cursor, OpenCode, and VS Code read. Claude Code reads only `.claude/skills/`, so each skill also has a symlink there, for example `.claude/skills/verify-hackmidwest -> ../../.agents/skills/verify-hackmidwest`. When you add a skill, add its symlink in the same PR.

## Prove every PR works

A PR is not ready until it shows the change working in the real app. Passing tests and a clean typecheck are not proof.

1. If the change affects what a user sees or calls (a page under `apps/web/src/routes`, or an endpoint in `apps/api` or `apps/agent-api`), run the `verify-hackmidwest` skill (`.agents/skills/verify-hackmidwest/SKILL.md`) against the PR branch.
2. Drive every entry point that the skill's feature map lists for the features you touched. If you add or change a feature, update its feature file in the same PR.
3. Capture screenshots for UI changes. Capture HTTP transcripts and a database read for API changes.
4. Run `verify.sh publish <pr-number> <summary.md>` to post the screenshots and transcripts as a PR comment. The summary says what each artifact proves.
5. In the PR description, put a `## Verification` section that names the recipe you ran and its outcome, and links the proof comment.

If the change has no runtime behavior (docs, CI, tooling), say so in `## Verification` and include the command output that proves it instead, such as the test or build run.

If the app does not start or a recipe step fails, report the failure in the PR. Never post proof from a different branch or an older run, and never report a skipped entry point as verified.
