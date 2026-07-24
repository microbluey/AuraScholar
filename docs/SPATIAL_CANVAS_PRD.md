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

画布基于 `@xyflow/react` 实现，提供无限点阵背景、缩放和平移、框选与多选、节点拖动、直接连线和可折叠逻辑分组。控件按作用域分层：底部 Dock 只保留“文献库”“新建”和“指针”，缩放、恢复 100%、显示全部和按需挂载的 MiniMap 位于右下导航岛；分组、自动整理、AI 合成和批量移除仅在多选后显示于选区上方。详情没有常驻入口，节点的普通单击直接打开对应主工作表面。

普通单击直接进入节点的主要工作表面：文献和摘录打开与 React Flow 视口并列的右侧阅读器，AI 合成和分组打开左侧详情编辑面板；研究笔记不再跳到狭窄侧栏，点击卡片标题或正文即可分别进入单行与 Markdown 内联编辑，空间不足时可从卡片或上下文菜单展开专注编辑器。专注编辑器提供源码、分屏和预览模式，复用 GFM、数学公式与安全链接渲染，支持常用格式工具以及 `Cmd` / `Ctrl` + `S` 保存。单击连线只选择它；系统在工作区层识别同一连线上的两次真实主键点击，避免 React Flow 首次选择重渲染吞掉原生 `dblclick`，并在点击位置打开轻量输入框就地编辑可选自由文字；选中连线后按 `F2` 提供同等键盘路径。桌面端阅读器默认约按白板 60%、阅读器 40% 分屏，分隔条可拖动或用键盘调整；阅读器不是画布变换层的子元素，因此缩放和平移白板不会缩放阅读器。鼠标右键、触摸板双指点击或卡片 `...` 按钮会打开节点上下文菜单；`Shift` / `Cmd` / `Ctrl` + 单击只修改多选，不触发内容打开。“选择”模式不再把右键用于平移，用户仍可通过鼠标中键、按住 `Space` 或切换“平移”工具拖动画布。

画布聚焦且当前不在输入控件、内容编辑区、弹窗/菜单或同屏阅读器上下文时，`Delete` / `Backspace` 会删除当前选中的节点或连线；这些 guard 防止用户在编辑文本、确认操作或阅读 PDF 时误删画布内容。删除分组节点会解除其子卡片的 `groupId` 并只移除分组外壳，子卡片继续保留；删除文献或摘录节点也始终只影响当前白板，不会删除文献库条目、批注或 PDF 文件。

画布聚焦且不在原生文本编辑、弹窗/菜单或阅读器上下文时，`Cmd` / `Ctrl` + `Z` 撤销，`Cmd` + `Shift` + `Z` 或 `Ctrl` + `Y` / `Ctrl` + `Shift` + `Z` 重做；“指针”菜单也提供同一入口和禁用状态。历史按 `workspaceId` 隔离，每个白板在当前页面会话内保留最近 50 步，切换后返回仍可继续使用自己的历史。节点拖动按一次真实手势合并，卡片/连线文字的连续编辑按短时间窗合并；平移、缩放、仅定位操作和分组折叠/展开不入历史，执行撤销或重做时仍保留当前分组显隐状态。输入框与内容编辑器继续使用浏览器原生文本撤销，不会被画布接管。

画布顶部显示当前白板名称，并提供新建与切换；列表项 hover/focus 后出现 `...` 菜单，可就地重命名或安全删除。hover/focus 卡片会显示上、下、左、右四个磁力连接点，不存在独立“连接”模式或关系类型。拖到另一张卡片会立即创建连线；拖到空白处会在落点原子创建一张空白研究笔记并连接来源。新连线没有默认文字，也不会弹出关系 Pills 或已有节点选择器。

画布内按 `Cmd` / `Ctrl` + `K` 会打开专用指令面板，可按题名、作者、期刊、年份或标签检索完整文献库，并在最近一次画布指针位置创建 `PaperNode`。如果文献已经位于当前白板，执行后会定位已有节点；节点处于折叠分组时会先自动展开分组，不会创建重复卡片。输入 `/ai` 只提供方法论对比、分歧分析、研究空白和简明综述四种现有合成操作，不提供自由 AI 对话。

选择同一层级的至少两张 `PaperNode` 后，可从选区浮条、多选右键菜单或 `Cmd` / `Ctrl` + `Shift` + `L` 打开自动整理菜单：时间轴按发表年份排列；只有所选文献在当前白板文档中已带有系统/历史 `cites` 数据时才显示引用树，手工连线不会被分类为引文数据。存在循环引用时会作为同一强连通分量保留在同一列，避免循环导致布局失败。根节点与分组内节点不会混合排布。

