# ADR 0004：内置 DailyHotApi 热点服务

- 状态：Accepted
- 日期：2026-07-28
- 对应需求：`PRD-热点模块.md` 4.1

## 决策

墨流随 Windows 安装包分发 `dailyhot-api@2.0.8`，不要求用户安装 Docker。

Electron 主进程负责其生命周期：

- 应用启动时加载内置服务；
- 仅监听 `127.0.0.1`；
- 使用系统分配的随机端口，避免与用户服务冲突；
- 渲染进程不直接访问本地端口，统一通过受控 IPC 调用；
- 单个平台失败只返回该平台错误态；
- 退出应用时关闭监听服务；
- 数据页面始终显示 `DailyHotApi v2.0.8` 与“草稿数据源/自行核实”警告。
- DailyHotApi 只随墨流正式版本升级；不提供独立更新按钮，也不在启动时自动更新。

## 可复现性与安全修补

- DailyHotApi：npm `2.0.8`
- 上游 Git 标签：`v2.0.8`
- 标签提交：`755d4e22c1ced90d470171658ea546ba37518e98`
- npm 完整性：`sha512-yTWwxHp8PgBEDsYgoyWWfDpKT6lfIEj4MF7OisUSF1Kg2D+k6jMdPAafsQJ9h4DC41/J+XR/zgNuaRwOB2kU/A==`
- `@hono/node-server`：安全覆盖为 `2.0.12`

DailyHotApi 2.0.8 原始依赖范围会解析到存在 Windows 路径穿越问题的服务器适配器。墨流固定覆盖到 2.0.12，并通过生产依赖审计后才打包。

## 许可

DailyHotApi 使用 MIT License。安装包必须保留其版权和许可文本，见根目录 `THIRD_PARTY_NOTICES.md`。

## 后果

- 用户无需 Docker 或额外部署；
- 安装包体积与运行期依赖增加；
- 上游注明 Node 包模式下少数依赖 Puppeteer 的接口不可用，这些平台显示独立错误态；
- 热榜属于第三方公开渠道草稿数据，用户必须打开来源链接核实；
- 后续升级必须单独评估并记录具体版本，不跟随 `latest`。
- 每次升级须随墨流安装包完成接口回归、安全审计与回滚验证后发布。
