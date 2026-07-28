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

| 包                    | 职责                                                    |
| --------------------- | ------------------------------------------------------- |
| `packages/tokens`     | 双主题设计令牌(改样式先看这里)                          |
| `packages/db`         | SQLite schema、迁移、Repository 层                      |
| `packages/platform`   | 平台能力抽象接口(HTTP/FS/通知/密钥/调度)                |
| `packages/connectors` | Crossref / OpenAlex / Unpaywall / arXiv 客户端          |
| `packages/core`       | 领域逻辑:入库管线、哨兵状态机、引文图谱                 |
| `packages/reader`     | PDF 阅读器与批注锚定引擎                                |
| `packages/ai`         | AIProvider 抽象 + BYOK 实现                             |
| `packages/sync`       | SyncProvider 抽象 + 同步引擎(HLC + LWW)                 |
| `packages/homepage`   | 学术主页模板与渲染                                      |
| `apps/desktop`        | Electron 桌面应用(`electron/` 主进程 + `src/` 渲染进程) |

架构铁律:

1. **领域逻辑只写在 packages,不写在 apps** — 三端(桌面/Web/移动)共享同一套 TS 代码,app 壳只做平台胶水层(Electron 主进程提供 SQLite / HTTP / FS / 通知,经 preload 的 `window.aura` 桥接给渲染进程)。
2. **`core`/`reader`/`sync`/`ai` 只依赖 `platform` 的接口**,不依赖任何具体实现;实现由 app 入口注入。
3. **批注锚定的文本空间是冻结接口**(`packages/reader/src/document.ts`),改动它必须升 anchor version 并跑回归语料。
4. 所有表的写操作走软删(`deleted_at`),同步引擎依赖墓碑。

## 工程架构健康

工程架构健康是功能开发的准入条件，而不是发布前集中清理的附加工作。仓库使用
`architecture-health-baseline.json` 记录当前债务，并通过 CI 执行“只降不升”的
棘轮检查。

```bash
pnpm health:report    # 查看规模、Hooks 警告和 UI 数据边界债务
pnpm health:ci        # 验证工作区与已提交基线一致
pnpm health:baseline  # 在确实降低债务后刷新确定性基线
pnpm health:test      # 运行护栏自身的回归测试
```

当前规则:

1. 新增生产 `.tsx` 文件不超过 400 行,`.ts` / `.css` 不超过 500 行;
   新增测试或 Smoke 场景文件不超过 800 行。
2. 已超过阈值的历史文件以目标分支行数为上限,只能持平或缩小;把巨型文件改名
   不能绕过新文件阈值。
3. `pages`、`components` 和非网关 `features` 代码不得新增运行时 Repository
   导入、`getLibraryDb` 调用、原始 SQL 或 Renderer DB bridge。类型专用导入不计入。
4. ESLint warning 按“文件 + 规则”建立预算;已有 warning 可以修复,不得新增或转移
   到其他文件。
5. 当前指标必须与提交的基线完全一致。修复债务后需运行 `pnpm health:baseline`;
   Pull Request 会从目标分支读取旧基线,并优先执行目标分支的检测器与 ESLint
   策略,拒绝同一 PR 通过弱化规则或向上改写基线来自我放行。

如果一个独立的架构策略 PR 需要修改 `eslint.config.mjs`,请使用目标分支策略重建
候选基线,例如
`node scripts/architecture-health.mjs baseline --base <target-commit-sha>`，确保本地
结果与 CI 使用的 policy 一致。

这些阈值用于阻止新的巨石代码,不能代替职责设计。不要为了通过行数检查机械拆文件,
也不要把页面逻辑整体搬进一个巨型 Hook。推荐的依赖方向是
`Page → feature controller → query/command gateway → pure view-model → View`。

每完成约 4 个功能 PR,应安排 1 个小型工程健康 PR。任何触碰历史超大文件的功能改动
至少必须做到不增加该文件的债务;架构策略或检测器调整应放在独立 PR 中说明原因。

## 提交规范

- 提交前确保 `pnpm health:ci && pnpm build && pnpm typecheck && pnpm lint && pnpm test`
  全绿。
- 新功能请附测试;修 bug 请附能复现该 bug 的测试。
- PR 描述写清楚"为什么",不只是"做了什么"。

### 分支命名

- 新功能分支使用 `feat/<short-description>`。
- 缺陷修复分支使用 `fix/<short-description>`。
- `<short-description>` 必须使用简短的英文 kebab-case,例如
  `feat/library-workspace-redesign` 或 `fix/pdf-render-overflow`。
- Pull Request 的源分支会由 CI 强制校验;不符合上述格式时无法通过检查。
  Dependabot 使用的托管分支不受此限制。

### Commit Message

提交信息遵循英文 Angular/Conventional Commits 格式:

```text
<type>(<scope>): <subject>
```

- `type` 使用 `feat`、`fix`、`docs`、`refactor`、`test`、`chore`、`build`、`ci`、
  `perf`、`style` 或 `revert`。
- `scope` 使用受影响的应用或包名,例如 `desktop`、`reader`、`db`;没有明确范围时可以省略。
- `subject` 使用英文、现在时祈使语气,首字母小写,末尾不加句号。
- 每个提交只表达一个明确目的;不把无关修改混入同一提交。

示例:

```text
feat(desktop): refine library import workflow
fix(reader): prevent annotation panel overflow
docs: clarify contribution workflow
```

## 报告问题

请使用 issue 模板。涉及具体 PDF 的批注/渲染问题,请尽量附上该 PDF 的 DOI 或开放获取链接(不要上传有版权的 PDF 文件)。

## License

贡献的代码按 [AGPL-3.0-only](./LICENSE) 授权。
