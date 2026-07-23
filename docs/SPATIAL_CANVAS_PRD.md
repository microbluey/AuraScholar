# AuraScholar 空间白板：产品与架构说明

> 状态：已实现。本说明以当前代码为准，描述产品边界、数据模型与扩展方式，不是代码生成 Prompt。

## 1. 产品定位

空间白板（Spatial Canvas）把文献库中的论文、摘录、研究者想法和 AI 合成结果放入同一张可缩放、可平移的点阵画布。它服务于学术研究中的材料整理、观点关联、方法比较和研究问题形成，而不是知识点背诵。

核心产品决策：

- **完整文献可以直接成为节点。** 论文不需要先产生划线或摘录；研究者可在初筛阶段先把文献放入画布，再阅读、分组和连线。
- **一个白板对应一个独立研究上下文。** 用户可为不同项目新建多个白板，每个白板拥有自己的视口、节点和关系；`GroupNode` 只用于单个白板内部的局部组织。
- **不提供闪卡复习 UI。** 闪卡与 FSRS 更偏向记忆训练，不是空间白板的研究工作流。主导航只提供“空间白板”，旧 `/flashcards` 路由会重定向到 `/canvas`。
- **卡片是可扩展的领域对象。** 当前提供五种内置节点类型；扩展点是 TypeScript 类型映射，而不是运行时插件系统。
- **AI 只合成明确选择的材料。** 输出保留来源节点，并显式说明分析范围，避免把题录或摘要误表述为全文审读。

## 2. 当前用户体验

画布基于 `@xyflow/react` 实现，提供无限点阵背景、缩放和平移、框选与多选、节点拖动、关系连线、可折叠逻辑分组、MiniMap、左侧文献面板、底部 Dock 和右侧检查器。打开文献或摘录时，检查器让位给与 React Flow 视口并列的右侧阅读器；桌面端默认约按白板 60%、阅读器 40% 分屏，分隔条可拖动或用键盘调整。阅读器不是画布变换层的子元素，因此缩放和平移白板不会缩放阅读器。画布顶部显示当前白板名称，并提供新建与切换；列表项 hover/focus 后出现 `...` 菜单，可就地重命名或安全删除。折叠分组只隐藏组内卡片与内部连线，不会删除内容；连接组内卡片与外部节点的关系会代理到折叠后的组头。

主要流程如下：

1. 主导航进入 `/canvas` 时，页面会以 `replace` 方式转到最近使用的 `/canvas/:workspaceId`；直接访问具名路由可打开对应白板。
2. 在画布顶部切换器中新建或切换白板；每个列表项的 `...` 菜单提供重命名和删除。删除前弹窗会显示白板名称与卡片数；只剩一个白板时不展示删除操作。删除当前白板后，路由以 `replace` 方式转到剩余列表第一项。
3. 从文献库或 PDF 阅读器加入整篇文献或批注时，如果只有一个白板则直接加入；如果有多个白板，则打开轻量目标选择器，默认选中最近活跃白板，支持回车确认或就地“新建并加入”。
4. 在画布左侧面板点击/拖入任意文献，可在当前白板创建 `PaperNode`。
5. 双击文献卡会在白板右侧打开同屏阅读器；双击摘录卡会按 `attachmentId`、`annotationId` 和 `pageIndex` 在同一分屏中定位具体附件、批注与页码。阅读器标题栏仍提供进入完整阅读器的回退入口。
6. 在右侧阅读器中选择文本并保存高亮后，底部会出现可拖动的摘录条。把它拖到左侧白板的目标位置，或点击「加入当前白板」，会创建一个保留完整批注锚点的 `ExcerptNode`，并从来源 `PaperNode` 自动建立 `derived-from` 边。重复加入同一批注会聚焦已有摘录，并在缺失时补齐来源边，而不是复制卡片。
7. 选择多张卡片后可建立关系、放入分组，或从文献/摘录生成 AI 合成卡。
8. 新建 Idea Note，在画布中记录 Markdown 与 LaTeX 研究笔记。
9. 删除画布卡片只删除当前白板中的摆放及其关系，不会删除原文献或原批注。

