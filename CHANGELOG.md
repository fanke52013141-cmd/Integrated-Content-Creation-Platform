# Changelog

本项目按里程碑记录重要变化。

## [0.1.0] - 2026-11-27

### 新增

- 一体化 Markdown 编辑器、三套原创主题、桌面/手机预览和本地版本历史。
- 可复用真实 Chromium 渲染服务，支持 MathJax、Mermaid 和异步内容。
- 微信兼容质量矩阵、19 条自定义规则、官方结构校验和字符预算。
- 幂等草稿状态机、素材缓存、草稿对账、断点恢复及文件快照。
- 跨进程互斥锁、敏感字段拒绝落库和结构化错误报告。
- 团队品牌工具包、角色权限、评论审核、版本与审计。
- Markdown、真实 DOCX、授权 HTML 导入。
- WeChat、WordPress REST、Webhook 及其他渠道明确 mock 的分发适配器。
- `health/themes/render/delivery/import/distribution/workspace comment` 一体化 API。

### 验证

- 全仓 206 项测试全部通过。
- doocs 类型检查与生产构建通过。
- 一体化浏览器端到端完成，页面无脚本错误。
- 三套主题真实公众号写入/读回均通过，非空白正文一致、微信图片实际可见。
- 重复提交零新增副作用；微信分发返回 `draft` 和 `comparisonOk=true`。

### 安全与边界

- 默认只到草稿，不包含发布或群发入口。
- 默认使用 mock 交付，不把模拟回执显示为真实发布。
- 本地素材真实 API、物理 iOS/Android、生产 OAuth/KMS 和第三方平台实测未冒充完成；详见 `docs/development/final-acceptance.md`。
