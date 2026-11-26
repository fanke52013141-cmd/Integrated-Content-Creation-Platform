# Upstream Dependencies

本目录只通过 Git submodule 管理上游源码，不把上游工作区直接复制进主仓库。

## 锁定版本

| 目录 | 上游 | 锁定提交 | 本地补丁 |
|---|---|---|---|
| `upstream/doocs-md` | https://github.com/doocs/md | `80b43d495bf51ce5d70dcfb0d73443b306104e76` | `patches/doocs-md/0001-explicit-runtime-imports.patch` |
| `upstream/verify-article-structure-spec` | https://github.com/wechatjs/verify-article-structure-spec | `c04fb843fd678e5806bda9cae190e913224caa49` | 无 |

## doocs 兼容补丁

锁定版本在当前 Windows/Vite 环境中有三个运行时自动导入问题。补丁只做显式导入，不改变业务行为：

- `apps/web/src/App.vue`
- `apps/web/src/composables/useAccountSyncBootstrap.ts`
- `apps/web/src/composables/useDeepLinkImport.ts`

`scripts/setup-upstream.mjs` 会在干净上游工作区应用补丁；已打补丁的工作区会跳过，存在其他冲突时会中止而不是覆盖。

## 初始化

```powershell
git submodule update --init --recursive
node scripts/setup-upstream.mjs
pnpm --dir upstream/doocs-md install
```

官方 checker 的依赖安装与锁文件兼容说明见 `poc/quality/README.md`。