## 3. 节点与关系模型

核心类型位于 `packages/core/src/canvas/types.ts`。持久化文档使用 `CANVAS_SCHEMA_VERSION = 1`，包含工作区信息、视口、节点和边；选中、聚焦等界面状态不持久化。

### 3.1 五种内置节点

| 类型标识    | 产品名称     | 关键数据与用途                                                                                                            |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `paper`     | PaperNode    | `workId`、题名、作者、年份、来源、DOI、摘要片段等。允许没有任何摘录的完整文献独立存在。节点 ID 与文献 `workId` 始终分离。 |
| `excerpt`   | ExcerptNode  | `workId`、高亮原文、颜色、零基页码，以及可选的 `annotationId`、`attachmentId`、锚点和边注；用于精确回到阅读器。           |
| `ai-synth`  | AISynthNode  | 来源节点 ID、合成模式、Markdown 结论、可选结构化表格和模型名；用于方法比较、分歧分析、研究空白与简明综述。                |
| `idea-note` | IdeaNoteNode | 可选标题、Markdown 正文和公式标记；表达研究者自己的想法、假设与待验证问题。                                               |
| `group`     | GroupNode    | 分组标题、可选色彩主题与可持久化的 `collapsed` 状态；作为画布内可折叠的逻辑容器。                                         |

所有节点共享以下基础字段：独立节点 ID、类型、位置、尺寸、可选 `groupId`、标签、毫秒时间戳和类型专属 `data`。

### 3.2 关系边

`CanvasEdge` 连接两个同工作区节点，支持：

- `cites`：引用
- `supports`：支持
- `contradicts`：反驳或矛盾
- `extends`：扩展
- `derived-from`：派生来源，AI 合成自动使用
- `custom`：自定义关系

边可带标签及颜色/动画样式，并与节点一起持久化。

### 3.3 扩展边界

`CanvasNodeDataByType` 是当前的类型扩展缝：新增节点种类时可通过 TypeScript interface augmentation 扩充节点类型映射。它能让领域类型保持严格的判别联合，但**不是运行时动态注册表或插件市场**。

真正增加一种可落库、可展示的新节点，仍需要同步修改：

1. Core 的数据类型与包导出；
2. 数据库迁移中的类型约束和 `CanvasRepo` 支持列表；
3. Desktop 持久化 payload 校验；
4. React Flow 的节点 renderer、卡片组件和检查器；
5. JSON 备份引用重映射（若新 payload 含外键或节点 ID）。

因此，当前架构降低了扩展成本并保持类型安全，但尚未实现“无需改代码即可安装卡片类型”。

## 4. AI 合成

AI 合成实现于 `packages/ai/src/canvas-synthesis.ts` 与桌面服务 `apps/desktop/src/services/canvas-ai.ts`。

### 输入范围

- 只接受 `paper` 和 `excerpt` 节点；每次至少 2 个、最多 10 个来源。
- 文献卡提供题录与当前可用的摘要；摘录卡提供用户明确选择的原文和边注。
- 文献卡输入不等同于 PDF 全文。输出会附加范围说明：“基于题录与可用摘要/所选原文，不是全文审读”。
- 单个来源文本有长度上限，且提示词要求只使用给定材料、保留不确定性、不得编造发现、引文、指标或因果关系。

### 输出模式

- `methodology_matrix`：方法论对比，必须返回结构化表格；
- `contradiction_analysis`：支持、限定与矛盾关系分析；
- `research_gap`：研究空白、缺失证据与后续问题；
- `tldr`：共同主线、独特贡献与关键限制的简明综述。

