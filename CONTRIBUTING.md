# 贡献指南 / Contributing

感谢你对 AuraScholar 的兴趣!这是一个面向青年科研人员的开源科研助手。

## 开发环境

- Node.js ≥ 20,pnpm ≥ 9
- Rust 工具链(桌面端开发,[安装指南](https://www.rust-lang.org/tools/install))
- Tauri 2 前置依赖([按平台配置](https://v2.tauri.app/start/prerequisites/))

```bash
pnpm install
pnpm build          # 构建所有包
pnpm test           # 运行所有测试
cd apps/desktop && pnpm tauri dev   # 启动桌面应用
```

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
| `apps/desktop` | Tauri 2 桌面应用 |

架构铁律:

1. **领域逻辑只写在 packages,不写在 apps** — 三端(桌面/Web/移动)共享同一套 TS 代码,Rust 只做平台壳。
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
