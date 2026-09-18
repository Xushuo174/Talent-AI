# Talent-AI

基于 n8n 源码扩展的多 Agent、原生 Loop Engineering 与 Codex 自举开发平台原型。

> Native multi-agent Loop Engineering and isolated Codex self-bootstrap on a pinned n8n source baseline.

Talent-AI 复用 n8n 的画布、节点、凭据、执行历史和调度能力，在源码层补充三类能力：

1. **可复用的预设 Agent 与完整 Skill 包**；
2. **Goal Loop、Loop Evaluation、Loop Region 和 Round Timeline 组成的原生循环语义**；
3. **在隔离 Git worktree 中修改项目源码的 Codex Coding Agent，以及自动检查、人工预览和受控合并流程**。

当前项目是可本地运行和演示的研究原型，不是生产级多租户服务。

---

## 功能概览

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 预设 Agent | 已实现 | Agent 具有独立 Instruction、Skill、Tool 配置和版本 |
| Skill 文件夹导入 | 已实现 | 支持 `SKILL.md`、references、templates、scripts、assets、examples 等文本文件 |
| 多 Agent 工作流 | 已实现 | 支持串行、分支汇合、Planner/Executor/Reviewer 和人工审批 |
| Goal Loop | 已实现 | 维护 Goal、轮次、历史最佳、停滞和最大轮数 |
| Loop Evaluation | 已实现 | 统一确定性检查与 Reviewer 结果 |
| Loop Region | 已实现 | 创建动作、拓扑校验、状态徽标和 Round Timeline |
| Codex Coding Agent | 已实现 | App Server、thread/turn、隔离 worktree 和服务端验证配置 |
| Codex Runs | 已实现 | 项目级只读页面展示编码 Run 和 Turn |
| 自举开发 Demo | 已实现 | 多 Agent 规划、用户确认、Codex 编码、检查、隔离预览和人工合并 |
| 自定义向量长期记忆 | 未实现 | 当前只使用 n8n 已有会话和 Agent 数据能力 |
| 远程/多用户 Codex Runtime | 未实现 | 当前面向 Windows 单机环境，并发默认为 1 |

---

## 为什么基于 n8n 扩展

画布、节点协议、凭据管理、工作流导入导出和执行记录都属于工作流平台的基础设施。Talent-AI 没有重新实现这些通用能力，而是把工作集中在多 Agent 平台真正缺少的语义上：

- Agent 是可复用、可版本化的角色；
- 循环状态和退出条件由平台管理；
- 测试证据、Reviewer 意见和下一轮上下文使用统一协议；
- Coding Agent 只能修改隔离 worktree；
- 自动检查通过后仍需在独立实例中完成真实页面验收；
- 最终 Git 合并必须由用户批准。

因此，本项目不只是导入几条 n8n Workflow。自定义节点、公共类型、后端 Runtime、数据库实体、编辑器交互和 Codex Runs 页面均位于 n8n 源码中。

---

## 架构

~~~mermaid
flowchart TB
    U[用户需求] --> A[多 Agent 分析与规划]
    A --> H[用户确认 Goal / Constraints / Criteria]
    H --> G[Goal Loop]
    G -->|iterate| C[Codex Coding Agent / 业务 Agent]
    C --> T[Verification Profile]
    C --> R[Reviewer Agent]
    T --> E[Loop Evaluation]
    R --> E
    E --> G
    G -->|completed| P[隔离实例预览]
    G -->|stopped| S[最佳结果与剩余问题]
    P --> V{人工验收}
    V -->|通过| M[校验补丁并本地合并]
    V -->|拒绝| K[保留分支和 worktree]
~~~

### Agent 如何交换信息

Agent 不会在后台私自共享对话。每个节点把结果写成 n8n Item JSON，下游通过工作流连线和表达式显式读取。

~~~text
Agent 输出
→ 结构化 JSON
→ Merge / 规范化节点
→ 下一个 Agent
~~~

Loop 内的共享状态由 Goal Loop 管理。Codex 在同一次 Workflow Execution 的多轮中复用同一个 thread 和 worktree；重新执行工作流会创建新的隔离运行。

