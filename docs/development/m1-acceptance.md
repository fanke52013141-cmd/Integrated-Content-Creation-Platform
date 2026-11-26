# M1 开发地基验收报告

> 日期：2026-11-27（Asia/Shanghai）
> 结论：**M1 已完成，三套主题全部通过当前本地验收，进入 M2 编辑工作流整合。**

## 1. 已落地的工程能力

| 包 | 作用 | 验证 |
|---|---|---|
| `packages/document-model` | 源文、主题版本、素材与渲染快照、稳定 revision | 4 项测试通过 |
| `packages/wechat-theme` | JSON tokens、主题注册、确定性 CSS 编译、三套原创主题 | 11 项测试通过，dist 与编译结果逐字节一致 |
| `packages/wechat-quality` | 版本化兼容矩阵和独立 linter，补官方未覆盖规则 | 33 项测试通过，19 条规则 |
| `packages/wechat-publisher` | 幂等、可恢复、可并发去重的草稿交付状态机 | 23 项测试通过，覆盖各阶段故障恢复 |
| `poc/server` / `poc/scripts` | 真实渲染、素材检查、读回比较、任务符号与颜色转换 | 14 项测试通过 |
| `poc/mp-extension` | 官方 MP JSAPI 适配与人工安全边界 | 7 项后台测试通过；此前浏览器 mock 21/21 通过 |

当前完整自动化回归：**92 项全部通过**。此前 MP 浏览器 mock 另有 21 项通过。

## 2. 三主题真实验收

同一篇包含标题、列表、代码、表格、图片、链接和脚注的文章，分别经过：

1. doocs 真实 Chromium `processClipboardContent()`；
2. 自定义兼容 lint；
3. 发布前草稿检查；
4. 官方 `verify-article-structure@0.2.30`；
5. 桌面与手机宽度截图及图片加载检查。

| 主题 | HTML 字符数 | 官方 checker | 草稿就绪 | 自定义 lint | 图片加载 |
|---|---:|---|---|---|---|
| 编辑红 `editorial-red` | 18,378 | 通过，无违规 | 通过 | 通过 | 通过 |
| 翡翠笔记 `jade-notes` | 19,338 | 通过，无违规 | 通过 | 通过 | 通过 |
| 科技蓝 `tech-blue` | 18,723 | 通过，无违规 | 通过 | 通过 | 通过 |

**总结果：`allPassed=true`。**

证据：

- [主题验收画廊](../../poc/artifacts/themes/index.html)
- [主题结果汇总](../../poc/artifacts/themes/summary.json)
- [编辑红检查结果](../../poc/artifacts/themes/editorial-red/inspection.json)
- [翡翠笔记检查结果](../../poc/artifacts/themes/jade-notes/inspection.json)
- [科技蓝检查结果](../../poc/artifacts/themes/tech-blue/inspection.json)
- 各主题目录下的 `custom-lint.json`、`capture-manifest.json`、桌面和手机截图。

## 3. 在验收中实际修复的问题

- 第一版丰富主题让正文超过微信 2 万字符限制；改为覆盖相同语法但元素更精简的主题专用文章。
- 任务列表 `<input>` 被自定义质量策略阻断；渲染后转换为保留完成状态的静态 `☑/☐` 符号。
- doocs 默认样式中的 `color-mix()` 存在 WebView 兼容风险；常见 hex + transparent 形式现在确定编译为 `rgba()`。
- 官方结果输出路径、主题产物隔离、重复测试运行器和空白比较器均按真实失败完成修正。

这些修复没有通过放宽规则完成，最终仍保留草稿长度、图片地址、字体和现代 CSS 的降级报告。

## 4. 自动交付状态机已验证的能力

- 一次配置后只提交文档，不逐步调用素材/草稿接口。
- 文档、主题、账号和 renderer 共同形成稳定幂等键。
- 重复提交已完成任务时，零新增网络副作用。
- 每个阶段持久化，故障后从最后成功步骤恢复。
- 图片和封面上传结果先落库，再替换 HTML，避免恢复时重复上传。
- 草稿 add 结果不确定时优先对账，无法对账则停止，禁止盲目重复建稿。
- 相同 key 并发提交共享一次执行。
- Secret/token 不进入幂等键或持久化记录。
- 包内没有发布或群发入口。

## 5. 当前限制与下一步优先级

### 仍未验证

1. **本地素材真实 API**：`uploadimg`、thumb、draft update 仍需真实账号验收。
2. **三套主题的真实公众号读回**：已于后续迭代完成，全部通过；见 [三主题真实回归汇总](../../poc/artifacts/themes/live-summary.json) 和 [全量优化工程验收报告](final-acceptance.md)。
3. 真机 iOS/Android、Dark Mode、GIF、SVG、MathJax、Mermaid 和远程图片异常场景。
4. 账号授权过期、跨进程任务锁与生产持久化 store。

### 需要持续预算控制

- 翡翠笔记为 19,338 字符，距离 20,000 上限只有 662 字符。后续必须加入 **80% / 90% 大小预警**，并在编辑器中显示估算余量；长文需要拆分、精简组件或另找符合官方限制的处理方式。
- 自定义 `font-family` 和现代 CSS 仍属于降级项，主题验收不能表述为“所有 WebView 绝对兼容”。

### M2 第一优先级

1. 将主题选择、元数据、封面和任务状态接入编辑界面。
2. 接入真实账号的自动素材与草稿更新，复用 publisher 状态机。
3. 对三套主题执行真实 MP 写入与读回，形成版本化验收记录。
4. 加入字符预算预警、真实移动端回归与每日自动测试。
