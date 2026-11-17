# Mio

**由本人掌控、供 agent 使用的身份层。**

[English](README.md) · [接入 AI](docs/INTEGRATIONS.md) · [研究文章](docs/research/mio-personal-data-layer.zh-CN.md) · [验证记录](docs/VALIDATION.md) · [安全边界](SECURITY.md)

Mio 在本地维护可复用的个人事实、来源和授权。办事过程中发现的新信息先进入审核，确认后成为身份档案的一部分，再由本人决定向哪些 agent 共享。

目标是同一份身份档案可跨 agent、跨任务使用。出行是首批场景之一，当前试用还包含入职登记。此版本生成虚构表单草稿；对接官方网站、上传材料和代为提交仍属于后续集成。

`0.3.0-alpha` 是**从身份信息起步的 Alpha 版本**，包含 SQLite 核心、JSON 交换格式、本地 MCP 插件接口和两个模拟助手的示例。通用偏好与关系模型、远程认证，以及生产环境安全机制仍在规划中。

## 用同一身份跑通两个场景

需要 **Node.js 24、npm 和 Git**。以下命令适用于 macOS/Linux 的 POSIX shell，会下载尚未发布的试用分支；`v0.3.0-alpha` 旧版本不含审核页面。请在准备存放新检出的目录运行：

```sh
git clone --branch codex/shared-profile-trial --single-branch https://github.com/EUMINZ/mio-personal-data.git mio-personal-data-trial
cd mio-personal-data-trial
git rev-parse HEAD
npm ci --ignore-scripts
mio_trial_dir="$(mktemp -d)/profile"
npm run demo:shared -- "$mio_trial_dir"
```

记录输出的提交号，反馈时用它标明版本。`mktemp` 在仓库外新建父目录，启动器在其中创建虚构资料。保持终端运行，打开输出的本地审核地址；该地址包含操作令牌，请不要分享。

两个独立 MCP 配置共用一个持久 SQLite 数据库：**出行申请 A** 和 **入职登记 B**。在出行任务中采集缺失的雇主信息，审核入库，再分别共享给 A、B；两个场景即可复用同一条已确认事实及其来源。目的地、出行目的、入职安排等本次任务答案不会写入身份档案。

待审提议不能用于填写身份字段，批准后也不会自动共享。页面保留**填写理由拒绝提议**、**关闭过时提议**和独立撤销授权；处理历史可查看。请使用新的演示目录，旧目录的授权不会被自动扩大。

- **本地体验：** 使用页面的新信息采集、审核、共享和草稿控件，不需要模型账户或 API Key，也不会调用模型。
- **真实客户端：** 将启动器输出的完整 **Codex A** 和 **Claude Code B** 命令分别复制到两个终端。实际路径已填好，不修改用户级 MCP 注册；客户端需要已有登录和模型访问权限，调用可能消耗账户额度。

当前身份层试用通过 152 项自动测试；这些测试与真实模型调用、外部试用分开记录，详见[验证记录](docs/VALIDATION.md)。完整步骤见[试用指南](docs/SHARED_PROFILE_TRIAL.md)。需要重新显示客户端命令时，在仓库根目录运行 `npm run demo:shared:commands -- /absolute/existing-demo-directory`，目录使用启动时输出的资料目录。该命令不会创建资料或续期授权。

初始流程已经自动测试和浏览器验证；真实 Codex 完成了 A 的流程，Claude Code 因认证失败未调用工具，B 另由官方 MCP SDK 验证。该[历史记录](docs/trials/shared-profile-live-validation-2026-11-16.json)不代表完整双模型或外部试用通过；后续改动的检查见[验证记录](docs/VALIDATION.md)。

## 接入 MCP

需要 Node.js 24。从 GitHub 克隆并切换到 `v0.3.0-alpha`，运行 `npm ci --ignore-scripts`，再按[接入指南](docs/INTEGRATIONS.md)注册 Mio。也提供固定 GitHub 版本的 npm 安装方式和 Claude Code 插件封装；尚未上架官方插件目录。

已发布的 `v0.3.0-alpha` 默认有两个工具：`mio_context` 用 `{}` 发现可读字段，用 `fields` 数组批量读取；`mio_propose_update` 提出待审修改。**尚未发布的试用分支还提供 `mio_propose_fact`**，在独立采集权限下，将缺失的个人事实及其来源交回审核。批量读取返回已授权值、统一的 `unavailable` 字段列表和检查时间 `checkedAt`。缺失或不可读字段不会拖累其余可读字段，但整个授权失效、数据库或审计失败时，整次调用失败。

