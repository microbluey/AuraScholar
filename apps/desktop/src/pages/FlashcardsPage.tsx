// Review queue: FSRS-due cards, flip-to-reveal, four-grade rating.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FlashcardsRepo, Rating, type DueCard } from "@aurascholar/db/repos/flashcards";
import { Badge, Button, Card } from "@aurascholar/ui";
import { getDb } from "../services/aura-db";
import { listWorks } from "../services/library-list";
import { InlineNotice } from "../components/InlineNotice";
import { isDesktopRuntime } from "../services/aura-platform";
import { describeSafeError } from "../services/sensitive-text";
import { useConfirmDialog } from "../components/ConfirmDialog";

interface StudyStats {
  total: number;
  due: number;
  newDue: number;
  reviewedToday: number;
  nextDueAt: number | null;
}

const EMPTY_STATS: StudyStats = {
  total: 0,
  due: 0,
  newDue: 0,
  reviewedToday: 0,
  nextDueAt: null,
};
const PREVIEW_NOW = Date.UTC(2026, 6, 1, 8, 0, 0);
const PREVIEW_FLASHCARDS: DueCard[] = [
  {
    id: "preview-card-attention-method",
    work_id: "preview-attention",
    front_md: "Transformer 为什么能替代 RNN 处理序列建模？",
    back_md:
      "它用多头自注意力一次性建模 token 之间的依赖，避免循环结构的串行瓶颈，并通过位置编码保留顺序信息。",
    card_type: "method",
    source: "ai",
    created_at: PREVIEW_NOW - 86_400_000,
    due_at: PREVIEW_NOW - 3_600_000,
    state: 1,
    reps: 2,
  },
  {
    id: "preview-card-attention-contribution",
    work_id: "preview-attention",
    front_md: "《Attention Is All You Need》的核心贡献是什么？",
    back_md:
      "提出完全基于注意力机制的 Transformer 架构，使机器翻译训练更并行、更高效，并成为后续大模型的基础结构。",
    card_type: "contribution",
    source: "ai",
    created_at: PREVIEW_NOW - 80_000_000,
    due_at: PREVIEW_NOW - 900_000,
    state: 0,
    reps: 0,
  },
  {
    id: "preview-card-alphafold-limitation",
    work_id: "preview-alphafold",
    front_md: "AlphaFold 结果进入论文时，最需要额外说明什么边界？",
    back_md:
      "需要说明预测结构不等同于实验结构，动态构象、复合物环境、配体影响和实验验证仍然是解释结果的关键边界。",
    card_type: "limitation",
    source: "ai",
    created_at: PREVIEW_NOW - 72_000_000,
    due_at: PREVIEW_NOW - 420_000,
    state: 1,
    reps: 1,
  },
  {
    id: "preview-card-scaling-laws-qa",
    work_id: "preview-scaling-laws",
    front_md: "Scaling laws 对实验预算规划有什么启发？",
    back_md:
      "在模型规模、数据量和算力之间存在可预测的幂律关系；预算规划应避免单点堆大模型，而要平衡参数、数据和训练步数。",
    card_type: "qa",
    source: "ai",
    created_at: PREVIEW_NOW - 60_000_000,
    due_at: PREVIEW_NOW - 60_000,
    state: 1,
    reps: 3,
  },
];
const PREVIEW_FLASHCARD_STATS: StudyStats = {
  total: 30,
  due: PREVIEW_FLASHCARDS.length,
  newDue: PREVIEW_FLASHCARDS.filter((card) => card.reps === 0).length,
  reviewedToday: 0,
  nextDueAt: PREVIEW_NOW + 3_600_000 * 5,
};
const PREVIEW_LATEST_WORK = { id: "preview-attention", title: "Attention Is All You Need" };
const PREVIEW_FLASHCARD_WORK_TITLES: Record<string, string> = {
  "preview-attention": "Attention Is All You Need",
  "preview-alphafold": "Highly accurate protein structure prediction with AlphaFold",
  "preview-sam": "Segment Anything",
  "preview-scaling-laws": "Scaling Laws for Neural Language Models",
};
const PREVIEW_FLASHCARDS_SCOPE_MESSAGE =
  "浏览器预览使用可重置的复习样例；翻面、评分、移除和撤销会在本页模拟生效，真实 FSRS 进度会在桌面应用中保存。";
