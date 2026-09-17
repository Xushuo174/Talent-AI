# Codex Coding Agent demos

## 05-self-bootstrap.json

Minimal native Loop Engineering demo. Codex modifies the Codex Coding Agent node in an isolated worktree, the host runs `codex-node-targeted`, and a Reviewer Agent provides semantic review.

## 06-agent-data-sidebar-self-bootstrap.json

Human-approved multi-Agent self-bootstrap demo for adding an **Agent Data** sidebar entry and read-only visualization of preset-Agent information backed by n8n's SQLite database.

Flow:

1. Start from hosted chat and submit the feature request or extra constraints.
2. Product Experience Agent and Data Security Architect Agent run as parallel planning branches.
3. Goal Specification Agent serially reconciles both outputs into the exact Goal Loop contract.
4. `Review and Approve Goal Plan` pauses before any code is changed.
5. 回复 `批准` 或 `APPROVE` 接受原方案；也可以粘贴键名结构相同的完整 JSON，在修改的同时确认方案。
6. Only the approved contract enters Goal Loop and Codex Coding Agent.
7. The host runs `agent-data-sidebar-targeted`; Code Reviewer Agent then performs semantic review.
8. Loop Evaluation decides pass, retry, blocked, stagnated, or max rounds.

The workflow is inactive and has not been executed. Before the first run:

- restart n8n through `启动n8n.cmd` so the new verification profile is loaded;
- import the workflow JSON;
- select the existing DeepSeek credential on `Planning Model` and `Review Model`;
- keep the Talent-AI main repository clean;
- open the hosted chat and inspect the generated plan carefully before approving it.

`agent-data-sidebar-targeted` is server-controlled and runs fixed CLI unit tests, SQLite integration tests, CLI typecheck, editor tests, and editor-ui typecheck. Test files added for this feature must include `agent-data-overview` in their filenames so targeted commands select them.