每次读取重新检查数据库和授权，不使用读取缓存；`checkedAt` 不保证资料在现实中仍真实、最新。已发布版的 `--legacy-tools` 提供三个工具；试用分支增加 `mio_propose_fact` 后为四个。Claude 插件使用所运行版本的默认接口。确认、重新分享和撤销仍由本地管理 CLI 执行。`--demo` 使用虚构内存资料；自己的资料通过显式字段配置导入。

GitHub 用于分发代码，数据库保存在本地。工具返回的授权内容仍会进入 AI 客户端，并可能发送到其模型服务。本地文件或 shell 权限可以绕过 MCP，这不是同账户进程之间的安全沙箱。

此前的[工程研究](docs/research/mio-personal-data-layer.zh-CN.md)保留了公平对照：Mio 与正确实现相同策略的 JSON 方案结果一致，二者都比整包传递减少无关资料。这不能证明模型准确率、token 成本或开发效率提升。另有 `0.2.0-alpha` 的[真实 Codex 调用记录](experiments/results/codex-mcp-smoke.json)验证接入流程。

新的[准确率与成本实验](experiments/accuracy-cost/README.md)在同模型、同任务和同授权规则下完成了 40 次真实 Codex 会话：旧接口正确完成 12/20，新接口 20/20，差异来自减少可读字段漏填。总输入 token 减少 7.34%，但非缓存输入增加 3.50%；不能声称单次请求的实际费用更低。`0.3.0-alpha` 通过 110 项自动测试。[研究记录](docs/research/accuracy-cost-optimization.zh-CN.md)提供完整结果与边界；合成小样本不能代表通用模型准确率。

## 已发布版本的模拟演示与开发检查

要复现旧版的内存模拟演示，请使用一个独立检出：

```sh
git clone --branch v0.3.0-alpha --single-branch https://github.com/EUMINZ/mio-personal-data.git mio-personal-data-v0.3
cd mio-personal-data-v0.3
npm ci --ignore-scripts
npm run demo
```

该旧版本不含共享审核页面，也没有 `demo:shared` 脚本。核心和内存模拟演示没有第三方运行时依赖；MCP 接口与共享审核示例使用 npm 安装的 SDK 和校验器。两个版本都可在各自仓库根目录运行：

```sh
npm run check
```

`check` 执行 JavaScript 语法检查、测试和示例。[双助手示例](examples/two-assistants.js)使用虚构资料，向两个本地模拟助手提供不同字段，并演示将更新建议交回审核。它没有连接真实模型，示例中的权限检查也不包含调用者身份认证。记录“接受”决定不会自动修改正式事实。

## 已有能力

- **事实与证据：** 身份、联系方式、任职信息及其来源、状态和时间。
- **采集与审核：** 新事实与已有事实的修正提议、来源、待审队列、拒绝、关闭过时提议和回执。
- **跨场景草稿：** 两份虚构模板复用明确共享的事实版本，任务专属答案与身份档案分开。
- **授权与审计记录：** 请求方、使用目的、允许的事实、到期时间、撤销和事件。
- **Wiki 与解释笔记：** 与结构化事实并存的背景信息。
- **检索和导出：** 摘要、时间线、Markdown 档案，以及精确、关键词和基于词语别名的语义检索。

公开范围包含 [mio-core](mio-core/README.md)、[contracts](contracts/README.md)、[examples](examples/)及本地审核示例页、[MCP 接口](adapters/mcp/)和[对照评测](benchmarks/README.md)，不包含完整产品应用、iOS、浏览器扩展或特定国家业务流程。

## 使用边界

底层 repository 和 CLI 供可信宿主使用，可以直接访问数据。数据库和导出默认明文；`actorId` 与授权记录不等于身份认证。核心的完整上下文、检索和全量导出不按授权裁剪；MCP 的 `mio_context` 另行执行授权检查，仍无法隔离拥有同账户文件权限的进程。

宿主需要验证调用者、执行权限检查、取得用户确认，并单独应用已审核的事实更新。审计记录位于同一数据库，不具备防篡改保证。接入个人资料前请阅读[安全说明](SECURITY.md)。

当前里程碑是“采集 → 审核 → 共享 → 两个场景复用”。后续扩展结构化地址、多证件、任职历史与来源冲突处理，并逐个验证真实表单适配。读取资料、填写草稿和向指定机构提交需要分别表达权限；通用代办执行、身份认证、加密与恢复尚未实现。

历史 API 中保留了 `Gemma` 名称以兼容格式，不需要 Gemma 模型。运行时采用 JavaScript 校验器，JSON Schema 描述交换格式，二者都不提供身份认证。详见 [contracts 说明](contracts/README.md)。项目采用 [Apache-2.0](LICENSE) 许可证。
