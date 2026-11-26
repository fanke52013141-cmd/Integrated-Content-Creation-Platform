# 真实公众号写入与读回记录

> 本记录只包含脱敏技术结果，不包含 AppSecret、access_token、Cookie、账号名或页面 token。

## 执行信息

- 执行时间：2026-11-26 23:39（UTC+08:00）
- 验证路径：真实公众号后台 MP JSAPI（`window.__MP_Editor_JSAPI__.invoke`）
- 环境：独立 POC Chrome 用户配置，加载本项目 MV3 扩展
- 目标：用户明确确认的专用测试公众号、可丢弃图文草稿
- 写入方式：每次均由用户明确确认后执行一次 `set_content`，写入前重新读取并检查内容漂移
- 发布/群发：均未调用

## 写入前基线

- 原始输入：`poc/artifacts/article-fragment.html`
- 原始输入 SHA-256：`79651473ef32f043a843d438df3a568dfa10331e228c9d70fa3216ffcd2dadad`
- 原始输入：17,367 字符、18,271 UTF-8 字节、1 张图片
- 发布前检查：`ready=true`，blockers 为 0
- 官方 checker：`verify-article-structure@0.2.30`，退出码 0，`isValid=true`，`violations=[]`
- 真实 JSAPI 检测：`transport=official-invoke`、`isReady=true`、`isNew=true`、`contentSupported=true`
- 空白草稿首次备份：120 个字符
- 第二次写入前备份：19,938 个字符（第一次写入后的内容）

证据：`poc/artifacts/live-mp-detect.json`、`poc/artifacts/live-mp-backup.json`。

## 第一次真实写入：本地相对图片未通过

执行：用原始 `article-fragment.html` 替换空白测试草稿一次，并立即读回。

结果：

- JSAPI 调用和读回均成功。
- 初始空白归一比较出现 10 个空白字符差异；后续块级文本分析确认**非空白正文完全一致**。
- 编辑器元素由 146 个增至 330 个，属于需要继续分析的 DOM 重写，不能仅以元素数判断内容丢失。
- 图片数量保持 1 张，但相对路径 `assets/poc-diagram.png` 被移到 `data-src`，没有可加载的 `src`，因此**本地相对图片验证失败**。
- 这次结果证明：不能把“写入接口成功”当成“图片可用”，也不能宣称本地图片上传已经验证。

证据：`poc/artifacts/live-mp-result.json` 的首次执行记录及 `poc/artifacts/live-mp-analysis.json` 的分析过程。

## 第二次真实写入：微信托管图片通过

为单独验证编辑器中的图片保留行为，将图片替换为微信官方文档中的 `mmbiz.qpic.cn` 测试图，其他正文不变；重新备份后，经用户再次确认执行一次 `set_content`。

读回与浏览器实测：

| 检查项 | 结果 |
|---|---|
| 非空白正文 | **完全一致**，`nonWhitespaceEqual=true` |
| 块级可见文本 | 存在 2 个空白字符差异，位于脚注/段落重组处；无非空白内容缺失 |
| 图片数量 | 1 / 1 |
| 输入有效图片地址 | `src=https://mmbiz.qpic.cn/...` |
| 读回有效图片地址 | `data-src=https://mmbiz.qpic.cn/...` |
| 实际浏览器 `currentSrc` | 同一微信图片 URL |
| 图片加载 | `complete=true`、`naturalWidth=1080`、`naturalHeight=798` |
| 实际显示 | `visible=true`，约 561.99 × 415.25 |
| 发布/群发 | 未执行 |

综合判定：`passed=true`、`nonWhitespaceEqual=true`、`imagesValid=true`。

证据：

- `poc/artifacts/live-mp-result.json`
- `poc/artifacts/live-mp-analysis.json`
- `poc/artifacts/live-mp-image-status.json`
- `poc/artifacts/live-mp-article.png`

## 最终结论

**第 0 阶段真实 POC 通过（MP 编辑器写入/读回路径，使用微信托管测试图片）。**

已经真实验证：

1. doocs 最终微信 HTML 可由官方 MP JSAPI 写入当前新编辑器。
2. 写入前能够备份并检查内容漂移，写入后能够读回。
3. 标题、列表、代码、表格、链接尾注和脚注的非空白正文保持一致。
4. 微信托管图片能够保留并实际加载可见。
5. 未调用发布或群发。

明确未覆盖/不能宣称：

- **本地图片上传到微信素材接口尚未做真实账号验证**；第一次相对图片失败已如实记录。服务端 `uploadimg`、thumb、`draft/add/get` 目前只完成 mock 测试，后续有 API 条件时需单独验收。
- 真机 iOS/Android、Dark Mode、GIF、SVG、MathJax、Mermaid、远程图片失败和不同账号接口权限未覆盖。
- 官方 checker 仍有其 README 列出的未实现规则，不能把 `isValid=true` 解释为完整规范全部合规。

因此，阶段 0 的浏览器路径可以关闭；本地素材 API 和移动端兼容性应进入下一阶段，而不是补写为“已验证”。