const MIN_FLASHCARD_RATING_BUSY_MS = 250;
const MIN_FLASHCARD_REMOVE_BUSY_MS = 500;

interface FlashcardDeleteUndo {
  card: DueCard;
  message: string;
}

interface FlashcardsSmokeWindow extends Window {
  __AURASCHOLAR_SMOKE_FLASHCARDS_AFTER_READ_DELAY_MS__?: number;
  __AURASCHOLAR_SMOKE_FLASHCARDS_AFTER_READ_COUNT__?: number;
  __AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_REMOVE__?: string;
  __AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_RESTORE__?: string;
  __AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_REFRESH__?: string;
  __AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_REVIEW__?: string;
}

const RATING_OPTIONS: Array<{
  rating: Rating;
  key: string;
  label: string;
  hint: string;
  variant: "primary" | "secondary" | "danger";
}> = [
  { rating: Rating.Again, key: "1", label: "忘了", hint: "马上再见", variant: "danger" },
  { rating: Rating.Hard, key: "2", label: "困难", hint: "缩短间隔", variant: "secondary" },
  { rating: Rating.Good, key: "3", label: "记得", hint: "正常推进", variant: "primary" },
  { rating: Rating.Easy, key: "4", label: "轻松", hint: "拉开间隔", variant: "secondary" },
];

async function waitForMinimumElapsed(startedAt: number, minimumMs: number): Promise<void> {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}

async function waitForFlashcardsSmokeAfterReadDelay(): Promise<void> {
  const smokeWindow = window as FlashcardsSmokeWindow;
  const delayMs = smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_AFTER_READ_DELAY_MS__;
  if (typeof delayMs !== "number" || delayMs <= 0) return;
  smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_AFTER_READ_COUNT__ =
    (smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_AFTER_READ_COUNT__ ?? 0) + 1;
  await new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function consumeFlashcardsSmokeRefreshFailure(): Error | null {
  const smokeWindow = window as FlashcardsSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_REFRESH__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_REFRESH__;
  return new Error(message);
}

function consumeFlashcardsSmokeReviewFailure(): Error | null {
  const smokeWindow = window as FlashcardsSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_REVIEW__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_REVIEW__;
  return new Error(message);
}

function consumeFlashcardsSmokeRemoveFailure(): Error | null {
  const smokeWindow = window as FlashcardsSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_REMOVE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_REMOVE__;
  return new Error(message);
}

function consumeFlashcardsSmokeRestoreFailure(): Error | null {
  const smokeWindow = window as FlashcardsSmokeWindow;
  const message = smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_RESTORE__;
  if (!message) return null;
  delete smokeWindow.__AURASCHOLAR_SMOKE_FLASHCARDS_FAIL_NEXT_RESTORE__;
  return new Error(message);
}

function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="menuitem"]',
    ),
  );
}

function previewTitleForWork(workId: string, title: string): string {
  return title.trim() || PREVIEW_FLASHCARD_WORK_TITLES[workId] || "当前文献";
}

function previewCardsForWork(workId: string, title: string): DueCard[] {
  if (!workId) return PREVIEW_FLASHCARDS;
  const existing = PREVIEW_FLASHCARDS.filter((card) => card.work_id === workId);
  if (existing.length > 0) return existing;
  const workTitle = previewTitleForWork(workId, title);
  return [
    {
      id: `${workId}-preview-generated-contribution`,
      work_id: workId,
      front_md: `《${workTitle}》最值得记住的一句话是什么？`,
      back_md: "先把问题、方法和结论压缩成一条可复述的研究主张，再回到原文补充证据和边界。",
      card_type: "contribution",
      source: "ai",
      created_at: PREVIEW_NOW - 50_000_000,
      due_at: PREVIEW_NOW - 300_000,
      state: 0,
      reps: 0,
    },
    {
      id: `${workId}-preview-generated-boundary`,
      work_id: workId,
      front_md: `复述《${workTitle}》时，需要主动说明哪类边界？`,
      back_md:
        "优先说明数据来源、实验设定、适用场景和作者没有直接证明的推论，避免把摘要变成过度泛化的结论。",
      card_type: "limitation",
      source: "ai",
      created_at: PREVIEW_NOW - 48_000_000,
      due_at: PREVIEW_NOW - 120_000,
      state: 0,
      reps: 0,
    },
  ];
}