主要流程如下：

1. 主导航进入 `/canvas` 时，页面会以 `replace` 方式转到最近使用的 `/canvas/:workspaceId`；直接访问具名路由可打开对应白板。
2. 在画布顶部切换器中新建或切换白板；每个列表项的 `...` 菜单提供重命名和删除。删除前弹窗会显示白板名称与卡片数；只剩一个白板时不展示删除操作。删除当前白板后，路由以 `replace` 方式转到剩余列表第一项。
3. 从文献库或 PDF 阅读器加入整篇文献或批注时，如果只有一个白板则直接加入；如果有多个白板，则打开轻量目标选择器，默认选中最近活跃白板，支持回车确认或就地“新建并加入”。
4. 从底部 Dock 打开左侧“文献库”面板，点击或拖入任意文献，可在当前白板创建 `PaperNode`；“新建”菜单提供研究笔记及 `Cmd` / `Ctrl` + `K` 文献搜索入口。
5. 普通单击文献卡会在白板右侧打开同屏阅读器；单击摘录卡会按 `attachmentId`、`annotationId` 和 `pageIndex` 在同一分屏中定位具体附件、批注与页码。阅读器标题栏仍提供进入完整阅读器的回退入口。
6. 点击 Idea Note 的标题或正文即可在卡片内编辑；需要更大空间时可展开带源码、分屏、预览与 Markdown/LaTeX 工具的专注编辑器。普通单击 AI 合成或分组仍打开左侧“详情与编辑”面板；单击连线只选择它，双击连线或选中后按 `F2` 可就地编辑自由文字。
7. 鼠标右键、触摸板双指点击或卡片 `...` 会打开节点上下文菜单，用于打开、查看/编辑、聚焦、分组、折叠/展开或从画布移除等适用于该节点的操作；`Shift` / `Cmd` / `Ctrl` + 单击只多选，不打开内容。
8. 在右侧阅读器中选择文本并保存高亮后，底部会出现可拖动的摘录条。把它拖到左侧白板的目标位置，或点击「加入当前白板」，会创建一个保留完整批注锚点的 `ExcerptNode`，并从来源 `PaperNode` 自动建立来源连线。重复加入同一批注会聚焦已有摘录，并在缺失时补齐来源连线，而不是复制卡片。
9. 悬停或聚焦任意卡片即可显示四向磁力连接点。从来源卡拖到目标卡后立即创建普通连线，不要求选择类型；拖到空白处则以一次文档更新同时创建空白 `IdeaNoteNode` 与连线，自动保存不会看到悬空端点。按 `Escape`、在画布外松手或切换白板会取消未完成手势。
10. 新手工连线默认没有文字；双击连线可写入或清空任意自由标签。同一来源 → 目标方向已经存在连线时不会重复创建，而目标 → 来源的反向连线仍可独立建立。
11. 选择多张卡片后可放入分组，或从文献/摘录生成 AI 合成卡。
12. 新建 Idea Note，在画布中记录 Markdown 与 LaTeX 研究笔记。
13. 画布聚焦且不在输入、弹窗/菜单或阅读器上下文时，可用 `Delete` / `Backspace` 删除选中的节点或连线。删除分组只移除外壳并保留子卡片；删除其他画布卡片也只删除当前白板中的摆放及其连线，不会删除原文献、原批注或 PDF。
14. 按 `Cmd` / `Ctrl` + `K` 检索完整文献库并在最近指针位置放入文献；选择已经加入当前白板的结果会展开其折叠分组并定位已有节点。输入 `/ai` 可直接选择四种现有合成操作。
15. 选择同一层级的至少两张文献卡，通过选区浮条、多选右键菜单或 `Cmd` / `Ctrl` + `Shift` + `L` 按年份时间轴整理；当前白板文档已带有系统/历史 `cites` 数据时还可选择引用树，循环引用节点排列在同一列。
16. 用 `Cmd` / `Ctrl` + `Z` 撤销当前白板的节点、连线、分组、整理及内容编辑，用平台对应的重做快捷键恢复；切到另一张白板时只会操作该白板自己的历史。卡片内输入与专注编辑器保留原生文本撤销，提交后才作为一次白板内容变更进入历史。白板刷新或离开页面后会话历史清空，已保存的画布内容不受影响。

## 3. 节点与连线模型

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

### 3.2 连线

