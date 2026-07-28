# 墨流 Desktop

本地优先的自媒体 AI 创作桌面应用。当前首期范围是“模型网关 + 账号定位 AI”纵向切片。

## 开发

```powershell
npm.cmd install
npm.cmd run dev
```

## 验证

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

## 本地数据

- SQLite 数据库位于 Electron 的 `userData` 目录。
- API Key 通过 Electron `safeStorage` 加密后保存；Windows 下由 DPAPI 保护。
- Renderer 不直接访问网络、文件系统或 Node.js，只能调用白名单 IPC。

## 当前范围

- OpenAI-compatible Provider 配置、加密保存和连接测试
- 账号定位七问向导
- AI 结构化生成八个默认字段
- 草稿、锁定、版本历史及版本恢复
- 下游引用固定账号版本；引用草稿时保留状态快照供 UI 警告

原生 Claude/Gemini、图像模型和后续创作模块不在当前版本范围内。

真实供应商联调通过 `test:live` 执行，Key 只允许从
`MOLIU_LIVE_API_KEY` 环境变量注入，禁止写入脚本或提交到仓库。
