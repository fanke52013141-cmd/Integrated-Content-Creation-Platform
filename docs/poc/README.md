# 第 0 阶段：真实公众号 POC 执行说明

## 当前结论

**第 0 阶段真实 POC 已完成并通过：MP 编辑器写入/读回路径已验证，非空白正文一致，微信托管测试图片实际可见。**首次本地相对图片失败已保留记录；本地素材上传 API 与真机/Dark Mode 等未覆盖项没有被写成“已验证”。详见 [真实写入与读回记录](live-verification.md)。

| 项目 | 结果 | 证据 |
|---|---|---|
| doocs 上游锁定 | `80b43d495bf51ce5d70dcfb0d73443b306104e76` | `upstream/doocs-md` |
| 官方校验器锁定 | `c04fb843fd678e5806bda9cae190e913224caa49`，CLI `0.2.30` | `upstream/verify-article-structure-spec` |
| 真实 Chromium 渲染 | 通过；调用 doocs `processClipboardContent()`，异步内容无残留 | `poc/artifacts/render-manifest.json` |
| 微信 HTML | 17,367 字符、18,271 UTF-8 字节、1 张正文图 | `poc/artifacts/article-fragment.html` |
| 发布前检查 | `ready=true`，blockers 为 0 | `poc/artifacts/inspect-report.json` |
| 官方 probe / fixtures | probe=0；违规 fixture=1（预期）；clean fixture=0 | `poc/quality/results/official-summary.json` |
| 主文章官方结构校验 | 退出码 0，`isValid=true`，`violations=[]` | `poc/quality/results/main-article.json` |
| 离线 mock 草稿 | 读回文本 1075/1075 相同，146/146 元素、1/1 图片 | `poc/artifacts/mock-draft-result.json` |
| 服务端与图片测试 | 8/8 通过 | `pnpm poc:test` |
| MP 扩展 mock | Chrome 13/13、service worker 7/7 | `poc/mp-extension/README.md` |
| doocs Web 类型检查 | 通过 | `pnpm --filter @md/web type-check` |
| 真实公众号写入/读回 | **通过（MP 路径，微信托管测试图）**；非空白正文一致、图片实际可见；本地素材 API 未验证 | `docs/poc/live-verification.md` |

> 官方 checker 通过只表示当前已实现规则通过。其 README 明确说明尚未覆盖字体、`span[leaf]`、`section[nodeleaf]` 和 `redundant-node` 全部规则；不能把结果表述为“完整规范全部合规”。

## 目录

- `poc/fixtures/wechat-poc.md`：含嵌套列表、长代码、五列表格、本地图片、外链和脚注的测试文章。
- `poc/scripts/render.mjs`：真实 Chromium 中调用 doocs 最终复制出口，不依赖 Node MathJax 桩。
- `poc/quality/`：官方校验器包装、原始 stdout/stderr、退出码和未覆盖规则。
- `poc/server/`：发布前检查、图片/封面、草稿创建与读回；没有发布或群发入口。
- `poc/mp-extension/`：人工确认、写入前备份、MP JSAPI 写入与读回。
- `poc/artifacts/`：可再生成的 HTML、清单和 mock 结果；真实账号结果不应提交公开仓库。

## 复现

```powershell
# 1. 启动 doocs 开发服务（另一个终端保持运行）
Set-Location upstream/doocs-md
pnpm install
pnpm web dev --host 127.0.0.1 --port 5173

# 2. 回到项目根目录，生成测试图和微信 HTML
Set-Location 'D:\Program Files (x86)\Integrated-Content-Creation-Platform'
python poc/scripts/create-fixtures.py
pnpm poc:render

# 3. 发布前检查与官方结构校验
pnpm poc:inspect
$env:PUPPETEER_EXECUTABLE_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
pnpm poc:check

# 4. 离线 mock 草稿、服务端测试与 MP 消息链测试
pnpm poc:mock-draft
pnpm poc:test
pnpm poc:mp:test
```

## 真实公众号路径 A：已登录浏览器 + MP 扩展

不需要 AppSecret。使用专用测试公众号和**可丢弃的空白测试草稿**：

1. 在 Chrome/Edge 的扩展页加载 `poc/mp-extension`。
2. 打开测试公众号的新图文草稿，点击扩展。
3. 先“检测 JSAPI”，再“读取并备份”。
4. 用文本编辑器打开 `poc/artifacts/article-fragment.html`，将其源码粘贴到扩展的 HTML 输入框。
5. 输入确认文字“写入”，执行一次 `set_content` 并读回。`set_content` 会替换全文，因此禁止在正式草稿中操作。
6. 保存扩展输出的文本/DOM 差异，并填写 `docs/poc/live-verification.md`。

扩展不会自动写入；每次都会先备份并检查备份后的内容漂移。若公众号当前 JSAPI 参数签名与 POC 假设不同，应先按实际返回值调整适配器，不能盲目重试。

## 真实公众号路径 B：服务端图片与草稿 API

1. 使用专用测试公众号，将 `poc/server/wechat.env.example` 复制为 `poc/.runtime/wechat.env`。
2. 只在该本地文件中填写测试 AppID/AppSecret，并配置公众号后台 IP 白名单。**不要把 Secret 发到聊天或提交到仓库。**
3. 确认 `pnpm poc:inspect` 和 `pnpm poc:check` 均通过。
4. 执行：

```powershell
$env:WECHAT_LIVE_CONFIRM = 'CREATE_DRAFT'
pnpm poc:draft -- --live
```

该命令会依次上传正文图片、上传 thumb 封面、调用 `draft/add`、调用 `draft/get` 并输出文本差异。结果保存在 `poc/artifacts/live-draft-result.json`。没有 `freepublish/submit` 或群发调用。

## 已知上游兼容补丁

锁定提交在当前 Windows/Vite 环境中存在自动导入运行时问题。POC 仅增加显式导入，不改变业务行为：

- `apps/web/src/App.vue`
- `apps/web/src/composables/useAccountSyncBootstrap.ts`
- `apps/web/src/composables/useDeepLinkImport.ts`

`vite.config.ts` 未保留改动；Web 类型检查与真实 Chromium 渲染均已通过。后续跟随 upstream 时应复查这些显式导入是否仍需要。

## 其他限制

- 正文 HTML 小于 2 万字符是本次实测到的硬约束；首次 24,545 字符和第二次 21,376 字符均被发布前检查阻断，最终通过版本为 17,367 字符。
- 正文图片按真实文件签名检查 JPG/PNG 且小于 1,000,000 字节；thumb 按 JPG 且不超过 64KiB 检查。
- 本次只验证单张本地 PNG。GIF、SVG、MathJax、Mermaid、远程图片失败、账号接口权限和移动端阅读效果仍需单独测试。
- 阶段 0 的“真实完成”必须以真实测试草稿读回报告为准，不能用 mock 或官方 checker 替代。