---

## 三个核心自定义节点

### Goal Loop

保存稳定目标、约束、验收标准、轮次、历史最佳结果和停止条件。

- `iterate`：进入下一轮；
- `completed`：自动验收条件满足；
- `stopped`：阻塞、停滞或达到最大轮数。

### Loop Evaluation

读取 `artifact`、`checks`、`reviewer` 和 `extraContext`，校验后生成统一的 `LoopEvaluationV1`。

它不执行测试，也不调用模型。测试由业务节点或 Verification Profile 执行，语义评审由 Reviewer Agent 执行，最终裁决由 Goal Loop 完成。

### Codex Coding Agent

连接本机 `codex app-server`，在服务端白名单仓库的隔离 worktree 中修改代码。

节点只接受 Repository、Task、可选 Goal、Verification Profile、Model、Reasoning Effort 和 Timeout。工作流不能填写任意本机目录、Shell 命令、网络开关或审批策略。

完整字段说明见[《自定义节点字段说明》](自定义节点字段说明.md)。

---

## Loop Engineering

Loop Engineering 不是简单重复调用模型，而是让每一轮都产生可验证产物，并根据证据决定继续或退出。

~~~text
执行
→ 确定性检查
→ Reviewer 评审
→ Loop Evaluation 统一证据
→ Goal Loop 裁决
→ 生成有界的下一轮上下文
~~~

下一轮上下文只保留：

- 原始 Goal、Constraints 和 Acceptance Criteria；
- 当前产物；
- 最新失败检查；
- Reviewer 问题和建议；
- 历史最佳结果；
- 最近若干轮摘要；
- 下一轮优先处理的 1～3 个问题。

它不会把完整聊天和完整日志无限回灌。

原生调度验证已经覆盖：

- 第二轮完成；
- Pre-Loop 只执行一次；
- 失败证据进入下一轮上下文；
- 每轮状态写入 execution metadata，供 Round Timeline 展示。

运行验证：

~~~powershell
node scripts/check-native-loop-engine.cjs
~~~

---

## Codex 隔离开发

一次新的 Codex Coding Agent 执行会：

1. 根据 `repositoryId` 解析服务端白名单仓库；
2. 检查 Git 基线和工作区状态；
3. 创建独立分支和 Git worktree；
4. 创建 Codex thread；
5. 在 worktree 内执行 Codex turn；
6. 由宿主运行固定 Verification Profile；
7. 输出 branch、base commit、changed files、diff 摘要和 checks；
8. 将 Run 和 Turn 写入 n8n SQLite；
9. 保留 worktree，等待审查，不自动 push。

默认权限：

~~~ts
{
  approvalPolicy: 'never',
  sandboxPolicy: {
    type: 'workspaceWrite',
    writableRoots: [worktreePath],
    networkAccess: false,
  },
}
~~~

当前提供三个本地 Verification Profile：

| Profile | 用途 |
| --- | --- |
| `codex-node-targeted` | Codex 节点目标测试和 nodes-base 类型检查 |
| `codex-runs-sidebar-targeted` | Codex Runs 后端、SQLite、前端测试及类型检查 |
| `codex-demo-fast` | 快速演示，只执行 `git diff --check` |

`codex-demo-fast` 不是完整质量门禁。06 Demo 在它之后增加 Reviewer 和真实页面人工验收。

---

## 仓库结构

~~~text
Talent-AI/
├─ upstream/n8n/                 固定版本的 n8n 源码和 Talent-AI 修改
├─ workflows/
│  ├─ loop-engineering/         03A～04 Loop Engineering Demo
│  └─ codex-coding/             05～06 Codex 自举 Demo
├─ scripts/                     构建、验证、预览和提升脚本
├─ 启动n8n.cmd                  Windows 本地完整功能启动器
├─ 关闭n8n.cmd                  只停止本项目 5678 实例
├─ 设计文档.md                  最终架构与交付说明
└─ 自定义节点字段说明.md        自定义节点使用手册
~~~

`upstream/n8n` 是根仓库中的普通源码目录，不是 Git submodule，也不是嵌套仓库。所有修改都在 Talent-AI 根仓库提交。

