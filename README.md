# 心流 Desktop

本地优先的自媒体 AI 创作桌面应用。支持账号定位、选题、框架、正文、评审、配图、排版、公众号草稿交付与复盘，也可以直接导入 Markdown 开始编辑。

本轮交接：[2026-10-22 账号固定版式、配图工作台与文章页优化](docs/HANDOFF-2026-10-22.md)，包含功能入口、关键代码、数据变更、验证记录、剩余工作及界面截图。

## 开发

```powershell
npm.cmd install
npm.cmd run dev
```

开发期直接跑源码，不维护安装包：双击仓库根目录的 `启动心流.bat`（数据写在默认 `%APPDATA%\moliu-desktop`），或用 `npm.cmd run dev` 进入热更新开发模式。改动代码后用 `npm.cmd run build` 重新构建 `out/` 再启动。`npm.cmd run package:win` 仅供正式分发时手动执行，不属于日常流程。

## 验证

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:workflow
npm.cmd run test:smokes
```

## 本地数据

- SQLite 数据库位于 Electron 的 `userData` 目录。
- API Key 通过 Electron `safeStorage` 加密后保存；Windows 下由 DPAPI 保护。
- Renderer 不直接访问网络、文件系统或 Node.js，只能调用白名单 IPC。

## 当前范围

- AI 服务配置、加密保存、连接测试与生图
- 选题/框架/文章/账号/热点/评审/配图方案/发布元数据支持「生成 / 手动 / 导入」入口：导入 JSON、Markdown、CSV、DOCX、HTML，保留外部来源并默认为草稿；选题可手动新建，热点可手动添加，评审可手动加问题
- 账号定位、热点、素材与内容框架
- 正文编辑、数据库草稿暂存、版本历史、命名、对比和恢复
- 多角色评审、配图、三种平台排版和本地导出
- 公众号交付预检、本地图片上传、完整交付快照、失败重试与结果待确认处理
- 数据与备份独立页面，数据库和图片完整性校验与失败自动回退
- 生成任务台账及结果定位，文章摘要分页查询

当前 AI 接口使用 OpenAI-compatible 协议。公众号推送进入草稿箱，正式发布仍在公众号后台完成。

0.2.0 优化的具体行为、验证与限制见 [优化说明](docs/workflow-optimization.md)。本次按新版本数据结构实现，没有提供旧项目迁移工具。

外部导入 Phase 1（选题/框架/文章）、Phase 2（账号/热点/评审/配图/发布元数据）、Phase 3（排版 HTML、提示词、冲突/映射、来源徽标）的实现、验证与限制见 [Phase 1](PHASE1-交付说明-2026-10-17.md)、[Phase 2](PHASE2-交付说明-2026-10-17.md)、[Phase 3](PHASE3-交付说明-2026-10-18.md)。

2026-10-18 供应商接入（ToAPIs 生图 / 豆包文本 / 豆包搜索）的范围、配置、实测数据与已知限制见 [交付说明](交付说明-供应商接入-2026-10-18.md)，完整方案见 [优化方案](优化方案-供应商联调-2026-10-18.md)。

真实供应商联调通过 `test:live` 执行，Key 只允许从
`MOLIU_LIVE_API_KEY` 环境变量注入，禁止写入脚本或提交到仓库。