`CanvasEdge` 连接两个同工作区节点。产品交互不再向用户暴露或要求选择关系类型；所有新手工连线都以兼容值 `custom` 保存，并且默认没有标签。用户只通过双击写入可选的自由文字。

底层仍保留 `cites`、`supports`、`contradicts`、`extends`、`derived-from` 和 `custom` 枚举，以便无损读取旧白板，并让摘录/AI 来源边和引用树布局继续工作。这些值是兼容与系统 provenance 字段，不是手工连线 UI 中的可选类型；编辑连线文字也不会改变内部 provenance。

连线可带自由文字标签及颜色/动画样式，并与节点一起持久化。连接已有节点时松手即提交；空白落点会把新节点和连线作为同一次原子变更提交。端点失效、越界松手或期间切换白板都不会产生持久化连线。

### 3.3 扩展边界

`CanvasNodeDataByType` 是当前的类型扩展缝：新增节点种类时可通过 TypeScript interface augmentation 扩充节点类型映射。它能让领域类型保持严格的判别联合，但**不是运行时动态注册表或插件市场**。

真正增加一种可落库、可展示的新节点，仍需要同步修改：

1. Core 的数据类型与包导出；
2. 数据库迁移中的类型约束和 `CanvasRepo` 支持列表；
3. Desktop 持久化 payload 校验；
4. React Flow 的节点 renderer、卡片组件和工具箱详情编辑器；
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

合成请求启动时会捕获唯一请求 ID、来源白板 ID，以及每个来源节点精确的 `{ id, type, inputFingerprint }` 快照，并预分配合成节点与来源边 ID。`inputFingerprint` 复用底层 prompt 的标准化规则，只覆盖实际送给 AI 的题名、摘要/题录、摘录原文与边注，不包含卡片坐标、分组或时间戳。请求返回后会对当前活动请求、白板、全部来源身份、类型与 AI 输入、生成 ID 冲突进行一次原子校验；任一来源被删除、类型或输入内容变化、请求被替换、执行过撤销/重做或白板已切换时，整次结果原样丢弃，既不创建 AI 节点也不创建来源边；仅移动、整理卡片或等价的空白变化不会误丢结果，结果卡会按提交时来源卡片的最新位置落位。即使发生 A → B → A 的白板往返，旧组件请求也会因请求 ID 失效而被拒绝。

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
- 支持的节点类型及连线内部兼容字段；
- 唯一节点/边 ID；
- 正尺寸、合法分组引用；
- 边端点必须属于当前工作区；
- JSON 可序列化以及 Paper/Excerpt 的 `workId` 约束。

工作区保存采用 savepoint，在一个原子快照中替换该工作区的节点和边。失败会回滚到原状态；写入还通过数据库实例级队列串行化，避免并发保存相互覆盖。

### 5.2 Desktop 与浏览器预览

- Desktop 使用 SQLite `CanvasRepo`；页面编辑后约 420 ms 防抖保存，离开页面时会尝试 flush 最新快照。
- 切换白板前会 flush 当前工作区；延迟保存和异步加载都以 `workspaceId` 分区或校验，避免旧白板的操作覆盖新白板。
- 撤销/重做历史只保存节点与关系内容快照，恢复时保留当前白板名称、说明、视口和分组折叠状态；每个工作区最多 50 步。历史只存在于当前页面会话，不进入 SQLite、JSON 备份或 WebDAV；白板切换保留各自栈，删除白板会同步丢弃该栈，重新加载内容若与历史头不一致则只重置对应白板的历史。内容指纹使用递归稳定键排序，避免 SQLite 重载后的字段顺序差异误清历史。
- 删除白板时会先退休该 `workspaceId`、清理延迟保存与缓存并等待既有写入结束，再执行原子删除；后续 pagehide 保存和 AI 回调都会跳过该 ID，避免 `save()` 的 upsert 让已删除白板复活。
- 浏览器预览使用 `localStorage` 保存多白板 envelope，并会无损迁移旧的单白板预览数据；该模式只用于可交互预览，不代表桌面数据库。
- 只有打开右下导航岛的“画布概览”时才挂载 React Flow `MiniMap`；收起概览会直接卸载它，避免对不可见容器持续尺寸观测。
- 同屏阅读器只在 Desktop 读取本地 PDF、加载批注并保存新高亮。浏览器预览会展示明确的不可用状态，不会尝试访问本机 PDF；因此浏览器只能验证分屏外壳、响应式布局和错误状态，不能验证真实 PDF 选区与拖放。
- 每次打开文献、切换来源或更换白板都会取消上一轮未完成的阅读器加载；加载结果还会按请求序号、`workspaceId`、`workId`、来源节点和附件身份复核。已经成功写入数据库的高亮仍是有效的文献库批注，但旧视图的完成回调不能把它加入后来切换到的白板。
- 高亮拖放 payload 带有版本、`workspaceId`、`workId`、来源 `PaperNode`、附件和批注锚点。画布只接受当前阅读会话登记且与当前工作区完全匹配的 payload，并从来源 `PaperNode` 读取可信题名；创建摘录和来源连线作为同一次画布文档变更提交，不能跨白板落点。
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
- 撤销/重做是页面会话级能力；刷新、离开空间白板或重启应用后不保留历史。
- 节点扩展需要类型、数据库、校验和 renderer 的协同代码变更，不是运行时插件机制。
- AI 文献卡输入限于题录与可用摘要；只有摘录卡携带明确选择的 PDF 原文。
- 空间白板支持整库 JSON 备份，但尚未加入 WebDAV 行级同步。
- JSON 备份不携带 PDF 二进制；恢复后附件需要重新挂载。
- 同屏阅读器的本地 PDF 加载与高亮摘录只在桌面应用中可用；浏览器预览不读取本机 PDF。
- 画布指令面板中的 `/ai` 只调用四种已有合成模式，不提供自由对话或任意 Prompt 执行。
- 自动整理只作用于同一层级的至少两张文献卡；引用树仅在当前白板文档已经包含所选节点间的系统/历史 `cites` 数据时可用，当前版本不会把普通手工连线或 Library 引文图自动转换为该数据。

