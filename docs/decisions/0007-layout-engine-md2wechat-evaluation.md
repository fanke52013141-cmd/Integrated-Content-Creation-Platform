# ADR 0007：排版引擎沿用 markdown-it + juice 组合，不引入 md2wechat

状态：已决定（2026-09-20）

关联：《用户创作体验审查与优化方案-2026-09-20》§8.1、§8.2（要求把“既定复用 md2wechat”这项决策落实为可运行的小样，而不是继续只在文档里标注“已决定”）

## 背景

早期 PRD 写了“使用开源 md2wechat 做公众号排版”，但代码里从来没有这个依赖：`src/main/services/article-layout-service.ts` 一直是 markdown-it 解析 + juice 内联样式的自实现，并已通过 F04/F12/F11 的端到端回归。方案要求把这条未落实的复用决策验证清楚，来源或授权链不满足时记录新的决策。

## 验证方式与证据

只做了静态核验（registry 元数据 + 发布产物解包），**没有**在该包上执行任何代码，也没有把它装进本项目：

| 核验点 | 结果 |
|---|---|
| `npm view md2wechat@2.0.5` | `license = MIT`、`main = ./dist/index.js`、`exports` 只有 `import` 条件（ESM-only）、`engines.node >= 18`、单一维护者 |
| `repository` 字段 | **缺失** —— 无法从产物确定上游仓库与授权链 |
| 发布产物内容（`npm pack` 解包列表） | **不含 LICENSE / COPYING 文件**（`package.json` 声明 MIT，但无授权文本随包分发） |
| 能力构成 | `dist/core/{parser,converter,image-handler,wechat-api}.js` + `themes/*.css`；依赖 `markdown-it ^14`、`juice ^10`、`highlight.js ^11`、`katex`、`form-data`、`commander`、`dotenv`、`ora` |

对照本项目现状：排版链已经是 `markdown-it ^15.0.1` + `juice ^12.1.2` + `highlight.js ^11.12.0`（版本均不低于该包所固定的版本），主题在 `layout-themes.ts`，微信上传与草稿在 `wechat-publish-service.ts` 的主进程 IPC 里做，密钥不进渲染进程、也不走 `.env`。

## 决策

1. 不引入 `md2wechat`。它提供的解析、主题、样式内联能力本项目已具备，而其来源无法核验（`repository` 缺失、产物无 LICENSE），把它接进发布链路属于用无法审计的依赖替换已有可审计实现。
2. 其 `wechat-api` + `dotenv` 的 CLI 式配置模型与本项目的主进程密钥边界冲突，即使来源可核验也不应采用。
3. 方案 §8.2 的“落实为可运行的小样”以本 ADR 的核验结论收口：**决策从“复用 md2wechat”改为“维持 markdown-it + juice 组合”**，与 §8.1 给出的备选路径一致（“若完整排版包不适合，就复用解析器+内联样式组合；不再自写逐行语法解析”）。
4. 未做的部分要说清楚：没有运行该包做输出比对，因此“它的输出比我们现在更好”既未证实也未证伪。若将来要重开，前提是上游补上可核验的仓库与 LICENSE，并在隔离目录里用固定样稿做输出对比。

## 后果

- `docs/` 里“PRD 已决定使用 md2wechat”的旧表述以本 ADR 为准。
- 真正的差异只剩尚未验证的外部环节：粘贴进真实公众号编辑器后的样式保真（F12/F13 外部联调），这与选哪个解析库无关，换一个包也不会自动解决。
- §8.1 表中其余候选（Milkdown/Tiptap 编辑器、XState、TanStack Query、jsdiff、Readability、SearXNG）保持“候选未采纳”，本项目当前用 `useWorkDraft` + `generation_tasks` 台账满足了阶段 A/B 的退出标准；是否引入按真实需求再开 ADR。