输出经过 Zod 结构校验，并要求在 Markdown 中使用 `[S1]` 等来源标记。成功后一次性写入完成态 `AISynthNode`，同时为每个来源创建指向该节点的 `derived-from` 边；生成失败时不会留下永久的“生成中”占位卡。

合成请求启动时会捕获来源白板 ID；请求返回后只在当前文档仍属于该白板时写入新节点。因此，生成期间切换白板不会把旧请求的结果写入新白板。

`sourceNodeIds` 和来源边共同提供画布内溯源。它们表达的是“此结果由哪些当前节点生成”，不是对外部学术引用真实性的替代验证。

## 5. 持久化架构

### 5.1 SQLite

数据库迁移 v16 以增量方式新增三张表：

- `canvas_workspaces`：名称、说明、schema 版本、视口与时间戳；
- `canvas_nodes`：工作区、可选文献外键、类型、位置、尺寸、分组、排序、标签和类型 payload；
- `canvas_edges`：工作区、端点、关系、标签、样式、排序和时间戳。

当前 UI 可列出并切换多个工作区，新建、重命名和删除通过 `CanvasRepo` 的独立工作区操作完成。删除工作区会在同一事务中只移除对应 `canvas_edges`、`canvas_nodes` 和 `canvas_workspaces`，最后一个工作区在触碰任何数据前即被拒绝；它不会删除 `works`、`attachments`、批注或 PDF blob。从旧版升级时，既有 `canvas:default` 会被原样保留为第一个可见白板，其节点、关系和视口不需要迁移，并可在切换器中管理。节点位置的主键与 `works.id` 分离；`paper`/`excerpt` 的 `work_id` 只是可空父引用，使用 `ON DELETE SET NULL`。即使原文献不存在，节点的 `data_json` 快照仍可保存和读取。

`CanvasRepo` 在读写时校验：

- schema 版本、视口和时间戳；
- 支持的节点与关系类型；
- 唯一节点/边 ID；
- 正尺寸、合法分组引用；
- 边端点必须属于当前工作区；
- JSON 可序列化以及 Paper/Excerpt 的 `workId` 约束。

工作区保存采用 savepoint，在一个原子快照中替换该工作区的节点和边。失败会回滚到原状态；写入还通过数据库实例级队列串行化，避免并发保存相互覆盖。

### 5.2 Desktop 与浏览器预览

- Desktop 使用 SQLite `CanvasRepo`；页面编辑后约 420 ms 防抖保存，离开页面时会尝试 flush 最新快照。
- 切换白板前会 flush 当前工作区；延迟保存和异步加载都以 `workspaceId` 分区或校验，避免旧白板的操作覆盖新白板。
- 删除白板时会先退休该 `workspaceId`、清理延迟保存与缓存并等待既有写入结束，再执行原子删除；后续 pagehide 保存和 AI 回调都会跳过该 ID，避免 `save()` 的 upsert 让已删除白板复活。
- 浏览器预览使用 `localStorage` 保存多白板 envelope，并会无损迁移旧的单白板预览数据；该模式只用于可交互预览，不代表桌面数据库。
- 同屏阅读器只在 Desktop 读取本地 PDF、加载批注并保存新高亮。浏览器预览会展示明确的不可用状态，不会尝试访问本机 PDF；因此浏览器只能验证分屏外壳、响应式布局和错误状态，不能验证真实 PDF 选区与拖放。
- 每次打开文献、切换来源或更换白板都会取消上一轮未完成的阅读器加载；加载结果还会按请求序号、`workspaceId`、`workId`、来源节点和附件身份复核。已经成功写入数据库的高亮仍是有效的文献库批注，但旧视图的完成回调不能把它加入后来切换到的白板。
- 高亮拖放 payload 带有版本、`workspaceId`、`workId`、来源 `PaperNode`、附件和批注锚点。画布只接受当前阅读会话登记且与当前工作区完全匹配的 payload，并从来源 `PaperNode` 读取可信题名；创建摘录和 `derived-from` 边作为同一次画布文档变更提交，不能跨白板落点。
- 路由层使用 `/canvas/:workspaceId` 标识具体白板；无参数的 `/canvas` 只负责定位最近使用的工作区。

