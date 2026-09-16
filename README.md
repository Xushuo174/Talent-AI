# Talent-AI

基于 n8n 的多 Agent 与 Loop Engineering 项目。

## Git 仓库结构

本项目统一由根目录的 `.git` 管理。`upstream/n8n` 是普通源码目录，不是子模块，也不再是嵌套仓库。

```text
Talent-AI/
├─ .git/                  根仓库及本地迁移备份
├─ upstream/n8n/          纳入版本管理的 n8n 源码
├─ workflows/            可导入工作流与说明
├─ scripts/              项目辅助脚本
└─ 设计文档.md
```

修改 n8n 源码之后，在项目根目录查看和提交：

```powershell
git status
git diff -- upstream/n8n
git add <本次修改的文件路径>
git commit -m "描述本次改动"
```

所有改动使用同一个 Talent-AI 仓库提交和推送。进入 `upstream/n8n` 后运行 Git，也会找到外层仓库。
不要在 `upstream/n8n` 再次执行 `git init`，也不要向该路径重新嵌套克隆 n8n。

外层首次源码基线从上游 Git tree 导入，而非从构建后的整个目录打包。原有依赖、构建产物、日志仍由忽略规则排除。
上游原本已跟踪的文件保留，即使其名称匹配上游某条忽略规则，也不会因迁移而遗漏。

## 固定上游基线

- 来源：https://github.com/n8n-io/n8n
- 标签：`n8n@2.38.7`
- 提交：`a2d0f7638bbb7582e33a4dfa1537eeb8ff066788`
- 源码 tree：`22b7a05d19e1de4703a3078535a7a68cb4481737`
- Node.js：24.x；pnpm：11.22.0

上游许可证、声明文件和锁文件随源码保留。
当前采用固定源码快照，后续升级上游版本需要单独进行差异合并；在子目录运行 `git pull` 不再更新上游 n8n。

## 2026-09-15 仓库迁移备份

原内层 `.git` 已原样移入以下本地备份，未删除：

```text
.git/local-backups/n8n-20260915-235536/repository.git
```

同目录包含原始状态、工作区补丁、暂存区补丁和基线元数据。这是本机恢复资料，不随 Git 推送。
原克隆是浅克隆，备份保留其原来已有的历史范围；没有补齐完整上游历史。

如需只读查看原内层历史，在根目录执行：

```powershell
git --git-dir=.git/local-backups/n8n-20260915-235536/repository.git log -1
```

## 构建与运行

首次完成构建后，可以直接双击项目根目录中的：

- `启动n8n.cmd`：检查端口并从 `upstream/n8n` 启动当前源码版本。
- `关闭n8n.cmd`：只关闭监听 5678 且命令行确认为 n8n 的 Node.js 进程。

启动窗口需要保持打开。源码发生变化后仍需先完成一次构建，再双击启动脚本。

从 `upstream/n8n` 执行：

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd build --concurrency=1 > build.log 2>&1
pnpm.cmd start
```

需要代理时，在启动 n8n 的终端配置已经验证可用的代理环境变量。
默认工作流、凭据和执行记录仍保存在用户目录 `.n8n` 的数据库中，不会因为源码仓库迁移而转移到本项目。

## Demo

参见 [Loop Engineering 工作流说明](workflows/loop-engineering/README.md)。

## Skill 文件夹导入

Agent Builder 的 **Upload folder** 支持导入完整的文本型 Skill 包。系统读取根目录的 `SKILL.md`，并按路径保存以下文件组：

- `references/`：Markdown 参考资料。
- `templates/`：文本模板。
- `scripts/`：Python、Shell、PowerShell、JavaScript、TypeScript 等脚本源码。
- `assets/`：CSS、SVG、JSON 等文本资源。
- `examples/`：示例文件。
- 其他路径：README、LICENSE、子 Skill 说明等文本文件。

运行时继续使用内置的 `load_skill` 工具。Agent 先加载 `SKILL.md`，再根据任务按相对路径读取需要的关联文件，避免把整个 Skill 包一次性放进上下文。

当前边界：

- 最多导入 128 个文本关联文件；单个文件不超过 512 KB；总量不超过 2 MB。
- `.env`、`.npmrc`、`.pypirc` 和常见依赖、缓存目录会被忽略。
- PNG、DOC、DOCX 等二进制文件会跳过，并在导入界面列出提示。
- `scripts/` 中的文件是可读取的源码。`load_skill` 不执行脚本。脚本执行需要后续接入独立的沙箱工具，并配置权限、超时、网络和文件访问策略。
