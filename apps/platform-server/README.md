# Platform HTTP Server

无框架依赖的 Node HTTP 服务，统一编辑器、真实浏览器渲染和交付状态机。

## API

- `GET /api/health`：服务与账号能力，不返回 Secret。
- `GET /api/themes`：版本化主题列表。
- `POST /api/render`：输入 `{ markdown, themeId, metadata }`，返回真实渲染及质量结果。
- `POST /api/delivery`：提交文档，返回幂等交付记录。
- `GET /api/delivery/:key`：查询交付状态、错误和读回报告。
- `POST /api/workspace/comment`：团队评论能力（配置 workspace 后启用）。

通过依赖注入支持真实适配器和 mock，测试不需要账号或外部网络。静态文件默认回退到 `index.html`，路径穿越会被拒绝。
