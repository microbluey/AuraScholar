# AuraScholar 空间白板：产品与架构说明

> 状态：已实现。本说明以当前代码为准，描述产品边界、数据模型与扩展方式，不是代码生成 Prompt。

## 1. 产品定位

空间白板（Spatial Canvas）把文献库中的论文、摘录、研究者想法和 AI 合成结果放入同一张可缩放、可平移的点阵画布。它服务于学术研究中的材料整理、观点关联、方法比较和研究问题形成，而不是知识点背诵。

核心产品决策：

- **完整文献可以直接成为节点。** 论文不需要先产生划线或摘录；研究者可在初筛阶段先把文献放入画布，再阅读、分组和连线。
- **不提供闪卡复习 UI。** 闪卡与 FSRS 更偏向记忆训练，不是空间白板的研究工作流。主导航只提供“空间白板”，旧 `/flashcards` 路由会重定向到 `/canvas`。
- **卡片是可扩展的领域对象。** 当前提供五种一方节点类型；扩展点是 TypeScript 类型映射，而不是运行时插件系统。
- **AI 只合成明确选择的材料。** 输出保留来源节点，并显式说明分析范围，避免把题录或摘要误表述为全文审读。

## 2. 当前用户体验

画布基于 `@xyflow/react` 实现，提供无限点阵背景、缩放和平移、框选与多选、节点拖动、关系连线、MiniMap、左侧文献面板、底部 Dock 和右侧检查器。

主要流程如下：

1. 从文献库进入白板，或在画布左侧面板点击/拖入任意文献，创建 `PaperNode`。
2. 在 PDF 阅读器中，可将整篇文献加入白板，也可把一条批注作为 `ExcerptNode` 加入。
3. 双击文献卡打开对应文献；双击摘录卡按 `attachmentId`、`annotationId` 和 `pageIndex` 深链回阅读器的具体附件、批注与页码。
4. 选择多张卡片后可建立关系、放入分组，或从文献/摘录生成 AI 合成卡。
5. 新建 Idea Note，在画布中记录 Markdown 与 LaTeX 研究笔记。
6. 删除画布卡片只删除画布中的摆放及其关系，不会删除原文献或原批注。

## 3. 节点与关系模型

核心类型位于 `packages/core/src/canvas/types.ts`。持久化文档使用 `CANVAS_SCHEMA_VERSION = 1`，包含工作区信息、视口、节点和边；选中、聚焦等界面状态不持久化。

### 3.1 五种一方节点

| 类型标识    | 产品名称     | 关键数据与用途                                                                                                            |
| ----------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `paper`     | PaperNode    | `workId`、题名、作者、年份、来源、DOI、摘要片段等。允许没有任何摘录的完整文献独立存在。节点 ID 与文献 `workId` 始终分离。 |
| `excerpt`   | ExcerptNode  | `workId`、高亮原文、颜色、零基页码，以及可选的 `annotationId`、`attachmentId`、锚点和边注；用于精确回到阅读器。           |
| `ai-synth`  | AISynthNode  | 来源节点 ID、合成模式、Markdown 结论、可选结构化表格和模型名；用于方法比较、分歧分析、研究空白与简明综述。                |
| `idea-note` | IdeaNoteNode | 可选标题、Markdown 正文和公式标记；表达研究者自己的想法、假设与待验证问题。                                               |
| `group`     | GroupNode    | 分组标题与可选色彩主题；作为画布内的逻辑容器。                                                                            |

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

`sourceNodeIds` 和来源边共同提供画布内溯源。它们表达的是“此结果由哪些当前节点生成”，不是对外部学术引用真实性的替代验证。

## 5. 持久化架构

### 5.1 SQLite

数据库迁移 v16 以增量方式新增三张表：

- `canvas_workspaces`：名称、说明、schema 版本、视口与时间戳；
- `canvas_nodes`：工作区、可选文献外键、类型、位置、尺寸、分组、排序、标签和类型 payload；
- `canvas_edges`：工作区、端点、关系、标签、样式、排序和时间戳。

当前 UI 使用单一默认工作区 `canvas:default`，尚无多工作区切换器。节点位置的主键与 `works.id` 分离；`paper`/`excerpt` 的 `work_id` 只是可空父引用，使用 `ON DELETE SET NULL`。即使原文献不存在，节点的 `data_json` 快照仍可保存和读取。

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
- 浏览器预览使用 `localStorage`，只用于可交互预览，不代表桌面数据库。

## 6. JSON 备份与迁移

整库 JSON 备份包含 `canvas_workspaces`、`canvas_nodes`、`canvas_edges`。导入顺序被强制为：

`works → canvas_workspaces → canvas_nodes → canvas_edges`

合并导入发生 ID 冲突时，会分别重映射工作区、节点、边、文献、批注和附件命名空间，并同步修正：

- 节点的 `workspace_id`、`work_id` 和 `group_id`；
- Paper/Excerpt payload 中的 `workId`；
- Excerpt 的 `annotationId` 与 `attachmentId`；
- AI 合成的 `sourceNodeIds`；
- 边的 source/target 端点。

默认工作区 `canvas:default` 会合并到当前可见工作区。JSON 备份不包含 PDF 文件本体、API Key 或密码。

当前 WebDAV 行级同步**不包含空间白板表**；空间白板跨设备迁移目前依赖整库 JSON 导出/导入。设置页也明确展示这一范围。

## 7. 闪卡兼容策略

空间白板没有闪卡入口、学习队列或 FSRS 复习交互；旧 `/flashcards` URL 仅用于兼容并重定向到空间白板。

但现有 `flashcards`、`flashcard_srs`、`flashcard_reviews` 表，以及相关 repository、AI 生成/调度代码仍保留。它们只用于旧版本迁移、历史数据兼容与避免升级时破坏用户数据；**本次实现没有物理删除表或历史记录，也没有把这些旧代码暴露为可达 UI**。整库备份继续携带这些历史表，以保证可恢复性。

## 8. 当前边界

- 当前只有一个默认工作区；数据库层可列出工作区，但 UI 没有创建/切换工作区流程。
- 节点扩展需要类型、数据库、校验和 renderer 的协同代码变更，不是运行时插件机制。
- AI 文献卡输入限于题录与可用摘要；只有摘录卡携带明确选择的 PDF 原文。
- 空间白板支持整库 JSON 备份，但尚未加入 WebDAV 行级同步。
- JSON 备份不携带 PDF 二进制；恢复后附件需要重新挂载。

## 9. 关键实现位置

- 领域模型：`packages/core/src/canvas/types.ts`
- SQLite 迁移：`packages/db/src/migrations.ts`（v16）
- 持久化仓库：`packages/db/src/repos/canvas.ts`
- AI 合成：`packages/ai/src/canvas-synthesis.ts`
- 画布页面：`apps/desktop/src/pages/SpatialCanvasPage.tsx`
- 画布 UI：`apps/desktop/src/features/canvas/`
- 桌面 AI 适配：`apps/desktop/src/services/canvas-ai.ts`
- JSON 备份引用处理：`packages/sync/src/canvas-backup.ts`
- 备份/同步接入：`apps/desktop/src/services/sync.ts`
