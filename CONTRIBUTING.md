# 贡献指南 / Contributing

感谢你对 AuraScholar 的兴趣!这是一个面向青年科研人员的开源科研助手。

## 开发环境

- Node.js ≥ 20,pnpm ≥ 9
- 桌面端是 Electron 应用(纯 JS/TS,无需 Rust)

```bash
pnpm install
pnpm build          # 构建所有包
pnpm test           # 运行所有测试

# 启动桌面应用
pnpm --filter @aurascholar/desktop rebuild:electron   # 把原生模块切到 Electron ABI
pnpm --filter @aurascholar/desktop dev
```

> **原生模块 ABI**:唯一的原生依赖 `better-sqlite3` 在 Node(测试)与
> Electron(应用)下需要不同的二进制 ABI,同一份产物不能两用。`pnpm install`
> 后默认是 Node ABI(`pnpm test` 可直接跑);跑应用前用 `rebuild:electron` 切换,
> 之后要再跑测试用 `pnpm rebuild better-sqlite3` 切回。报错
> `NODE_MODULE_VERSION xxx vs yyy` 即此 ABI 不匹配。打包时 electron-builder
> 自动为 Electron 重编,发布产物无此问题。

## 项目结构速览

| 包 | 职责 |
|---|---|
| `packages/tokens` | 双主题设计令牌(改样式先看这里) |
| `packages/db` | SQLite schema、迁移、Repository 层 |
| `packages/platform` | 平台能力抽象接口(HTTP/FS/通知/密钥/调度) |
| `packages/connectors` | Crossref / OpenAlex / Unpaywall / arXiv 客户端 |
| `packages/core` | 领域逻辑:入库管线、哨兵状态机、引文图谱 |
| `packages/reader` | PDF 阅读器与批注锚定引擎 |
| `packages/ai` | AIProvider 抽象 + BYOK 实现 |
| `packages/sync` | SyncProvider 抽象 + 同步引擎(HLC + LWW) |
| `packages/homepage` | 学术主页模板与渲染 |
| `apps/desktop` | Electron 桌面应用(`electron/` 主进程 + `src/` 渲染进程) |

架构铁律:

1. **领域逻辑只写在 packages,不写在 apps** — 三端(桌面/Web/移动)共享同一套 TS 代码,app 壳只做平台胶水层(Electron 主进程提供 SQLite / HTTP / FS / 通知,经 preload 的 `window.aura` 桥接给渲染进程)。
2. **`core`/`reader`/`sync`/`ai` 只依赖 `platform` 的接口**,不依赖任何具体实现;实现由 app 入口注入。
3. **批注锚定的文本空间是冻结接口**(`packages/reader/src/document.ts`),改动它必须升 anchor version 并跑回归语料。
4. 所有表的写操作走软删(`deleted_at`),同步引擎依赖墓碑。

## 提交规范

- 提交前确保 `pnpm build && pnpm test` 全绿。
- 新功能请附测试;修 bug 请附能复现该 bug 的测试。
- PR 描述写清楚"为什么",不只是"做了什么"。

## 报告问题

请使用 issue 模板。涉及具体 PDF 的批注/渲染问题,请尽量附上该 PDF 的 DOI 或开放获取链接(不要上传有版权的 PDF 文件)。

## License

贡献的代码按 [AGPL-3.0-only](./LICENSE) 授权。