function previewStatsForCards(cards: DueCard[], scoped: boolean): StudyStats {
  if (!scoped) return PREVIEW_FLASHCARD_STATS;
  return {
    total: cards.length,
    due: cards.length,
    newDue: cards.filter((card) => card.reps === 0).length,
    reviewedToday: 0,
    nextDueAt: PREVIEW_NOW + 3_600_000 * 5,
  };
}

export function FlashcardsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { confirm, confirmDialog } = useConfirmDialog();
  const previewWorkId = searchParams.get("work")?.trim() ?? "";
  const previewWorkTitle = searchParams.get("title")?.trim() ?? "";
  const [queue, setQueue] = useState<DueCard[]>([]);
  const [latestWork, setLatestWork] = useState<{ id: string; title: string } | null>(null);
  const [stats, setStats] = useState<StudyStats>(EMPTY_STATS);
  const [revealed, setRevealed] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [removingCard, setRemovingCard] = useState(false);
  const [activeRating, setActiveRating] = useState<Rating | null>(null);
  const [deleteUndo, setDeleteUndo] = useState<FlashcardDeleteUndo | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const ratingBusyRef = useRef(false);
  const removalBusyRef = useRef(false);
  const refreshSeqRef = useRef(0);

  const refresh = useCallback(
    async (options: { clearMessage?: boolean; showLoading?: boolean } = {}) => {
      const seq = refreshSeqRef.current + 1;
      refreshSeqRef.current = seq;
      const clearMessage = options.clearMessage ?? true;
      const showLoading = options.showLoading ?? true;
      if (!isDesktopRuntime()) {
        if (refreshSeqRef.current !== seq) return false;
        const previewQueue = previewCardsForWork(previewWorkId, previewWorkTitle);
        const scopedToWork = Boolean(previewWorkId);
        const scopedTitle = scopedToWork
          ? previewTitleForWork(previewWorkId, previewWorkTitle)
          : PREVIEW_LATEST_WORK.title;
        setQueue(previewQueue);
        setLatestWork(
          scopedToWork ? { id: previewWorkId, title: scopedTitle } : PREVIEW_LATEST_WORK,
        );
        setStats(previewStatsForCards(previewQueue, scopedToWork));
        setRevealed(false);
        setLoadError(null);
        setLoading(false);
        setMessage(
          (current) =>
            current ??
            (scopedToWork
              ? `已为《${scopedTitle}》生成预览闪卡；本页可模拟复习，真实 AI 生成和 FSRS 进度会在桌面应用中保存。`
              : PREVIEW_FLASHCARDS_SCOPE_MESSAGE),
        );
        return true;
      }
      if (showLoading) setLoading(true);
      if (clearMessage) setMessage(null);
      if (showLoading) setLoadError(null);
      try {
        const smokeFailure = consumeFlashcardsSmokeRefreshFailure();
        if (smokeFailure) throw smokeFailure;
        const db = await getDb();
        const repo = new FlashcardsRepo(db);
        const now = Date.now();
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const [dueCards, dueTotal, totalRows, newDueRows, reviewedRows, nextDueRows, recentWorks] =
          await Promise.all([
            repo.dueCards(50, now),
            repo.countDue(now),
            db.query<{ n: number }>(
              `SELECT COUNT(*) AS n
             FROM flashcards f
             JOIN works w ON w.id = f.work_id AND w.deleted_at IS NULL
             WHERE f.deleted_at IS NULL`,
            ),
            db.query<{ n: number }>(
              `SELECT COUNT(*) AS n
             FROM flashcards f
             JOIN flashcard_srs s ON s.flashcard_id = f.id
             JOIN works w ON w.id = f.work_id AND w.deleted_at IS NULL
             WHERE f.deleted_at IS NULL AND s.due_at <= ? AND s.reps = 0`,
              [now],
            ),
            db.query<{ n: number }>(
              `SELECT COUNT(*) AS n FROM flashcard_reviews WHERE reviewed_at >= ?`,
              [todayStart.getTime()],
            ),
            db.query<{ due_at: number | null }>(
              `SELECT MIN(s.due_at) AS due_at
             FROM flashcards f
             JOIN flashcard_srs s ON s.flashcard_id = f.id
             JOIN works w ON w.id = f.work_id AND w.deleted_at IS NULL
             WHERE f.deleted_at IS NULL AND s.due_at > ?`,
              [now],
            ),
            listWorks(undefined, undefined, 1).catch(() => []),
          ]);
        await waitForFlashcardsSmokeAfterReadDelay();
        if (refreshSeqRef.current !== seq) return false;
        setQueue(dueCards);
        setLatestWork(
          recentWorks[0] ? { id: recentWorks[0].id, title: recentWorks[0].title } : null,
        );
        setStats({
          total: totalRows[0]?.n ?? 0,
          due: dueTotal,
          newDue: newDueRows[0]?.n ?? 0,
          reviewedToday: reviewedRows[0]?.n ?? 0,
          nextDueAt: nextDueRows[0]?.due_at ?? null,
        });
        setRevealed(false);
        setLoadError(null);
        return true;
      } catch (e) {
        if (refreshSeqRef.current !== seq) return false;
        const detail = describeSafeError(e);
        setQueue([]);
        setLatestWork(null);
        setStats(EMPTY_STATS);
        setRevealed(false);
        setLoadError(detail);
        setMessage(`读取闪卡失败:${detail}`);
        return false;
      } finally {
        if (showLoading && refreshSeqRef.current === seq) setLoading(false);
      }
    },
    [previewWorkId, previewWorkTitle],
  );

  useEffect(() => {
    const refreshId = window.setTimeout(() => {
      void refresh();
    }, 0);
    const onUpdated = () => void refresh({ showLoading: false });
    window.addEventListener("aurascholar:flashcards-updated", onUpdated);
    return () => {
      window.clearTimeout(refreshId);
      refreshSeqRef.current += 1;
      window.removeEventListener("aurascholar:flashcards-updated", onUpdated);
    };
  }, [refresh]);

  const current = queue[0] ?? null;
  const progress = useMemo(() => {
    const started = reviewedCount + queue.length;
    if (started === 0) return 100;
    return Math.round((reviewedCount / started) * 100);
  }, [queue.length, reviewedCount]);

  const rate = useCallback(
    async (rating: Rating) => {
      if (!current || ratingBusyRef.current || removalBusyRef.current) return;
      const startedAt = Date.now();
      ratingBusyRef.current = true;
      setRatingBusy(true);
      setActiveRating(rating);
      if (!isDesktopRuntime()) {
        await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_RATING_BUSY_MS);
        setQueue((cards) => cards.slice(1));
        setReviewedCount((n) => n + 1);
        setStats((currentStats) => ({
          ...currentStats,
          due: Math.max(0, currentStats.due - 1),
          newDue: current.reps === 0 ? Math.max(0, currentStats.newDue - 1) : currentStats.newDue,
          reviewedToday: currentStats.reviewedToday + 1,
        }));
        setRevealed(false);
        setMessage(`${ratingMessage(rating)}。已更新本页预览队列，真实 FSRS 进度不会被写入。`);
        ratingBusyRef.current = false;
        setRatingBusy(false);
        setActiveRating(null);
        return;
      }
      try {
        const smokeFailure = consumeFlashcardsSmokeReviewFailure();
        if (smokeFailure) throw smokeFailure;
        const db = await getDb();
        await new FlashcardsRepo(db).review(current.id, rating);
        setReviewedCount((n) => n + 1);
        await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_RATING_BUSY_MS);
        const refreshed = await refresh({ clearMessage: false, showLoading: false });
        if (refreshed) setMessage(ratingMessage(rating));
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_RATING_BUSY_MS);
        setMessage(`保存复习结果失败，卡片已保留，可重新评分:${describeSafeError(e)}`);
      } finally {
        ratingBusyRef.current = false;
        setRatingBusy(false);
        setActiveRating(null);
      }
    },
    [current, refresh],
  );

  const removeCurrent = useCallback(async () => {
    if (!current || ratingBusyRef.current || removalBusyRef.current) return;
    const target = current;
    const confirmed = await confirm({
      cancelLabel: "继续复习",
      confirmLabel: "移除闪卡",
      description: (
        <>
          将从复习队列移除这张闪卡：“<strong>{summarizeCardText(target.front_md)}</strong>”
        </>
      ),
      details: [
        "文献、PDF、批注和写作素材不会被删除。",
        "移除后可以立即撤销；撤销会保留原来的 FSRS 复习状态。",
      ],
      title: "移除这张闪卡？",
      tone: "warning",
    });
    if (!confirmed) return;

    const startedAt = Date.now();
    removalBusyRef.current = true;
    setRemovingCard(true);
    setMessage("正在移除闪卡...");
    if (!isDesktopRuntime()) {
      setDeleteUndo({ card: target, message: "已从预览队列移除这张闪卡。" });
      await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_REMOVE_BUSY_MS);
      setQueue((cards) => cards.filter((card) => card.id !== target.id));
      setStats((currentStats) => ({
        ...currentStats,
        due: Math.max(0, currentStats.due - 1),
        newDue: target.reps === 0 ? Math.max(0, currentStats.newDue - 1) : currentStats.newDue,
      }));
      setRevealed(false);
      setMessage("已从预览队列移除这张闪卡。");
      removalBusyRef.current = false;
      setRemovingCard(false);
      return;
    }
    try {
      const smokeFailure = consumeFlashcardsSmokeRemoveFailure();
      if (smokeFailure) throw smokeFailure;
      const db = await getDb();
      await new FlashcardsRepo(db).softDelete(target.id);
      setDeleteUndo({ card: target, message: "已移除这张闪卡。" });
      await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_REMOVE_BUSY_MS);
      setQueue((cards) => cards.filter((card) => card.id !== target.id));
      setRevealed(false);
      await refresh({ clearMessage: false, showLoading: false });
      setMessage("已移除这张闪卡。");
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_REMOVE_BUSY_MS);
      setMessage(`移除闪卡失败，卡片仍保留，可重新移除:${describeSafeError(e)}`);
    } finally {
      removalBusyRef.current = false;
      setRemovingCard(false);
    }
  }, [confirm, current, refresh]);

  const restoreDeletedCard = useCallback(async () => {
    if (!deleteUndo || ratingBusyRef.current || removalBusyRef.current) return;
    const startedAt = Date.now();
    removalBusyRef.current = true;
    setRemovingCard(true);
    setMessage("正在恢复闪卡...");
    if (!isDesktopRuntime()) {
      await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_REMOVE_BUSY_MS);
      setQueue((cards) => [deleteUndo.card, ...cards]);
      setStats((currentStats) => ({
        ...currentStats,
        due: currentStats.due + 1,
        newDue: deleteUndo.card.reps === 0 ? currentStats.newDue + 1 : currentStats.newDue,
      }));
      setDeleteUndo(null);
      setMessage("已恢复这张预览闪卡。");
      removalBusyRef.current = false;
      setRemovingCard(false);
      return;
    }
    try {
      const smokeFailure = consumeFlashcardsSmokeRestoreFailure();
      if (smokeFailure) throw smokeFailure;
      const db = await getDb();
      await new FlashcardsRepo(db).restore(deleteUndo.card.id);
      await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_REMOVE_BUSY_MS);
      setDeleteUndo(null);
      await refresh({ clearMessage: false, showLoading: false });
      setMessage("已恢复这张闪卡。");
    } catch (e) {
      await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_REMOVE_BUSY_MS);
      setMessage(`恢复闪卡失败，撤销入口仍保留，可重新恢复:${describeSafeError(e)}`);
    } finally {
      removalBusyRef.current = false;
      setRemovingCard(false);
    }
  }, [deleteUndo, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isInteractiveShortcutTarget(e.target)) return;
      if (e.code === "Space" && current && !ratingBusyRef.current && !removalBusyRef.current) {
        e.preventDefault();
        setRevealed((v) => !v);
        return;
      }
      if (revealed && current && !ratingBusyRef.current && !removalBusyRef.current) {
        const option = RATING_OPTIONS.find((item) => item.key === e.key);
        if (option) void rate(option.rating);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, rate, revealed]);

  return (
    <div className="study-page study-page--flashcards">
      <div className="study-hero">
        <div>
          <p className="app-page-kicker">AI digest to memory</p>
          <h1 className="app-page-title">闪卡复习</h1>
          <p className="app-page-subtitle">
            FSRS 间隔重复 · 今日待复习 {stats.due} 张
            {(reviewedCount > 0 || stats.reviewedToday > 0) &&
              ` · 今日已复习 ${stats.reviewedToday} 张`}
          </p>
        </div>
        <div className="study-summary" aria-label="复习总览">
          <StudyMetric label="今日待复习" value={stats.due} />
          <StudyMetric label="新卡" value={stats.newDue} />
          <StudyMetric label="总卡片" value={stats.total} />
        </div>
      </div>

      <InlineNotice className="study-message" message={loadError && !current ? null : message} />
      {deleteUndo &&
        (message === deleteUndo.message ||
          message === "已移除这张闪卡。" ||
          message === "正在恢复闪卡..." ||
          message?.startsWith("恢复闪卡失败，撤销入口仍保留")) && (
          <div className="study-undo-banner" role="status">
            <span>{message ?? deleteUndo.message}</span>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void restoreDeletedCard()}
              disabled={removingCard}
              aria-busy={removingCard || undefined}
              aria-label="撤销移除闪卡"
            >
              {removingCard ? "恢复中..." : "撤销"}
            </Button>
          </div>
        )}

      {loading ? (
        <Card className="study-empty">
          <Badge variant="neutral">Loading</Badge>
          <p>正在读取复习队列</p>
        </Card>
      ) : loadError && !current ? (
        <StudyErrorState
          message={loadError}
          onOpenLibrary={() => navigate("/library")}
          onRetry={() => void refresh()}
        />
      ) : !current ? (
        <StudyEmptyState
          reviewedCount={reviewedCount}
          hasCards={stats.total > 0}
          latestWorkTitle={latestWork?.title ?? null}
          nextDueAt={stats.nextDueAt}
          onOpenLibrary={() => navigate("/library")}
          onOpenLatestWork={
            latestWork
              ? () =>
                  navigate(
                    isDesktopRuntime()
                      ? `/reader?work=${encodeURIComponent(latestWork.id)}`
                      : `/library?work=${encodeURIComponent(latestWork.id)}`,
                  )
              : undefined
          }
        />
      ) : (
        <div className="study-layout">
          <section className="study-review" aria-label="当前复习卡片">
            <div className="study-progress">
              <div>
                <strong>{progress}%</strong>
                <span>
                  本轮进度 · 已完成 {reviewedCount} / {reviewedCount + queue.length}
                </span>
              </div>
              <div className="study-progress__track">
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>

            <Card
              className={revealed ? "study-card study-card--revealed" : "study-card"}
              role="button"
              tabIndex={0}
              aria-label={revealed ? "隐藏答案" : "显示答案"}
              aria-disabled={ratingBusy || removingCard || undefined}
              aria-pressed={revealed}
              onClick={() => {
                if (!ratingBusy && !removingCard) setRevealed((v) => !v);
              }}
              onKeyDown={(event) => {
                if (ratingBusy || removingCard) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setRevealed((v) => !v);
                }
              }}
            >
              <div className="study-card__meta">
                <Badge variant="neutral">{cardTypeLabel(current.card_type)}</Badge>
                {current.source === "ai" && <Badge>AI</Badge>}
                <span className="au-kbd">Space</span>
              </div>
              <div className="study-card__front">{current.front_md}</div>
              {revealed ? (
                <>
                  <hr className="study-card__divider" />
                  <div className="study-card__back">{current.back_md}</div>
                </>
              ) : (
                <p className="study-card__hint">点击或按空格显示答案</p>
              )}
            </Card>

            {revealed && (
              <div className="study-rating">
                {RATING_OPTIONS.map((option) => {
                  const busy = activeRating === option.rating;
                  return (
                    <Button
                      key={option.key}
                      variant={option.variant}
                      aria-busy={busy || undefined}
                      onClick={() => void rate(option.rating)}
                      disabled={ratingBusy || removingCard}
                    >
                      <span>{busy ? "记录中..." : option.label}</span>
                      <small>{busy ? "正在推进队列" : option.hint}</small>
                      <kbd>{option.key}</kbd>
                    </Button>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="study-session-panel">
            <Card>
              <h2>当前卡片</h2>
              <StatusLine label="复习次数" value={`${current.reps} 次`} />
              <StatusLine label="卡片状态" value={current.reps === 0 ? "新卡" : "复习中"} />
              <StatusLine label="到期时间" value={formatDue(current.due_at)} />
            </Card>
            <Card className="study-card-actions">
              <h2>卡片管理</h2>
              <p>发现 AI 生成的废卡或重复卡时，可以先从队列移除，误删后立即撤销。</p>
              <Button
                type="button"
                variant="danger"
                onClick={() => void removeCurrent()}
                disabled={ratingBusy || removingCard}
                aria-busy={removingCard || undefined}
              >
                {removingCard ? "移除中..." : "移除这张闪卡"}
              </Button>
            </Card>
            <Card>
              <h2>快捷键</h2>
              <StatusLine label="翻面" value="Space" />
              <StatusLine label="评分" value="1 / 2 / 3 / 4" />
            </Card>
          </aside>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

function StudyErrorState({
  message,
  onOpenLibrary,
  onRetry,
}: {
  message: string;
  onOpenLibrary: () => void;
  onRetry: () => void;
}) {
  return (
    <Card className="study-empty study-empty--error">
      <Badge variant="danger">读取失败</Badge>
      <p>闪卡队列暂时不可用</p>
      <p className="au-text-muted">{message}</p>
      <div className="study-empty__actions">
        <Button type="button" onClick={onRetry} aria-label="重试读取闪卡队列">
          重试读取
        </Button>
        <Button type="button" variant="secondary" onClick={onOpenLibrary}>
          回到文献库
        </Button>
      </div>
    </Card>
  );
}

function StudyEmptyState({
  reviewedCount,
  hasCards,
  latestWorkTitle,
  nextDueAt,
  onOpenLibrary,
  onOpenLatestWork,
}: {
  reviewedCount: number;
  hasCards: boolean;
  latestWorkTitle: string | null;
  nextDueAt: number | null;
  onOpenLibrary: () => void;
  onOpenLatestWork?: () => void;
}) {
  const complete = reviewedCount > 0;
  const libraryLabel = hasCards ? "去文献库" : "导入第一篇文献";
  const nextDueLabel = nextDueAt ? formatNextDue(nextDueAt) : null;
  return (
    <Card className="study-empty">
      <Badge variant={complete ? "success" : "neutral"}>
        {complete ? "今日完成" : hasCards ? "暂未到期" : "队列为空"}
      </Badge>
      <p>{complete ? "本轮复习完成" : hasCards ? "现在没有待复习卡片" : "还没有闪卡"}</p>
      <p className="au-text-muted">
        {complete
          ? "可以回到最近阅读继续积累下一批重点。"
          : hasCards
            ? "下一批卡片会按 FSRS 间隔自动回到队列。"
            : "从一篇文献进入阅读器，生成 AI 重点后，卡片会进入复习队列。"}
      </p>
      {nextDueLabel && (
        <small className="study-empty__next-due">下一张预计 {nextDueLabel} 回到队列</small>
      )}
      {latestWorkTitle && <small title={latestWorkTitle}>最近文献：{latestWorkTitle}</small>}
      <div className="study-empty__actions">
        {onOpenLatestWork ? (
          <>
            <Button onClick={onOpenLatestWork}>继续阅读最近文献</Button>
            <Button variant="secondary" onClick={onOpenLibrary}>
              {hasCards ? "去文献库" : "选择其他文献"}
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onOpenLibrary}>
            {libraryLabel}
          </Button>
        )}
      </div>
    </Card>
  );
}

function StudyMetric({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <strong>{value.toLocaleString("zh-CN")}</strong>
      <small>{label}</small>
    </span>
  );
}

function StatusLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="study-status-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function summarizeCardText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 60 ? `${normalized.slice(0, 60)}...` : normalized;
}

function ratingMessage(rating: Rating) {
  if (rating === Rating.Again) return "已记录：马上再复习一次";
  if (rating === Rating.Hard) return "已记录：降低间隔";
  if (rating === Rating.Easy) return "已记录：拉开间隔";
  return "已记录：正常推进";
}

function cardTypeLabel(type: string) {
  const labels: Record<string, string> = {
    tldr: "一句话",
    method: "方法",
    contribution: "贡献",
    limitation: "局限",
    qa: "问答",
  };
  return labels[type] ?? type;
}

function formatDue(value: number) {
  const diff = Date.now() - value;
  if (diff < 60_000) return "刚到期";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} 小时前`;
  return `${Math.round(diff / 86_400_000)} 天前`;
}

function formatNextDue(value: number) {
  const diff = value - Date.now();
  if (diff <= 60_000) return "1 分钟内";
  if (diff < 3_600_000) return `${Math.ceil(diff / 60_000)} 分钟后`;
  if (diff < 86_400_000) return `${Math.ceil(diff / 3_600_000)} 小时后`;
  return `${Math.ceil(diff / 86_400_000)} 天后`;
}
