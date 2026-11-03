# 交接：搜索并入模型类型 + 即梦 CLI 供应商（2026-11-03 第三轮）

本轮按用户指定范围落地两件事：**豆包搜索作为「搜索」类型的模型并入供应商体系**；**新增即梦（Dreamina）本机 CLI 供应商，仅接入其图片生成**。参考 free-creation 的策略，但明确不接：VIDU、seedance 等一切视频生成。

## 一、模型类型三分：text / image / search

- 契约：`ProviderModelKind = 'text' | 'image' | 'search'`（缺省视为 text）；模型卡片类型选择新增「搜索」档；每类各设一个默认（唯一索引随 kind 扩展）。
- 预设新增「豆包搜索」：`baseUrl https://open.feedcoopapi.com`（站点根自动补 `/search_api/web_search`，也接受完整端点）+ 一个 search 类型模型。
- **旧配置一次性迁移**（`migrateSearchServiceToProvider`）：旧 `search_services` 单例若配置过密钥，启动时自动创建 `doubao-search` 供应商（密钥密文、验证结论、启停状态随行），幂等；未配置过的库保持空白。旧表保留不读（备份兼容）。
- 素材搜索（`MaterialSearchService`）改从供应商解析：取第一个「启用 + 有密钥 + 有启用 search 模型」的供应商；素材页横幅用的 `getSearchService()` 摘要同样派生自该供应商。
- 「AI 服务」页的「素材搜索」独立标签页删除——搜索密钥与测试都在供应商表单里完成（保存前搜索端点探测：最小 web 搜索消耗 1 次额度，错误码映射用户可读文案）。
- `providers:test`（卡片测试按钮）回退链：对话 → 生图端点 → 搜索端点（无对话能力的供应商按挂载类型自动选通道）。

## 二、即梦本机 CLI 供应商（仅图片）

- 接入方式：`ProviderAccessMode = 'api' | 'dreamina-cli'`（`providers.access_mode` 列，缺省 api）。CLI 型供应商无 Base URL / API Key，表单自动切换为 CLI 面板：安装检测、剩余额度/会员等级、headless「登录即梦」（返回授权链接 + 设备码，应用自动开浏览器，每 2.5s 轮询登录态；应用全程不接触 token）。
- CLI 发现：`MOLIU_DREAMINA_PATH` 环境变量优先，其次 `~/bin/dreamina(.exe)`；未安装时给出安装指引（Git Bash `curl -s https://jimeng.jianying.com/cli | bash`）。
- 预设「即梦（本机 CLI）」一次带出 `5.0`（默认）与 `5.0Pro` 两个 image 模型。**白名单在适配器执行前强制**：其它型号（seedance 视频、VIDU、3.x/4.x 图片）直接拒绝并说明。
- 生图链路：`text2image` / `image2image`（参考图下载为本地临时文件后传路径）提交拿 `submit_id` → `query_result` 轮询（瞬时 `ret=1015` 继续等）→ 成功后立即下载 CDN 产物转 base64（URL 带过期签名）。比例映射到 8 档画幅；分辨率硬下限 2k，质量 high 以上升 4k。
- 防重复扣费：**提交只发一次**（CLI 无幂等键）；`query_result` 轮询失败可重试。任务超时 10 分钟；重启后续查暂不支持（明确报错引导到即梦 App）。
- 错误映射：未装 CLI / 未登录 / 需在即梦 Web 完成一次合规确认（`AigcComplianceConfirmationRequired`）均有专门提示。
- 生图下拉对 CLI 供应商放行（无密钥但有登录态），卡片上标注「本机 CLI」。

## 三、验证

- `npm run typecheck` 通过；`npm test` **375/375**（新增 `tests/dreamina-and-search.test.ts` 7 例：端点解析、search 探测与错误映射、旧搜索配置迁移幂等、白名单拒绝、CLI 路径解析、未安装提示；`search-service-state` 重写为供应商派生语义）。
- `npm run test:smokes` **16/16**（smoke-materials 改为直接建搜索供应商 + reload 刷新 bootstrap，持久化断言改查 `provider_secrets`；live 联调脚本同步改为供应商通道）。

## 四、已知限制

- 素材搜索目前取第一个启用的搜索供应商（多数用户只有一个）；多搜索供应商的选择器未做。
- 即梦任务提交后应用重启无法续查（CLI 支持按 submit_id 查，但任务句柄未持久化，可作后续项）。
- `即梦 5.0Pro` 的 1.5k 档未开放（统一按 2k/4k 两档，取质量-成本平衡）。

## 五、对接检查（同日第四轮）：每环节模型独立记忆

全链路核查所有 AI 调用点的模型来源后，发现唯一的"一个模型走到底"残留：**8 个文本环节共用一个全局「最后使用」键**（`moliu:default-model`）——在任何一个页面换模型，其它未绑定环节下次全部跟着变。修复：

- `useModelTarget` 在调用方未显式指定记忆键且带环节标识（promptKey）时，自动切换为该环节独立键 `moliu:stage-model:<环节>`；选择只写本环节键，回落链为「本环节记忆 → 旧全局键 → 供应商默认」，升级前的最后使用连续性保留。
- 评审页面级模型原本跟随全局键，改为独立键 `moliu:stage-model:review`（角色级绑定不受影响）。
- 优先级不变：「提示词」页的环节绑定 > 本环节上次选择 > 全局回落。

**各环节模型选择矩阵（检查后全部满足"可各用各的"）**：

| 环节 | 选择机制 | 记忆 |
|------|----------|------|
| 账号定位 / 热点筛选 / 选题 / 框架 / 写文章 / 配图方案 / 配图规划 | 提示词页可绑定默认厂商+模型；页面下拉当次可换 | 本环节独立键 |
| 改稿 / 配图提示词生成 | 同上（原本就有专用键） | 专用键 |
| 评审 | 每角色可单独绑定；页面级模型为无绑定角色的兜底 | 独立键 review |
| 配图页生图 / 智能配图生图 | 各自下拉任选生图模型（含即梦 CLI） | 各自独立键 |
| 素材搜索 | 第一个启用的「搜索」类型供应商 | 不适用（单一消费者） |
| 排版 / 发布 | 不调用模型 | 不适用 |

验证：typecheck 0 错误；单测 **376/376**（新增环节记忆键用例）；冒烟 **16/16**。
