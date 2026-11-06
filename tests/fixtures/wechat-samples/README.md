# 微信真实产物样本库

把"优秀公众号文章的真实 HTML"作为量化基线（调研报告附二：wechat-article-exporter 可批量导出原文 HTML）。

## 如何补充真实样本

1. 用 [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter)（在线工具，登录后选择目标账号）
2. 导出目标文章的 **HTML** 格式
3. 原样放入本目录（命名建议：`<账号名>-<文章短名>.html`）
4. 运行 `node scripts/compare-samples.mjs` 生成结构特征报告，与 `tests/fixtures/layout-golden/`（我们产物基线）对比

## 现有样本

- `synthetic-realistic.html` — **手工构造的实战风格合成样本**（非真实导出）：按社区观察的
  135/秀米类工具产物特征构造（全 section/span、全内联样式、leaf 包裹、多层数字标号），
  用于让对比脚本可跑、可验证。补充真实样本后可删除。