---

## 固定源码基线

| 项目 | 版本 |
| --- | --- |
| n8n tag | `n8n@2.38.7` |
| n8n commit | `a2d0f7638bbb7582e33a4dfa1537eeb8ff066788` |
| n8n source tree | `22b7a05d19e1de4703a3078535a7a68cb4481737` |
| Node.js | 24.x |
| pnpm | 11.22.0 |
| 已验证 Codex CLI | 0.155.0 |

当前使用固定源码快照。后续升级 n8n 需要单独进行上游差异合并，在 `upstream/n8n` 中执行 `git pull` 不会更新该目录。

---

## 快速开始

### 环境要求

- Windows 10/11；
- Git；
- Node.js 24.x；
- pnpm 11.22.0；
- 完整 Codex Demo 需要安装并登录 Codex CLI；
- 真实模型工作流需要自行配置模型 Provider 和 API 凭据。

凭据、API Key、Codex 登录信息和本地 SQLite 不包含在仓库中。
作者本机创建的预设 Agent 记录也不会随源码发布；克隆后请通过 Agent Builder 创建自己的 Agent 和 Skill。

### 1. 克隆

~~~powershell
git clone https://github.com/Xushuo174/Talent-AI.git
cd Talent-AI
~~~

### 2. 安装与构建

~~~powershell
cd upstream\n8n
pnpm.cmd install --frozen-lockfile
pnpm.cmd build --concurrency=1
~~~

首次完整构建耗时取决于机器配置。

### 3. 启动

完成构建后，回到项目根目录双击：

~~~text
启动n8n.cmd
~~~

访问 `http://localhost:5678`。关闭时双击 `关闭n8n.cmd`。

启动器会检查：

- `node.exe`；
- Codex CLI 可执行文件；
- 5678 端口；
- Talent-AI Repository 和 Verification Profile 配置。

如果 Codex CLI 的安装路径不同，需要调整 `启动n8n.cmd` 中的 `CODEX_EXE`。

只需要运行基础 n8n、暂不使用 Codex Coding Agent 时，可以在 `upstream/n8n` 中执行：

~~~powershell
pnpm.cmd start
~~~

这种方式不会自动注入 Talent-AI 的 Codex 仓库白名单和验证配置。

---

## Demo

### 04：原生 Loop Region

文件：`workflows/loop-engineering/04-native-loop.json`

导入后从 Manual Trigger 完整运行。预期：

1. Pre-Loop Input 只运行一次；
2. 第一轮固定样本未满足检查；
3. Loop Evaluation 生成标准评审；
4. Goal Loop 构建第二轮上下文；
5. 第二轮通过；
6. Loop Region 显示 `Round 2 / 3 · Passed` 和 Round Timeline。

这是不依赖模型凭据的原生循环控制 Demo。更多场景见[Loop Engineering Demo 说明](workflows/loop-engineering/README.md)。

### 06：Codex Runs 自举开发

文件：`workflows/codex-coding/06-codex-runs-sidebar-self-bootstrap.json`

该工作流演示：

~~~text
两个设计 Agent
→ 规划 Agent
→ 用户确认方案
→ Goal Loop
→ Codex Coding Agent
→ Verification Profile + Reviewer
→ Loop Evaluation
→ 5680 隔离预览
→ 用户批准或拒绝合并
~~~

运行前：

1. 使用 `启动n8n.cmd` 启动；
2. 保持 Talent-AI 主仓库干净；
3. 导入 06 JSON；
4. 为 Planning Model 和 Review Model 选择自己的模型凭据；
5. 确认 Codex CLI 已登录，所填模型受当前 CLI 和账号支持；
6. 从 Chat 输入需求或发送默认需求；
7. 检查并批准规划方案后再允许 Codex 修改代码。

自动检查通过后，工作流在 `http://localhost:5680` 启动使用数据库副本的隔离实例。用户实际操作页面后，才能选择：

- **预览通过并合并**：校验补丁哈希，提交隔离分支并在本地 `--no-ff` 合并；
- **拒绝合并**：停止预览，保留分支和 worktree；
- 两种情况都不会自动 push。

