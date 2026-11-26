# 微信公众号排版项目全网定向调研与借鉴方案

> 调研日期：2026-11-26（Asia/Shanghai）
> 目标：为一个新的集成内容创作平台选择公众号排版技术底座，并提炼产品、架构、质量与发布闭环的可落地路线。
> 当前项目状态：工作目录为空，没有既有代码、技术栈或功能可继承，因此本文按“从零规划”给出建议。

## 0. 结论先行

### 推荐主路线

**以 `doocs/md` 为编辑与排版底座，自研“品牌主题编译器 + 发布前 readiness 检查”，接入微信官方文章结构校验与 MP 编辑器 JS API，再逐步扩展多平台分发。**

不要把目标定成“再做一个 Markdown 编辑器”。市场上编辑、换肤和复制功能已经高度同质化，真正值得投入的是：

1. **写入微信后仍保持原样**：样式内联、合法 DOM、图片转存、真实微信编辑器读回校验、移动端与 Dark Mode 回归。
2. **品牌一致性而非模板数量**：品牌色、字体尺度、间距、标题、引用、卡片、署名等统一为主题令牌和组件配方。
3. **AI 可控而非自由生成 HTML**：AI 只负责文章类型识别、主题/组件选择和受限令牌建议，确定性渲染器负责最终 HTML。
4. **从文章到草稿的闭环**：`inspect → preview → 图片上传 → 创建草稿 → 读回核验`，发布与草稿严格分离。
5. **一份内容，多平台输出**：保存源文档与结构化中间表示，不将微信专用 HTML 当作唯一数据源。

### 各项目怎么用

