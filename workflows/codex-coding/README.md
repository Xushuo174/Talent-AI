# Codex Coding Agent demos

## 05-self-bootstrap.json

Minimal native Loop Engineering demo. Codex modifies the Codex Coding Agent node in an isolated worktree, the host runs `codex-node-targeted`, and a Reviewer Agent provides semantic review.

## 06-codex-runs-sidebar-self-bootstrap.json

Fast, human-approved multi-Agent Loop Engineering demo. The **Codex Runs** sidebar page and its project-scoped read-only API already visualize `codex_coding_run` and `codex_coding_turn` from n8n's own SQLite database. The demo asks Codex for one small follow-up: add a refresh button and show the most recent refresh time while reusing the existing loader.

Flow:

1. Start from hosted chat and send `按默认快速方案执行`, optionally followed by one short UI preference.
2. Product Experience Agent and Data Security Architect Agent create two compact planning branches.
3. `Collect Design Evidence` merges them and Goal Specification Agent creates a small implementation contract.
4. `Normalize Goal Plan` validates the contract before it is shown to the user.
5. `Review and Approve Goal Plan` sends a short summary with `批准方案` and `修改方案` buttons. No code has changed at this point.
6. `修改方案` opens a short free-text prompt. A revision Agent applies only the requested changes, then the compact plan returns to the same approval gate.
7. Only an explicit click on `批准方案` lets the contract enter Goal Loop and Codex Coding Agent.
8. Codex uses low reasoning effort and an eight-minute limit. The host runs the fixed `codex-demo-fast` profile, which performs `git diff --check`.
9. Code Reviewer Agent performs a compact semantic review and Loop Evaluation records the result. Goal Loop is intentionally limited to one round for the deadline demo.

The workflow is inactive and has not been executed. Before the first run:

- restart n8n through `启动n8n.cmd` so the new verification profile is loaded;
- import the workflow JSON;
- select the existing DeepSeek credential on `Planning Model` and `Review Model`;
- keep the Talent-AI main repository clean;
- open the hosted chat, inspect the compact summary, and either approve it or request a focused revision.

The full implementation is still covered by the focused `codex-runs-overview` backend tests, CLI typecheck, editor-ui typecheck, and Codex Coding Agent tests. Those checks are run during development rather than inside the deadline demo.

The Codex node uses `gpt-5.6-sol` through Codex CLI 0.155.0. Its Goal field stays empty; Goal Loop supplies the stable goal, acceptance criteria, and round context through `LoopContext`.
