# Integrated Content Editor Web

无运行时框架依赖的一体化编辑器前端，使用原生 ES Modules、CSS 和 Node 静态开发服务器。按现有 `/api` 契约工作，不创建假的后端成功结果。

## 已实现

- Markdown 源文编辑、本地安全轻量预览和服务端真实渲染结果切换。
- 科技蓝、编辑红、翡翠笔记三套主题及版本展示；预览 CSS 与稳定主题包逐字节同步。
- 标题、作者、摘要、封面 URL；封面加载失败只影响本地预览，不冒充已上传。
- 800ms 防抖自动保存、浏览器 localStorage 恢复、最多 20 份版本快照、显式版本恢复。
- 字符与 UTF-8 大小预算：HTML 20,000 字符 / 1,000,000 bytes，80% 提醒、90% 严重提醒、达到上限报错。
- 标题 32、作者 16、摘要 120 字符预算；品牌名称、识别色、默认署名与禁用词本地检查。
- 手机/桌面预览；sandbox iframe 禁止脚本。
- 真实草稿任务提交、key 保存、状态轮询、失败/未知状态、忙碌时最新文档排队。
- 团队评论按真实接口提交；审核功能因后端尚无接口而明确禁用。

## 运行

要求 Node.js 22.22.2+。

```powershell
cd apps/editor-web
npm run sync:themes
npm run dev
```

打开 <http://127.0.0.1:4173>。

**未配置后端时**，`/api` 明确返回 503 `BACKEND_NOT_CONNECTED`，页面保留本地编辑、预览、自动保存和版本能力。

连接现有平台服务（将端口替换为实际服务端口）：

```powershell
$env:API_ORIGIN = 'http://127.0.0.1:3000'
npm run dev
```

开发服务器只转发真实响应，不生成模拟成功。也可以直接把本目录作为 `platform-server` 的 `staticRoot`，无需前端代理。

## API 契约

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | renderer/delivery 状态、账号与 workspace 能力 |
| GET | `/api/themes` | 版本化主题元数据 |
| POST | `/api/render` | `{markdown,themeId,metadata}`；仅实际返回的 HTML/质量字段进入界面 |
| POST | `/api/delivery` | `{document,overrides}`，提交草稿交付任务 |
| GET | `/api/delivery/:key` | 查询真实记录、错误和读回结果 |
| POST | `/api/workspace/comment` | 提交 `{documentId,revision,body,author}` |

### 同步状态边界

- 默认不自动同步；只有存在服务端账号时才可开启。
- 开启或手动点击后，提交当前文档。自动模式下，仅新的本地保存会触发新任务。
- 提交成功不等于草稿完成；必须取得后端返回的 key，并以终态 `COMPLETED` 才显示完成。
- `FAILED`、接口异常和轮询超时均不显示成功。
- 忙碌时只保留最新待提交文档，避免逐键并发写入。
- 本前端没有发布或群发入口。

### 本地与后端能力分离

- 自动保存、版本历史和恢复是**当前浏览器本地能力**，不会描述为云端保存。
- 无 `/api/render` 时显示“本地轻量预览 · 未执行服务端渲染/微信校验”。本地渲染器只覆盖常用 Markdown，原始 HTML 会转义，不替代 doocs。
- 服务端 HTML 只进入无脚本权限的 sandbox iframe；质量区仅显示响应中实际存在的 `quality`、`inspection`、`lint`、`readback` 等字段。
- 团队评论必须获得 `/api/workspace/comment` 接收响应后才进入本次会话回执列表；它不是完整历史评论列表。
- 当前没有审核 API，因此不提供伪造的审核通过按钮。

## 测试与检查

```powershell
npm run check
npm test
npm run test:browser
```

测试覆盖：

- Markdown 常用语法、XSS 转义与危险链接；
- 预算阈值、中文字节和元数据；
- 自动保存、恢复、历史上限及存储失败；
- API 路径、payload、错误和超时；
- 交付完成/失败/未知状态及最新文档排队；
- 静态功能面、sandbox、三主题与稳定 dist 一致性；
- 独立服务器的静态页面和明确 503 后端状态。

`test:browser` 另外使用真实 Chromium 验证三主题、自动保存、版本生成、预览切换、离线提示和零 page error，并生成 `artifacts/editor-desktop.png`。该截图是运行证据，不等同于人工视觉或真实公众号验收。

`npm run sync:themes` 从 `packages/wechat-theme/dist` 读取稳定 CSS 并只写入本目录的 `assets/themes/`。它不会修改主题包。
