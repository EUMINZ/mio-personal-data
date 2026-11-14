# Mio

**由用户掌控、供 AI 按需使用的个人信息层。**

[English](README.md) · [接入 AI](docs/INTEGRATIONS.md) · [研究文章](docs/research/mio-personal-data-layer.zh-CN.md) · [验证记录](docs/VALIDATION.md) · [安全边界](SECURITY.md)

Mio 为个人事实、证据、更新建议、授权与审核记录提供一个本地结构化存储层。目标是让用户在不同 AI 助手之间携带自己的信息，并决定每项任务可以使用哪些内容。

当前是**从身份信息起步的 Alpha 版本**，包含 SQLite 核心、JSON 交换格式、本地 MCP 插件接口和两个模拟助手的示例。通用偏好与关系模型、远程认证，以及生产环境安全机制仍在规划中。

## 接入 Codex、Claude Code 或其他 MCP 客户端

需要 Node.js 24。从 GitHub 克隆后运行 `npm ci --ignore-scripts`，再按[接入指南](docs/INTEGRATIONS.md)注册 Mio。也提供固定 GitHub 版本的 npm 启动方式和 Claude Code 插件封装；尚未上架官方插件目录。

模型可以查看可用字段、读取已授权资料、提出待审修改。确认、重新分享和撤销由本地管理 CLI 执行。`--demo` 使用虚构内存资料；自己的资料通过显式字段配置导入。

GitHub 用于分发代码，数据库保存在本地。工具返回的授权内容仍会进入 AI 客户端，并可能发送到其模型服务。本地文件或 shell 权限可以绕过 MCP，这不是同账户进程之间的安全沙箱。

本轮[研究文章](docs/research/mio-personal-data-layer.zh-CN.md)保留了公平对照：Mio 与正确实现相同策略的 JSON 方案结果一致，二者都比整包传递减少无关资料。尚未证明模型准确率、token 成本或开发效率提升。另有[真实 Codex 调用记录](experiments/results/codex-mcp-smoke.json)验证接入流程。

## 运行

需要 Node.js 24。核心和示例没有第三方运行时依赖，无需下载模型或配置 API Key。在仓库根目录运行：

```sh
npm run demo
```

测试使用 Ajv 和 ajv-formats 校验 JSON Schema，先安装开发依赖：

```sh
npm ci
npm test
npm run check
```

`check` 执行 JavaScript 语法检查、测试和示例。[双助手示例](examples/two-assistants.js)使用虚构资料，向两个本地模拟助手提供不同字段，并演示将更新建议交回审核。它没有连接真实模型，示例中的权限检查也不包含调用者身份认证。记录“接受”决定不会自动修改正式事实。

## 已有能力

- **事实与证据：** 身份、联系方式、任职信息及其来源、状态和时间。
- **审核流程：** 更新建议、待审队列、审核决定和回执。
- **授权与审计记录：** 请求方、使用目的、允许的事实、到期时间、撤销和事件。
- **Wiki 与解释笔记：** 与结构化事实并存的背景信息。
- **检索和导出：** 摘要、时间线、Markdown 档案，以及精确、关键词和基于词语别名的语义检索。

公开范围包含 [mio-core](mio-core/README.md)、[contracts](contracts/README.md)、[examples](examples/)、[MCP 接口](adapters/mcp/)和[对照评测](benchmarks/README.md)，不包含 Web、iOS、浏览器扩展或特定国家业务流程。

## 使用边界

底层 repository 和 CLI 供可信宿主使用，可以直接访问数据。数据库和导出默认明文；`actorId` 与授权记录不等于身份认证。完整上下文、检索和全量导出不按授权裁剪，不能直接作为助手的受限接口。

宿主需要验证调用者、执行权限检查、取得用户确认，并单独应用已审核的事实更新。审计记录位于同一数据库，不具备防篡改保证。接入个人资料前请阅读[安全说明](SECURITY.md)。

本地 MCP 已加入授权范围检查和事务化审核写入，确认后需单独分享新版本。后续重点是真实任务收益、通用个人信息模型、远程认证、加密与恢复。

历史 API 中保留了 `Gemma` 名称以兼容格式，不需要 Gemma 模型。运行时采用 JavaScript 校验器，JSON Schema 描述交换格式，二者都不提供身份认证。详见 [contracts 说明](contracts/README.md)。项目采用 [Apache-2.0](LICENSE) 许可证。
