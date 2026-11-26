# Integrated Content Creation Platform

目标：在平台内完成编辑与品牌化排版，自动产出并同步为微信公众号可正常阅读的草稿；首次配置后，日常创作不再复制粘贴、手工传图或逐篇处理兼容问题。

## 当前状态

- **阶段 0 真实 POC 已通过**：doocs 渲染、官方结构校验、MP JSAPI 写入/读回、非空白正文一致、微信图片实际可见。
- **规划内工程已全部落地并通过验收**：编辑、主题、兼容、自动交付、持久化、团队基础、内容导入和多平台分发均已完成；全仓 206 项测试通过，三主题真实公众号读回通过。详见最终验收报告。

## 快速开始

```powershell
# 初始化上游子模块和本地兼容补丁，并安装依赖
pnpm dev:setup

# 官方 checker 的独立依赖安装见 poc/quality/README.md

# 启动一体化平台（真实 Chromium 渲染 + mock 草稿交付）
pnpm dev:platform
# http://127.0.0.1:8780

# 全仓测试与三主题验收
pnpm test
pnpm themes:render
```

发布备注见 [v0.1.0](docs/development/release-v0.1.0.md)。

## 文档导航

- [产品主目标与开发总纲](docs/development/master-plan.md)
- [持续开发迭代看板](docs/development/iteration-board.md)
- [M1 验收报告](docs/development/m1-acceptance.md)
- [全量优化工程验收报告](docs/development/final-acceptance.md)
- [三主题验收画廊](poc/artifacts/themes/index.html)
- [真实公众号 POC 验收](docs/poc/live-verification.md)
- [POC 复现说明](docs/poc/README.md)
- [POC 依赖与许可证](docs/poc/SBOM.md)

## 核心工程边界

- 源文档与主题版本是主数据，微信 HTML 只是输出。
- 主题和组件必须确定、可测试、可回退，不允许无约束生成任意 HTML/CSS。
- 同步必须经过安全清洗、自定义 lint、官方 checker 和真实读回。
- 默认只到草稿；发布与群发是独立业务动作。
- 相同任务与素材必须幂等，重试不能造成重复副作用。