## 9. 关键实现位置

- 领域模型：`packages/core/src/canvas/types.ts`
- SQLite 迁移：`packages/db/src/migrations.ts`（v16）
- 持久化仓库：`packages/db/src/repos/canvas.ts`
- AI 合成：`packages/ai/src/canvas-synthesis.ts`
- 画布页面：`apps/desktop/src/pages/SpatialCanvasPage.tsx`
- 画布 UI：`apps/desktop/src/features/canvas/`
- 白板历史与快捷键：`apps/desktop/src/features/canvas/canvas-history.ts`、`apps/desktop/src/features/canvas/canvas-interactions.ts`
- 底部统一功能栏与左侧内容面板：`apps/desktop/src/features/canvas/CanvasDock.tsx`、`apps/desktop/src/features/canvas/CanvasToolbox.tsx`、`apps/desktop/src/features/canvas/CanvasDetailsPanel.tsx`
- 节点上下文菜单与交互判定：`apps/desktop/src/features/canvas/CanvasNodeContextMenu.tsx`、`apps/desktop/src/features/canvas/canvas-interactions.ts`
- 画布指令面板与全库检索：`apps/desktop/src/features/canvas/CanvasCommandPalette.tsx`、`apps/desktop/src/features/canvas/canvas-command.ts`、`packages/db/src/work-list.ts`
- 时间轴与引用树整理：`packages/core/src/canvas/layout.ts`
- 磁吸连线、空白落点建笔记与原子校验：`apps/desktop/src/features/canvas/canvas-link.ts`
- 连线文字渲染与双击编辑：`apps/desktop/src/features/canvas/RelationEdge.tsx`、`apps/desktop/src/features/canvas/CanvasEdgeLabelEditor.tsx`
- 研究笔记内联与专注编辑：`apps/desktop/src/features/canvas/CanvasCards.tsx`、`apps/desktop/src/features/canvas/CanvasNoteEditorDialog.tsx`、`apps/desktop/src/features/canvas/idea-note-edit.ts`
- 同屏阅读器：`apps/desktop/src/features/canvas/CanvasReaderDrawer.tsx`
- 摘录拖放与节点创建：`apps/desktop/src/features/canvas/canvas-excerpt-dnd.ts`、`apps/desktop/src/features/canvas/excerpt-node.ts`
- 阅读器会话隔离：`apps/desktop/src/features/reader/library-reader-session.ts`
- 白板路由与加入目标：`apps/desktop/src/features/canvas/routes.ts`、`apps/desktop/src/features/canvas/useCanvasIngress.tsx`
- AI 完成态原子校验与桌面适配：`apps/desktop/src/features/canvas/synthesis.ts`、`apps/desktop/src/services/canvas-ai.ts`
- JSON 备份引用处理：`packages/sync/src/canvas-backup.ts`
- 备份/同步接入：`apps/desktop/src/services/sync.ts`
