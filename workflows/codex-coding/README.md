# Codex Coding Agent demos

## 05-self-bootstrap.json

Minimal native Loop Engineering demo. Codex modifies the Codex Coding Agent node in an isolated worktree, the host runs `codex-node-targeted`, and a Reviewer Agent provides semantic review.

## 06-codex-runs-sidebar-self-bootstrap.json

Human-approved multi-Agent self-bootstrap demo for adding a **Codex Runs** sidebar entry and read-only visualization of Codex Coding Agent run data from `C:\Users\XuperMan\.n8n\database.sqlite`.

The verified local database currently contains:

- `codex_coding_run`: run, repository, branch, base commit, execution status, and timestamps;
- `codex_coding_turn`: round, status, usage, deterministic checks, error, and diff artifact;
- three Codex runs in total at the time the demo was revised: one completed and two running.

The feature must read these tables through the existing TypeORM entities and repositories. Browser code never opens the SQLite file directly. The API is project-scoped with `workflow:read`, and the UI does not expose `worktreePath`, `codexSessionId`, full local paths, raw prompts, or unsanitized error stacks.

Flow:

1. Start from hosted chat and submit the feature request or extra constraints.
2. Product Experience Agent and Data Security Architect Agent run as parallel planning branches. The shared planning model uses JSON mode; it does not impose a low token ceiling because reasoning tokens can otherwise consume the budget before the JSON answer is emitted.
3. `Collect Design Evidence` keeps a field whitelist and whole list items before Goal Specification Agent consumes either branch. It never truncates text or serialized objects by character count.
4. `Normalize Goal Plan` validates the JSON and limits only whole constraint and acceptance-criteria items before anything is shown to the user.
5. `Review and Approve Goal Plan` sends a short summary with `批准方案` and `修改方案` buttons. No code has changed at this point.
6. `修改方案` opens a short free-text prompt. A revision Agent applies only the requested changes, then the compact plan returns to the same approval gate.
7. Only an explicit click on `批准方案` lets the contract enter Goal Loop and Codex Coding Agent.
8. The host runs `codex-runs-sidebar-targeted`; Code Reviewer Agent then performs semantic review.
9. Loop Evaluation decides pass, retry, blocked, stagnated, or max rounds.

The workflow is inactive and has not been executed. Before the first run:

- restart n8n through `启动n8n.cmd` so the new verification profile is loaded;
- import the workflow JSON;
- select the existing DeepSeek credential on `Planning Model` and `Review Model`;
- keep the Talent-AI main repository clean;
- open the hosted chat, inspect the compact summary, and either approve it or request a focused revision.

`codex-runs-sidebar-targeted` is server-controlled and runs fixed CLI unit tests, SQLite integration tests, CLI typecheck, editor tests, and editor-ui typecheck. Test files added for this feature must include `codex-runs-overview` in their filenames so targeted commands select them.

The Codex node uses `gpt-5.6-sol`. Its Goal field stays empty because Codex CLI 0.130.0 can fail on the experimental `thread_goals` store; Goal Loop still supplies the stable goal, acceptance criteria, and round feedback inside `LoopContext` on every coding turn.
