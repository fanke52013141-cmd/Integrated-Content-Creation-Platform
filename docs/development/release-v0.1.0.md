# v0.1.0 发布备注

## 发布主题

**一体化公众号内容编辑、品牌排版与可验证草稿交付。**

## 本次发布内容

- 编辑器：三套原创主题、移动/桌面预览、自动保存与 20 份本地版本。
- 渲染：真实 Chromium 复用服务，支持异步公式与图表。
- 质量：自定义 lint、官方 checker、草稿预算和真实读回比较。
- 交付：幂等、断点恢复、文件持久化、跨进程互斥与素材哈希缓存。
- 团队：品牌工具包、角色权限、评论审核、版本和审计。
- 内容：Markdown、真实 DOCX、授权 HTML 导入。
- 分发：WeChat、WordPress REST、Webhook 和明确 mock 的其他渠道。

## 验证摘要

- 206 项全仓测试通过。
- doocs 类型检查与生产构建通过。
- 一体化浏览器端到端完成，`quality.ready=true`、交付 `completed`。
- 三套主题真实公众号写入/读回全部通过，未发布或群发。
- 文件持久化重复提交无重复副作用。

## 初始化与复现

```powershell
git submodule update --init --recursive
node scripts/setup-upstream.mjs
pnpm install
pnpm --dir upstream/doocs-md install
# 官方 checker 的独立安装说明见 poc/quality/README.md

pnpm dev:platform
# 打开 http://127.0.0.1:8780
```

默认使用真实 Chromium 渲染与 mock 草稿交付，不调用真实账号网络。需要真实公众号时，使用专用测试账号配置适配器，再运行 `pnpm themes:live`。

## 上游与补丁

- `doocs/md`：子模块锁定 `80b43d495bf51ce5d70dcfb0d73443b306104e76`。
- `verify-article-structure-spec`：子模块锁定 `c04fb843fd678e5806bda9cae190e913224caa49`。
- doocs 的运行时显式导入兼容补丁单独保存在 `patches/doocs-md/`，由 `scripts/setup-upstream.mjs` 应用。

## 未实测边界

- 没有使用 AppSecret 实测本地素材 `uploadimg`、thumb 或真实 `draft/add/update`。
- 没有物理 iOS/Android 设备进行 Dark Mode 全量实测。
- WordPress、Webhook、知乎、掘金、CSDN、头条未执行真实发布。
- 生产 OAuth、KMS、租户隔离和团队持久化认证尚未启用。

完整结果与边界见 [全量优化工程验收报告](final-acceptance.md)。