| 决策 | 项目/能力 | 建议 |
|---|---|---|
| 直接作为主底座 | [doocs/md](https://github.com/doocs/md) | 首选。活跃、功能完整、模块化程度高；优先采用 fork + upstream 跟随，避免大面积改写内核。 |
| 官方质量基线 | [verify-article-structure-spec](https://github.com/wechatjs/verify-article-structure-spec) | 必须接入。MIT、官方规范与测试用例来源，可进 CI；同时补其尚未实现的检查。 |
| 写入公众号后台 | [MP 编辑器 JS API](https://developers.weixin.qq.com/doc/service/guide/product/mp_editor_jsapi.html) | 浏览器扩展优先使用官方 `set/insert/get_content`，复制粘贴作为降级路径。 |
| 借鉴主题与质量工程 | [gzh-design-skill](https://github.com/isjiamu/gzh-design-skill) | 学“设计变量、组件配方、源头/产物双校验”；AGPL 代码和主题资产不直接进入闭源产品。 |
| 借鉴 Agent 发布契约 | [md2wechat-skill](https://github.com/geekjourneyx/md2wechat-skill) | 学 `capabilities/doctor/inspect`、预览与副作用分离；高级渲染付费且商业使用受限，不作免费底座。 |
| 借鉴多平台分发 | [Wechatsync](https://github.com/wechatsync/Wechatsync) | 学本地浏览器桥接、平台适配器、图片转存和草稿优先；GPL 与适配器维护成本需评估。 |
| 历史参考 | [markdown-nice](https://github.com/mdnice/markdown-nice)、[wechat-format](https://github.com/lyricat/wechat-format) | 前者看主题生态，后者看列表和链接尾注化；均不建议作为新底座。 |
| 不作为排版核心 | exporter、AIWriteX、mpeditor | exporter 已停更；AIWriteX 有附加分发/SaaS 限制；mpeditor 仅作轻量交互历史参考。 |

---

## 1. 调研范围、口径与限制

### 检索范围

- GitHub Search API 多组关键词：`公众号排版`、`wechat markdown editor`、`mdnice`、`markdown to wechat`，并用相关 topic 交叉补充。
- 项目 README、LICENSE/NOTICE、package.json、关键渲染与校验源码。
- 微信官方文档：素材、草稿、发布、MP 编辑器 JS API、第三方编辑器插件规范。
- 135 编辑器、秀米、壹伴等在线工具官网及公开功能说明。

### 排名口径

- Stars/Forks 是 **2026-11-26 当日 GitHub API 快照**，会持续变化。
- `pushed_at` 是 UTC 日期，只表示仓库有提交，不代表功能仍可用。
- 按主要用途分为“核心排版”“Agent/AI/发布”“分发/采集”，不把仅关键词命中的高星仓库混入编辑器排名。
- `mdnice` 只统计原仓库 `mdnice/markdown-nice`，不混入二次修改版。

### 调研限制

- 通用网页搜索接口在调研时不可用，改用 GitHub 实时接口、原始源码、工具官网、Bing RSS 和微信官方文档交叉验证；本文是**全网公开资料的定向调研**，不是对互联网所有页面的穷尽。
- 本次未使用真实公众号账号执行发布，也未对所有项目做真机兼容性测试。凡项目自述“100% 还原”“绝不掉样式”均只视为项目声明，不能直接当作验收结论。
- 许可证分析用于技术选型风险提示，不替代正式法律意见；实际商用前仍需审查依赖、主题、图片、字体和其他素材授权。

---

## 2. 高星项目全景

### 2.1 实时元数据

| 类别 | 项目 | Stars / Forks | 最近 push（UTC） | 语言 | 许可证 | 判断 |
|---|---|---:|---|---|---|---|
| 核心编辑器 | [doocs/md](https://github.com/doocs/md) | **13,564 / 2,256** | 2026-11-26 | TypeScript | WTFPL | 活跃，排版相关性最高，主底座首选 |
| 导出工具，非编辑器 | [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter) | **13,190 / 2,296** | 2026-11-09 | TypeScript | MIT | README 已宣布 2026-07-30 停更，不可按“第二高星编辑器”理解 |
| 多平台分发 | [Wechatsync](https://github.com/wechatsync/Wechatsync) | **6,680 / 1,136** | 2026-11-15 | TypeScript | GPL-3.0 | 活跃，适合参考分发层，不是排版内核 |
| 核心编辑器，历史 | [markdown-nice](https://github.com/mdnice/markdown-nice) | **4,681 / 725** | 2023-10-06 | JavaScript | GPL-3.0 | 超过三年未 push，主题思路有价值，老栈不宜直接依赖 |
| 核心编辑器，停更 | [wechat-format](https://github.com/lyricat/wechat-format) | **4,558 / 595** | 2025-09-13 | JavaScript | 未发现明确许可证 | README 明确 discontinued，仅提炼兼容规则 |
| Agent 排版 | [gzh-design-skill](https://github.com/isjiamu/gzh-design-skill) | **4,475 / 497** | 2026-10-21 | HTML | AGPL-3.0 | 质量工程和 Agent 排版突出，闭源复用风险高 |
| AI/发布 CLI | [md2wechat-skill](https://github.com/geekjourneyx/md2wechat-skill) | **3,828 / 424** | 2026-11-24 | Go | Source Available，基于 BUSL-1.1 | 活跃；高级渲染依赖付费 API，商用须授权 |
| AI 全流程 | [AIWriteX](https://github.com/iniwap/AIWriteX) | **2,332 / 438** | 2026-11-26 | Python | Apache-2.0 + 附加 NOTICE 限制 | 排版只是子模块，NOTICE 限制分发与 SaaS |
| 轻量历史项目 | [mpeditor](https://github.com/ksky521/mpeditor) | **193 / 40** | 2022-05-12 | JavaScript | MIT | 仅作同步滚动、轻量编辑体验参考 |

> 数据复核入口：[doocs/md API](https://api.github.com/repos/doocs/md)、[markdown-nice API](https://api.github.com/repos/mdnice/markdown-nice)、[wechat-format API](https://api.github.com/repos/lyricat/wechat-format)、[gzh-design-skill API](https://api.github.com/repos/isjiamu/gzh-design-skill)、[md2wechat-skill API](https://api.github.com/repos/geekjourneyx/md2wechat-skill)、[Wechatsync API](https://api.github.com/repos/wechatsync/Wechatsync)、[AIWriteX API](https://api.github.com/repos/iniwap/AIWriteX)、[exporter API](https://api.github.com/repos/wechat-article/wechat-article-exporter)。

### 2.2 “Star 榜”不等于“值得借鉴榜”

综合排版相关性、维护状态、许可证和可复用性，建议顺序为：

1. **doocs/md**：主技术底座。
2. **微信官方结构校验 + MP 编辑器 JS API**：兼容性与写入闭环的官方基线，价值高于多数高星项目。
3. **gzh-design-skill**：主题组件和质量闭环设计参考。
4. **Wechatsync**：多平台分发架构参考。
5. **md2wechat-skill**：Agent discovery、发布前检查和副作用边界参考。
6. **markdown-nice / wechat-format**：历史规则与主题参考。
7. **AIWriteX**：仅选择性参考流程编排，先解决许可与内容合规问题。
8. **mpeditor / exporter**：轻量 UX、导出资产打包参考，不承担核心能力。

---

## 3. 代表项目深度拆解

### 3.1 doocs/md：最适合做底座

**已核验能力**（[README](https://raw.githubusercontent.com/doocs/md/main/README.md)）：

- Markdown、KaTeX、Mermaid、PlantUML、GFM 警告块、Ruby 注音。
- 代码高亮、自定义主题色和 CSS。
- 本地草稿、自动保存、偏好云同步、文件导入导出。
- GitHub、阿里云、腾讯云、七牛云、MinIO、S3、R2、公众号等多图床。
- 多模型 AI 助手。
- Web、Chrome/Firefox 扩展、uTools、CLI、Docker、私有化部署。

**源码结构确认**：当前根 [package.json](https://raw.githubusercontent.com/doocs/md/main/package.json) 是 pnpm monorepo，包含 Web、VS Code、API、CLI、MCP 等；核心包 [@md/core](https://raw.githubusercontent.com/doocs/md/main/packages/core/package.json) 使用 `marked`、DOMPurify、Mermaid、highlight.js 等，Web 端使用 Vue 3、CodeMirror 6、Pinia 和 `juice`。

**最值得借鉴**：

- 编辑器、核心渲染、上传适配器、AI、部署形态分层，而不是所有逻辑塞在页面组件中。
- 本地草稿自动保存、图片上传适配器、多客户端复用核心。
- 既有测试与 monorepo 工程化，可减少从零搭建成本。

**注意事项**：

- `@md/core` 当前标记为 `private: true`，不是可以理所当然直接 npm 安装的公共稳定 API；更现实的方式是 fork、git submodule 或在上游 monorepo 内扩展。
- 不建议一次性照搬所有图床、AI 提供商和客户端。保留主流程，按平台需求裁剪。
- WTFPL 不等于依赖、Logo、主题、图片和字体都无授权问题；仍需 SBOM 和资产清单。

### 3.2 markdown-nice：主题生态值得看，老代码不值得押注

[README](https://raw.githubusercontent.com/mdnice/markdown-nice/master/README.md) 显示其支持自定义主题、公众号/知乎/掘金；[package.json](https://raw.githubusercontent.com/mdnice/markdown-nice/master/package.json) 可见 `markdown-it + juice` 等实现。

**借鉴**：主题列表与预览、用户自定义 CSS、同文多平台输出、样式内联化。
**不借鉴**：直接以其作为新平台底座。仓库超过三年未 push，旧依赖需要安全审计；GPL-3.0 也不适合未经评审就并入闭源产品。

### 3.3 wechat-format：只提炼两条具体兼容经验

[README](https://raw.githubusercontent.com/lyricat/wechat-format/master/README.md) 已明确停止维护，并转向 Quaily 在线工具。

仍值得独立实现和测试的规则：

1. 处理 `ul/ol` 在微信编辑器中被重置的问题。
2. 将正文链接转换为参考文献索引和文末列表，以适配公众号正文链接限制。

仓库未发现明确许可证，不能把“公开可读”理解为“可自由复制”。

### 3.4 gzh-design-skill：最值得学的是“确定性质量工程”

[README](https://raw.githubusercontent.com/isjiamu/gzh-design-skill/main/README.md) 和 [校验脚本](https://raw.githubusercontent.com/isjiamu/gzh-design-skill/main/scripts/validate_gzh_html.py) 显示：

- 6 套主题和主题生成器，按题材选择组件配方。
- 样式全内联、文本节点 `span leaf` 包裹，项目自行限制多种标签和 CSS 写法。
- `component_lint.py` 检查组件库源头，`validate_gzh_html.py` 检查最终 HTML。
- 将平台规则下沉到脚本，而不是依赖 Agent 自觉。

**我们应当吸收的原则**：AI 做语义选择，脚本做硬约束；主题先过源头 lint，文章再过产物 lint 和真实浏览器布局检查。

**不能照抄的地方**：AGPL-3.0 对修改后网络服务有源码提供义务。若我们做闭源 SaaS，应自行建立规则、组件和测试，不直接复制其代码或主题资产。其脚本通过也不代表所有微信端场景都已验证，仍需官方校验和真实微信读回。

### 3.5 md2wechat-skill：发布契约很好，但不是自由开源渲染器

[README](https://raw.githubusercontent.com/geekjourneyx/md2wechat-skill/main/README.md) 显示其提供：

- `capabilities`、`doctor`、`inspect` 等机器可读 discovery。
- `inspect/readiness → preview → convert/upload/draft` 的明确边界。
- AI 配图、多账号、多平台草稿、品牌档案。
- 付费 API 中的专业主题和高级排版模块。

最值得借鉴的是 **“执行前先回答是否可执行、缺什么、会产生什么副作用”**。例如草稿创建前就检查标题、摘要、封面、正文图片和账号能力，而不是失败后才报错。

[LICENSE](https://raw.githubusercontent.com/geekjourneyx/md2wechat-skill/main/LICENSE) 明确：当前为 Source Available，商业产品、企业内部营收相关工作流、SaaS、白标等需要单独授权；2030-01-01 后按条款转 Apache-2.0。高级渲染又依赖付费 API，因此我们只独立借鉴接口思想。

### 3.6 Wechatsync：编辑器与分发器应解耦

[README](https://raw.githubusercontent.com/wechatsync/Wechatsync/v2/README.md) 显示其采用 Chrome 扩展、本机登录态、平台适配器、图片转存和草稿优先，支持多平台以及 CLI/MCP/SDK。

**借鉴**：一份文章由分发层适配不同平台；同步默认进入草稿；平台能力检测；网页端 SDK 与编辑器解耦。
**风险**：各平台 Web API/DOM 变化会造成持续维护成本；Cookie 和扩展权限必须最小化；GPL-3.0 代码不能直接无条件并入闭源产品。公众号自身优先采用官方 MP JS API，跨平台再参考其适配器模式。

### 3.7 AIWriteX：只参考流程，不直接引入

其“题材分类 → 模板/风格 → 生成 → 审核 → 发布”流程有参考价值，但排版只是全流程一环。

[NOTICE](https://raw.githubusercontent.com/iniwap/AIWriteX/main/NOTICE) 在 Apache-2.0 之外增加了非商业、分发和面向第三方服务限制，明确涉及 SaaS/API 托管。对我们这种平台不能按“Apache 可自由商用”处理。热点采集、洗稿、绕过检测等方向也不应成为我们的产品目标，需坚持授权内容、人工审核和平台规则。

### 3.8 exporter 与 mpeditor

- [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter) 虽有 13,190 星，但 [README](https://raw.githubusercontent.com/wechat-article/wechat-article-exporter/master/README.md) 明确上游核心接口关闭、项目停更、在线站下线。只可参考多格式导出和 HTML 资产打包，不可作为新采集依赖。
- [mpeditor](https://github.com/ksky521/mpeditor) 仅 193 星且多年未更新，可参考实时预览、同步滚动等轻量体验，不承担核心渲染。

---

## 4. 微信官方能力：本次调研中最重要的增量

### 4.1 官方文章结构规范与校验器

微信官方[第三方编辑器插件规范](https://developers.weixin.qq.com/doc/service/guide/product/plugin_spec.html) 指向 [verify-article-structure-spec](https://github.com/wechatjs/verify-article-structure-spec)。该仓库为 MIT，提供：

- 权威规则文档与 good/bad cases。
- 基于 Puppeteer 的真实浏览器 `check`。
- 清理冗余嵌套的 `dedupe`，可形成“检测 → 清理 → 复测”。
- JSON 输出与退出码，适合 CI。

官方规范覆盖宽度溢出、固定高度遮挡、行高叠字、`pre` 横向滚动、DOM 结构、字体、Dark Mode、SVG 等多个维度；CLI 的实际覆盖范围以其 README 为准。

**重要限制**：其 [README](https://raw.githubusercontent.com/wechatjs/verify-article-structure-spec/main/README.md) 明确说明，CLI 尚未覆盖字体检测及 `span[leaf]` / `section[nodeleaf]` 的全部结构检查，所以“CLI 通过”不等于“整篇文章完全合规”。我们应：

1. 将官方 CLI 纳入 CI。
2. 自补安全 sanitize、目标标签/属性白名单、`span[leaf]` 结构和素材检查。
3. 再做真实 MP 编辑器读回和移动端人工回归。
4. 锁定校验器版本并跟踪上游规则，避免规范更新后主题悄悄失效。

### 4.2 官方 MP 编辑器 JS API：从“复制粘贴”升级为“写入并读回”

[MP 编辑器 JS API](https://developers.weixin.qq.com/doc/service/guide/product/mp_editor_jsapi.html) 在 `window.__MP_Editor_JSAPI__` 上提供：

- `mp_editor_get_isready`：检测编辑器状态。
- `mp_editor_get_content`：读取全文富文本。
- `mp_editor_set_content`：设置全文。
- `mp_editor_insert_html`：插入 HTML。
- `mp_editor_change_cover`：修改封面与裁剪。
- `contentchange`、`selectionchange` 等事件。

这为浏览器扩展提供了官方路径：**渲染 → 写入 → 读回 → 对比 → 报告微信实际改写/删除的内容**。部分接口要求 `isNew=true`，所以必须做能力检测，并保留 Clipboard 复制作为降级。

### 4.3 图片与草稿 API 的硬约束

微信官方[上传发表内容图片](https://developers.weixin.qq.com/doc/service/api/material/permanent/api_uploadimage.html)：

- `/cgi-bin/media/uploadimg`，必须服务端调用。
- 返回正文图片 URL。
- 当前文档注明仅支持 JPG/PNG，且图片小于 1MB。

[新增草稿](https://developers.weixin.qq.com/doc/service/api/draftbox/draftmanage/api_draft_add.html)：

- `/cgi-bin/draft/add`，必须服务端调用，也支持第三方平台代商家调用。
- 正文中的外部图片 URL 会被过滤，必须使用微信正文图片接口获取的 URL。
- 当前文档要求标题不超过 32 字、作者不超过 16 字、摘要不超过 120 字；正文少于 2 万字符且小于 1M；图文消息封面必须永久素材 `thumb_media_id`。
- 封面裁剪支持 2.35:1 与 1:1。

因此在服务端草稿路径中，GIF、大于 1MB 图片、外链图片不能靠“直接塞 HTML”解决，必须在发布前完成压缩、格式转换、上传或明确阻断，不能静默丢失；Clipboard/MP 编辑器路径也要单独验证 GIF 的实际表现。

### 4.4 发布不是草稿，也不等于群发

官方[发布能力](https://developers.weixin.qq.com/doc/service/guide/product/publish.html)提供 `/cgi-bin/freepublish/submit` 和状态查询；文档同时注明，自 2025 年 7 月起部分个人、未认证等账号的接口权限被回收。

产品上必须分开：

- 复制到编辑器。
- 通过 MP JS API 写入当前编辑器。
- 服务端创建/更新草稿。
- 提交发布并轮询状态。
- 群发/通知粉丝（另一业务动作，不能用“发布成功”含糊替代）。

默认只到草稿，发布需要独立权限、明确确认和审计记录；无接口权限的账号自动降级到复制或浏览器扩展路径。

---

## 5. 推荐技术架构

### 5.1 总体链路

```text
Markdown / DOCX / 授权网页 / 历史文章
                │
                ▼
       输入规范化与安全清洗
                │
                ▼
      源文档 + 结构化 Document IR
                │
        ┌───────┴────────┐
        ▼                ▼
  品牌主题编译器       内容语义分析
  tokens + 组件配方    文章类型/组件建议
        └───────┬────────┘
                ▼
       确定性 WeChat Renderer
                │
                ▼
 CSS 内联 → 标签/属性规范化 → 安全 sanitize
                │
                ▼
 自研静态 lint + 官方浏览器校验 + 图片/元数据检查
                │
      ┌─────────┼──────────┐
      ▼         ▼          ▼
 Clipboard   MP JS API   服务端草稿 API
 双 MIME     写入并读回   图片转存/封面/草稿
      └─────────┼──────────┘
                ▼
       差异报告与人工确认
                │
                ▼
      独立的发布审批与状态跟踪
```

### 5.2 渲染层：尽量复用 doocs，不重新发明轮子

源码调研确认 doocs 的主链路为：

- `marked` token 与自定义 renderer/扩展负责 Markdown 转换（[renderer-impl.ts](https://github.com/doocs/md/blob/main/packages/core/src/renderer/renderer-impl.ts)）。
- DOMPurify 做 HTML 安全清洗与后处理（[markdownHelpers.ts](https://github.com/doocs/md/blob/main/packages/core/src/utils/markdownHelpers.ts)）。
- `juice` 将主题 CSS 内联（[clipboard.ts](https://github.com/doocs/md/blob/main/apps/web/src/services/export/clipboard.ts)）。
- 微信专用结构修复与 SVG 归一化（[clipboard-dom.ts](https://github.com/doocs/md/blob/main/apps/web/src/services/export/clipboard-dom.ts)、[wechat-svg.ts](https://github.com/doocs/md/blob/main/apps/web/src/services/export/wechat-svg.ts)）。
- Clipboard API 同时写入 `text/html` 与 `text/plain`，并有 `execCommand` 回退（[editor-header/index.vue](https://github.com/doocs/md/blob/main/apps/web/src/components/editor/editor-header/index.vue)）。

两个源码细节需要特别注意：

1. README 写 KaTeX，但当前[公式扩展](https://github.com/doocs/md/blob/main/packages/core/src/extensions/katex.ts)实际调用 MathJax `tex2svg`；评估包体、渲染结果和依赖时应以代码为准。
2. 当前 sanitize 主要是 DOMPurify 默认策略加 `mp-common-profile`，**不是一份显式、完整的微信标签/属性白名单**；`sanitizeSvgsForWeChat()` 也是兼容转换而非完整 XSS 清洗器。因此仍需在输入和最终输出两侧实施自己的安全策略，不能把“用了 DOMPurify”当作审计结束。

建议采用 **fork + upstream remote + 自有扩展包**，而不是把上游代码零散复制进新项目：

```text
upstream: doocs/md
  ├─ 尽量不改：marked 扩展、renderer、DOMPurify、基础 Clipboard
  └─ 跟随修复：安全更新、微信兼容修复、基础语法

ours
  ├─ document-model       文档、版本、素材与平台无关结构
  ├─ theme-compiler       原创主题令牌、组件配方、主题版本
  ├─ compatibility        自研规则 + 官方 checker 适配
  ├─ publish-contract     inspect/preview/draft/publish 契约
  ├─ wechat-extension     MP JS API 写入、读取与差异检测
  └─ server               凭证、图片、草稿、审计、任务状态
```

主题预览可以使用作用域 CSS 和 CSS 变量提高编辑体验；**导出时必须编译成确定值并内联**，不能把预览 DOM 原样当作微信产物。

### 5.3 文档模型：微信 HTML 只是输出，不是主数据

建议保存：

- 原始 Markdown/源文件。
- 平台无关的结构化文档或 AST。
- 标题、作者、摘要、封面、原文链接等元数据。
- 图片素材及原始尺寸、格式、哈希、上传状态和目标 URL。
- `themeId + themeVersion + rendererVersion`。
- 每次生成的 HTML 快照、校验结果和微信读回快照。
- 草稿/发布任务及操作审计。

这样才能做到换主题不重写内容、同一内容分发多平台、定位微信改写前后的差异，以及历史版本可复现。

### 5.4 主题编译器：AI 受限，渲染确定

主题分三层：

1. **Design Tokens**：主色、正文色、辅助灰阶、字号尺度、行高、段距、圆角、边框、强调方式。
2. **Components**：标题、引言、目录、引用、提示卡、步骤、数据卡、表格、代码块、图片、署名等。
3. **Recipes**：教程、深度观点、产品测评、数据复盘、人物特稿等文章类型的组件组合规则。

AI 只能输出经过 schema 校验的文章类型、组件 ID 和有限令牌建议，不允许直接生成任意 JavaScript、外部 CSS、字体链接或不受控 HTML。最终 HTML 由确定性组件函数生成。

每个主题必须同时带有：

- 版本与素材许可证。
- 组件级预览和测试文章。
- 源头 lint。
- 浅色/暗色与窄屏样例。
- 官方 checker 结果。
- 真实微信读回结果。

### 5.5 发布前 readiness 契约

借鉴 md2wechat，但独立实现统一结构：

```json
{
  "target": "wechat-draft",
  "ready": false,
  "blockers": [
    { "code": "COVER_REQUIRED", "message": "图文草稿缺少永久封面素材" },
    { "code": "IMAGE_TOO_LARGE", "asset": "img-03", "message": "图片超过微信正文接口限制" }
  ],
  "warnings": [
    { "code": "DARK_MODE_GRADIENT", "node": "block-17" }
  ],
  "capabilities": {
    "clipboard": true,
    "mpEditorJsApi": true,
    "draftApi": true,
    "publishApi": false
  },
  "sideEffects": []
}
```

不同动作必须显式分离：

- `inspect`：只检查，无网络副作用。
- `preview`：只生成本地预览/HTML。
- `uploadAssets`：只上传明确选择的图片。
- `createDraft`：创建或更新草稿，记录 `media_id`。
- `publish`：独立权限、二次确认、审批与状态轮询。

### 5.6 图片管线

1. 读取图片真实 MIME、尺寸、大小和哈希，不只相信扩展名。
2. 远程抓取做 SSRF 防护：协议白名单、DNS/IP 检查、重定向复检、大小和超时限制。
3. 按目标接口压缩/转换；保留原图和处理后版本。
4. 正文图调用微信 `uploadimg`，封面走永久素材，替换 URL 后再创建草稿。
5. 为 `<img>` 写入原始宽度 `data-w`，并使用响应式宽度，降低窄屏溢出和官方检测误报。
6. GIF、SVG、透明底图、超大图单独进入兼容性检查；不支持时必须明确降级，不可静默变成空白或首帧。
7. 上传按“账号 + 图片哈希 + 处理参数”去重，失败可重试，任务可恢复。

### 5.7 复用边界

| 能力 | 直接复用 | 独立自研/只借鉴 |
|---|---|---|
| Markdown 编辑与基础渲染 | doocs 编辑器、marked 扩展、renderer | 平台统一 Document IR 与版本模型 |
| 安全与内联 | doocs 的 DOMPurify/juice 链路，持续跟踪安全更新 | 目标平台白名单、二次 sanitize、输出审计 |
| 主题 | doocs 的主题编辑入口可作基础 | 原创主题、组件配方、品牌资产、主题编译器 |
| 质量 | 官方 MIT checker、good/bad cases | 自研输入/输出 lint、缺失规则、微信读回 diff |
| 写入微信 | 官方 MP JS API、Clipboard API | 能力检测、降级、差异报告 |
| 图片/草稿 | 微信官方服务端 API | 素材处理、去重、凭证、任务、审计 |
| Agent | 无必须绑定的项目 | 自行实现 discovery/readiness，不复制 BUSL 资产 |
| 多平台 | 官方开放 API 优先 | 借 Wechatsync 适配器思想；GPL 代码另行评审 |
| AI 全流程 | 不采用洗稿或绕过检测能力 | 题材识别、受限排版建议、人工审核、事实与版权检查 |

---

## 6. 分阶段落地方案

> 时间仅是小型团队（约 1 名前端、1 名后端，设计/测试兼职）且已有可用测试公众号时的粗略规划，不是交付承诺。第一阶段先用真实文章验证，再决定功能扩张。

### 第 0 阶段：技术验证与许可证闸门（约 1 周）

- 跑通 doocs/md fork 与 upstream 同步机制。
- 准备 20～30 篇覆盖各类语法的测试语料。
- 跑通官方 `verify-article-structure` CLI 和 JSON 结果。
- 在真实公众号后台验证 Clipboard、MP JS API `set/get_content`。
- 验证正文图片、封面永久素材和新增草稿的最小服务端链路。
- 输出许可证/SBOM/主题资产清单，决定是否保持闭源。

**退出标准**：一篇包含标题、列表、表格、代码和多种图片的文章能写入测试草稿，读回后正文语义无丢失，所有差异都有报告。

### 第 1 阶段：可用 MVP（约 2～4 周）

- Markdown 编辑、实时预览、自动保存、版本恢复。
- 标题、列表、引用、代码、表格、链接、图片等 P0 语法。
- 4～6 套原创主题、12～20 个高复用组件，而非追求数百模板。
- 手机宽度预览、基础 Dark Mode 检查。
- 图片上传与基础压缩。
- 富文本复制、HTML 导出。
- 自研 lint + 官方 checker + 发布前元数据检查。

**明确不做**：模板市场、复杂 SVG 互动编辑器、全自动多账号发布、几十种图床、全平台分发、无约束 AI 自动排版。

### 第 2 阶段：商业闭环（约 3～5 周）

- 微信账号与凭证服务端管理。
- 正文图片转存、封面裁剪、创建/更新草稿、读回核验。
- Chrome/Edge 扩展接入官方 MP JS API，Clipboard 降级。
- 品牌工具包、主题版本、组件配方。
- AI 题材识别和受限排版建议。
- 多账号权限、操作审计、失败重试和任务恢复。

### 第 3 阶段：差异化扩展（持续迭代）

- DOCX/PDF/授权网页导入与历史文章迁移。
- 知乎、掘金、CSDN、头条等平台适配器。
- 团队评论、审核流、品牌权限和协作。
- 主题市场、企业私有主题、组件 SDK。
- 经过专项验证的 SVG 互动模板，而非开放任意 SVG/脚本。
- 数据回收：复制成功率、草稿失败原因、微信读回差异、主题使用与人工修改率。

---

## 7. 质量与验收体系

### 7.1 测试语料

至少覆盖：

- 中文长文、中英混排、全半角标点、极长单词和 URL。
- 多级标题、嵌套列表、任务列表、脚注和参考文献。
- 行内代码、超长代码块、多语言高亮。
- 宽表格、合并单元格输入、空表格、超长单元格。
- 本地/远程 JPG、PNG、GIF、SVG、透明图、超大图、失败图、重复图。
- KaTeX、Mermaid、PlantUML 及渲染失败降级。
- 原始 HTML、XSS 载荷、`javascript:` URL、危险 CSS 和外部字体。
- 空文档、超长文档、图片为主文档、多图文元数据缺失。

### 7.2 五层质量门

| 层级 | 检查 | 通过标准 |
|---|---|---|
| L1 输入安全 | HTML/URL/CSS 清洗，文件类型与大小 | 无脚本、危险 URL、未声明原始 HTML；危险输入有明确错误 |
| L2 确定性输出 | AST/文本快照、主题快照、静态 lint | 相同输入与版本得到相同输出；正文规范化文本无意外缺失 |
| L3 官方规则 | `verify-article-structure` + 自补规则 | P0 错误为零；官方未覆盖项由自研规则补齐 |
| L4 微信实际接收 | Clipboard/MP 写入后 `get_content` 读回 | 无未解释的标签删除、样式丢失、正文丢失或图片缺失 |
| L5 阅读端 | iOS/Android、窄屏、浅色/暗色、不同字号 | 无遮挡、溢出、叠字、不可读对比度；降级样式可接受 |

### 7.3 建议硬指标

- 正文规范化文本保真率 **100%**；任何主动转换都必须进入变更清单。
- P0 安全与结构错误 **0**。
- 正文图片处理成功率 **100% 或明确阻断**，不允许静默保留将被过滤的外链。
- 标题、作者、摘要、封面、正文长度在创建草稿前全部通过检查。
- 所有主题版本都有 golden files、官方 checker 结果和真实微信读回记录。
- 默认动作只到草稿，未经独立确认不得调用发布。
- 性能 SLO 在 POC 用真实长文测出基线后确定，不在没有数据时承诺“秒开”。

---

## 8. 安全、合规与维护风险

| 风险 | 对策 |
|---|---|
| GPL/AGPL/BUSL/NOTICE 或素材授权不清 | 建 SBOM、许可证闸门和资产台账；闭源默认不复制受限代码、主题、Prompt、图片与字体 |
| doocs 上游变化与 fork 分叉 | 少改内核、扩展包隔离、定期合并 upstream、核心 golden tests |
| 微信规则/API 变化 | 锁定 checker 版本并订阅上游；保留 Clipboard/JS API/服务端多路径；定期真实账号回归 |
| AppSecret、Token、Cookie 泄露 | 服务端密钥管理/KMS、最小权限、日志脱敏；多租户优先微信第三方平台授权，不在浏览器保存长期 Secret |
| 远程图片 SSRF 与恶意文件 | 网络出口限制、IP/DNS/重定向检查、MIME sniffing、大小/像素/超时限制、隔离转码 |
| AI 主题漂移或生成危险 HTML | JSON schema、允许令牌和组件白名单、确定性渲染、输出 sanitize 与 lint |
| 多平台适配器频繁失效 | 官方 API 优先、能力检测、平台契约测试、草稿优先、单平台失败不阻塞其他平台 |
| 内容版权和平台合规 | 仅导入自有/授权内容；不建设洗稿、绕过检测、未经授权采集能力；保留人工审核 |
| “发布”误操作 | 草稿/发布/群发分离，RBAC、二次确认、审批、幂等键和完整审计 |

---

## 9. 在线商业工具对照与差异化机会

### 9.1 官网功能对照

> 以下仅写调研当日能从官网或官方帮助页核验的能力；“未核验”不代表产品没有。部分站点是 SPA，公开页面只能看到入口或静态说明，因此未做登录后功能推断。

| 产品 | 官网核验的主要路径与强项 | 已见限制/注意点 | 对我们的启示 |
|---|---|---|---|
| [135 编辑器](https://www.135editor.com/) | 精细富文本与 AI 排版；模板/样式/版权图库；独立 SVG 编辑器；AI 文/图；云草稿、历史版本、导入、同步/定时、多平台；企业团队共享 | 实时协同、审批流未核验 | 商业产品的完整度不只在排版，还在素材、图片、团队与运营链路 |
| [秀米](https://xiumi.us/studio/v5) | 可视化布局，图文/H5/设计/文档；团队共享内容、配色、图库、样刊和权限；手机修改与同步；插件、MCP | 手机不能像电脑自由布局；两人同时编辑同一团队内容可能保存冲突；外部图片需转存 | 可视布局是优势，但协作必须做冲突防护；图片转存是发布刚需 |
| [壹伴](https://yiban.io/) | Chromium 插件直接增强公众号后台；一键/AI/Markdown 排版；深色预览；标题与图文分析；采集、封面、长图、定时与数据运营；SVG 入口 | 不支持 Safari/Firefox 等；需持续适配公众号后台改版；多人协作和多平台分发未核验 | “嵌入用户原有工作流”价值很高；但扩展应做能力检测，不能成为唯一路径 |
| [96 编辑器](https://bj.96weixin.com/) | 富文本、一键排版/秒刷、Markdown/AI；素材、GIF、海报、SVG、图片工具；云草稿；企业角色权限；桌面端多平台多账号分发 | 官网不同页面的 AI 价格口径不一致，购买前需确认 | 可借鉴多文章、图片工具、企业子账号与渠道分发，但首期无需复制全部素材能力 |
| [i 排版](https://www.ipaiban.com/about) | 普通图文与 iPaiban Pro SVG 分立；SVG 组件/组合/模板、参数配置、二维码手机预览、授权同步或插件导入；另有 AI/数据产品 | Pro 仅支持 Chrome；一个账号同时一台设备；官方也要求最终在公众号后台和手机预览，部分效果不能预览 | SVG 应参数化、专项兼容并提供静态降级；真机预览不能省 |
| [mdnice/墨滴在线版](https://editor.mdnice.com/) | 主题/公开/收藏、代码主题、导出 Markdown/PDF、复制到公众号/知乎、本地历史、AI 助手、插件授权分发 | 公开价格、多人协作、SVG 互动未核验 | 当前线上产品仍持续演进，不能把 2023 年未 push 的旧开源仓等同于全部线上能力 |
| [Doocs 在线版](https://md.doocs.org/) | 极简 Markdown；标题/列表/代码/表格/TOC、LaTeX、Mermaid、PlantUML、Infographic、提示块、Ruby、横滑图片、外链转底部引用 | 多人协作、模板市场、直接发布未核验 | 足以证明“基础编辑+语法+主题+复制”已成熟，单纯复刻没有差异化 |

### 9.2 官网价格快照

价格仅用于了解商业模式，**不是长期采购报价**，活动、续费、登录态和企业合同均可能改变结果：

- 135：官方[个人服务页](https://www.135editor.com/charge-service.html)可见 7.8/20/62 元每月起的不同档位；[企业版](https://www.135editor.com/vip-company.html)可见 3390/5850/7600 元每年档位。
- 秀米：[官方会员说明](https://r.xiumius.cn/board/v6/CqiLZ/QQgdm)可见等级会员 10 元/30 天、模板会员 20 元/30 天，另有模板单购、米点和团队升级等。
- 96：[官方产品页](https://bj.96weixin.com/product)调研时显示个人皇冠 330 元/年、终身 499 元及企业终身档；[AI 工具页](https://bj.96weixin.com/ai/tool)存在“399 元终身”与“399 元/年”两种口径，应以结算页确认。
- 壹伴价格页需要登录；i 排版未获得可靠具体金额；mdnice 的公开价格页未核验成功，因此不写价格。

### 9.3 市场空白与我们的定位

**开源项目普遍强在**：Markdown、轻量、可自托管、主题自定义、复制导出。
**商业产品普遍强在**：模板素材、可视布局、SVG、图片工具、团队共享、定时与多平台运营。

我们可以占据的中间位置是：

1. **统一结构化文档中台**：同时支持 Markdown 与可视编辑，而不是把两种用户割裂成两个产品。
2. **品牌 Design Tokens**：企业一次定义品牌规范，所有文章和平台共享，而不是每篇重新秒刷模板。
3. **AI 可解释、可局部撤销**：标题/大纲/改写/摘要/排版建议均有 diff、撤销和版本，不整篇覆盖。
4. **可验证交付**：从“预览好看”升级为“微信实际接收后可读回、差异可说明、失败可重试”。
5. **团队协作但不制造冲突**：共享品牌资产、角色权限、评论、版本、审批和审计；实时光标可后置。
6. **发布对账**：渠道能力矩阵、图片转存、外链转换、回执、失败原因和重试，而不是只显示“已调用接口”。
7. **资产授权台账**：记录模板、图片、字体、Logo 的授权主体、范围、期限与凭证。

若首期就面向团队，应把基础共享、角色权限、评论和冲突检测提前到 MVP；多人实时光标、大型模板市场、完整 SVG 编辑器和几十平台直连仍可后置。若首发主打互动，先做 3～5 个高频参数化 SVG 组件，并提供真机预览和静态降级，不做无约束 SVG 生成。

---

## 10. 最终建议与需要拍板的事项

### 建议直接按以下默认值启动

1. **技术底座**：fork `doocs/md`，前端沿 Vue 3 生态，避免无收益地重写。
2. **主题策略**：完全原创，先少而精；主题和组件必须有版本与回归样例。
3. **质量策略**：官方 checker + 自研 lint + MP 读回，三层缺一不可。
4. **微信路径**：MVP 先做 Clipboard；随后服务端草稿和 MP JS API 扩展并行。
5. **AI 策略**：只做受限语义决策，不让模型直接控制任意 HTML/CSS。
6. **发布策略**：默认草稿，发布需独立确认；无权限账号自动降级。
7. **许可证策略**：主底座和官方 MIT checker 可进入评审；GPL/AGPL/BUSL/附加 NOTICE 项目默认只研究思想，不复制资产。

### 启动前需要产品负责人确认的四个选择

- 产品是否闭源；这直接决定 GPL/AGPL 项目的可用边界。
- 首期只服务技术/Markdown 用户，还是同时服务完全不懂 Markdown 的运营人员；后者需要额外规划块级所见即所得编辑。
- 首期只做到“复制/写入后台”，还是必须包含服务端创建草稿。
- 是单团队内部工具，还是多租户 SaaS；后者应尽早采用第三方平台授权、租户隔离和审计模型。

**不建议的启动方式**：同时 fork 多个老项目、复制数百套来历不明模板、让 AI 自由生成 HTML，再把“浏览器预览正常”当作“微信兼容完成”。