完整步骤见[Codex Coding Agent Demo 说明](workflows/codex-coding/README.md)。

> **安全提示**：当前本地 Demo 通过 `NODES_EXCLUDE=[]` 启用 Execute Command 节点，以运行三个固定宿主脚本。不要把这套配置直接用于共享或公网 n8n 实例。生产实现应使用专用白名单后端节点。

---

## Skill 文件夹导入

Agent Builder 的 **Upload folder** 支持完整文本 Skill 包：

~~~text
my-skill/
├─ SKILL.md
├─ references/
├─ templates/
├─ scripts/
├─ assets/
└─ examples/
~~~

运行时先读取 `SKILL.md`，再通过内置 `load_skill` 按相对路径渐进读取关联文件。

限制：

- 最多 128 个文本关联文件；
- 单文件最大 512 KB；
- 文本总量最大 2 MB；
- 忽略 `.env`、`.npmrc`、`.pypirc`、依赖和缓存目录；
- 二进制文件跳过并在导入界面提示；
- `scripts/` 只作为源码读取，不会自动执行。

---

## 数据与隐私

默认 n8n 数据位于用户目录的 `~/.n8n/database.sqlite`。

仓库不包含：

- 本地 SQLite；
- API Key 和凭据；
- Codex `auth.json`；
- `.env`；
- 工作流执行历史；
- 本机 Codex worktree。

Codex Runs 页面通过项目级只读 API 访问运行记录，前端不会读取任意 SQLite 文件路径。

---

## 当前边界

- 面向 Windows 本地单机演示；
- Loop 状态只保证在单次 Workflow Execution 内存在；
- 没有承诺分支在墙钟时间上真正并行；
- 没有实现自定义向量长期记忆；
- Skill 中的脚本不会直接执行；
- `codex-demo-fast` 只适合快速演示；
- 人工预览和提升目前由固定 PowerShell 脚本配合 Execute Command 完成；
- 最终提升只做本地 merge，不自动 push 或创建 PR；
- 不包含生产级多租户隔离、远程 worker 和崩溃恢复。

---

## 文档与源码入口

### 文档

- [最终设计文档](设计文档.md)
- [自定义节点字段说明](自定义节点字段说明.md)
- [Loop Engineering Demo](workflows/loop-engineering/README.md)
- [Codex Coding Agent Demo](workflows/codex-coding/README.md)

### 核心源码

| 内容 | 路径 |
| --- | --- |
| Goal Loop | `upstream/n8n/packages/nodes-base/nodes/LoopEngineering/GoalLoop/GoalLoop.node.ts` |
| Loop Evaluation | `upstream/n8n/packages/nodes-base/nodes/LoopEngineering/LoopEvaluation/LoopEvaluation.node.ts` |
| Loop 状态机 | `upstream/n8n/packages/nodes-base/nodes/LoopEngineering/loopEngine.ts` |
| Codex Coding Agent | `upstream/n8n/packages/nodes-base/nodes/CodexCodingAgent/CodexCodingAgent.node.ts` |
| Codex Runtime | `upstream/n8n/packages/cli/src/modules/codex-coding/` |
| Codex Runs 页面 | `upstream/n8n/packages/frontend/editor-ui/src/features/codexRuns/CodexRunsView.vue` |
| Worktree 预览与提升 | `scripts/start-codex-worktree-preview.ps1`、`scripts/promote-codex-worktree.ps1` |

---

## 许可说明

本仓库包含固定版本的 n8n 源码及其修改。n8n 相关源码的使用和分发受仓库内以下许可文件约束：

- [n8n Sustainable Use License](upstream/n8n/LICENSE.md)
- [n8n Enterprise License](upstream/n8n/LICENSE_EE.md)

第三方组件继续遵循各自的原始许可证。使用、修改或分发前，请阅读对应许可文件；本说明不构成法律意见。

---

## 项目状态

Talent-AI 当前用于技术验证、面试演示和架构探索。欢迎通过 Issue 讨论 Loop Engineering、Agent Runtime、验证协议和安全的自举开发流程。