## 6. JSON 备份与迁移

整库 JSON 备份包含 `canvas_workspaces`、`canvas_nodes`、`canvas_edges`。导入顺序被强制为：

`works → canvas_workspaces → canvas_nodes → canvas_edges`

合并导入发生 ID 冲突时，会分别重映射工作区、节点、边、文献、批注和附件命名空间，并同步修正：

- 节点的 `workspace_id`、`work_id` 和 `group_id`；
- Paper/Excerpt payload 中的 `workId`；
- Excerpt 的 `annotationId` 与 `attachmentId`；
- AI 合成的 `sourceNodeIds`；
- 边的 source/target 端点。

导入时如果工作区 ID 发生冲突（包括旧版默认 ID `canvas:default`），会将导入白板及其节点、关系整体重映射为独立工作区，既有本地白板不会被覆盖。JSON 备份不包含 PDF 文件本体、API Key 或密码。

当前 WebDAV 行级同步**不包含空间白板表**；空间白板跨设备迁移目前依赖整库 JSON 导出/导入。设置页也明确展示这一范围。

## 7. 闪卡兼容策略

空间白板没有闪卡入口、学习队列或 FSRS 复习交互；旧 `/flashcards` URL 仅用于兼容并重定向到空间白板。

但现有 `flashcards`、`flashcard_srs`、`flashcard_reviews` 表，以及相关 repository、AI 生成/调度代码仍保留。它们只用于旧版本迁移、历史数据兼容与避免升级时破坏用户数据；**本次实现没有物理删除表或历史记录，也没有把这些旧代码暴露为可达 UI**。整库备份继续携带这些历史表，以保证可恢复性。

## 8. 当前边界

- 当前轻量管理提供白板的新建、切换、重命名与安全删除，尚无归档功能。
- 节点扩展需要类型、数据库、校验和 renderer 的协同代码变更，不是运行时插件机制。
- AI 文献卡输入限于题录与可用摘要；只有摘录卡携带明确选择的 PDF 原文。
- 空间白板支持整库 JSON 备份，但尚未加入 WebDAV 行级同步。
- JSON 备份不携带 PDF 二进制；恢复后附件需要重新挂载。
- 同屏阅读器的本地 PDF 加载与高亮摘录只在桌面应用中可用；浏览器预览不读取本机 PDF。
- 当前 P0 尚未实现 `Cmd + K` 指令面板、快捷语义连线气泡或时间轴/引用树自动布局。

## 9. 关键实现位置

- 领域模型：`packages/core/src/canvas/types.ts`
- SQLite 迁移：`packages/db/src/migrations.ts`（v16）
- 持久化仓库：`packages/db/src/repos/canvas.ts`
- AI 合成：`packages/ai/src/canvas-synthesis.ts`
- 画布页面：`apps/desktop/src/pages/SpatialCanvasPage.tsx`
- 画布 UI：`apps/desktop/src/features/canvas/`
- 同屏阅读器：`apps/desktop/src/features/canvas/CanvasReaderDrawer.tsx`
- 摘录拖放与节点创建：`apps/desktop/src/features/canvas/canvas-excerpt-dnd.ts`、`apps/desktop/src/features/canvas/excerpt-node.ts`
- 阅读器会话隔离：`apps/desktop/src/features/reader/library-reader-session.ts`
- 白板路由与加入目标：`apps/desktop/src/features/canvas/routes.ts`、`apps/desktop/src/features/canvas/useCanvasIngress.tsx`
- 桌面 AI 适配：`apps/desktop/src/services/canvas-ai.ts`
- JSON 备份引用处理：`packages/sync/src/canvas-backup.ts`
- 备份/同步接入：`apps/desktop/src/services/sync.ts`
