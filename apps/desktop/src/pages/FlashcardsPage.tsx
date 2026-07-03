// Review queue: FSRS-due cards, flip-to-reveal, four-grade rating.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FlashcardsRepo, Rating, type DueCard } from "@aurascholar/db/repos/flashcards";
import { Badge, Button, Card } from "@aurascholar/ui";
import { getDb } from "../services/aura-db";
import { InlineNotice } from "../components/InlineNotice";
import { isDesktopRuntime } from "../services/aura-platform";

interface StudyStats {
  total: number;
  due: number;
  newDue: number;
  reviewedToday: number;
}

const EMPTY_STATS: StudyStats = {
  total: 0,
  due: 0,
  newDue: 0,
  reviewedToday: 0,
};
const MIN_FLASHCARD_RATING_BUSY_MS = 250;

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

function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="menuitem"]',
    ),
  );
}

export function FlashcardsPage() {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<DueCard[]>([]);
  const [stats, setStats] = useState<StudyStats>(EMPTY_STATS);
  const [revealed, setRevealed] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [activeRating, setActiveRating] = useState<Rating | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const ratingBusyRef = useRef(false);

  const refresh = useCallback(async (options: { clearMessage?: boolean; showLoading?: boolean } = {}) => {
    const clearMessage = options.clearMessage ?? true;
    const showLoading = options.showLoading ?? true;
    if (!isDesktopRuntime()) {
      setQueue([]);
      setStats(EMPTY_STATS);
      setRevealed(false);
      setLoading(false);
      setMessage((current) => current ?? "浏览器预览无法读取本地闪卡队列，请在桌面应用中复习。");
      return false;
    }
    if (showLoading) setLoading(true);
    try {
      const db = await getDb();
      const repo = new FlashcardsRepo(db);
      const now = Date.now();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const [dueCards, dueTotal, totalRows, newDueRows, reviewedRows] = await Promise.all([
        repo.dueCards(50, now),
        repo.countDue(now),
        db.query<{ n: number }>(`SELECT COUNT(*) AS n FROM flashcards WHERE deleted_at IS NULL`),
        db.query<{ n: number }>(
          `SELECT COUNT(*) AS n
           FROM flashcards f JOIN flashcard_srs s ON s.flashcard_id = f.id
           WHERE f.deleted_at IS NULL AND s.due_at <= ? AND s.reps = 0`,
          [now],
        ),
        db.query<{ n: number }>(
          `SELECT COUNT(*) AS n FROM flashcard_reviews WHERE reviewed_at >= ?`,
          [todayStart.getTime()],
        ),
      ]);
      setQueue(dueCards);
      setStats({
        total: totalRows[0]?.n ?? 0,
        due: dueTotal,
        newDue: newDueRows[0]?.n ?? 0,
        reviewedToday: reviewedRows[0]?.n ?? 0,
      });
      setRevealed(false);
      if (clearMessage) setMessage(null);
      return true;
    } catch (e) {
      setMessage(`读取闪卡失败:${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current = queue[0] ?? null;
  const progress = useMemo(() => {
    const started = reviewedCount + queue.length;
    if (started === 0) return 100;
    return Math.round((reviewedCount / started) * 100);
  }, [queue.length, reviewedCount]);

  const rate = useCallback(
    async (rating: Rating) => {
      if (!current || ratingBusyRef.current || !isDesktopRuntime()) return;
      const startedAt = Date.now();
      ratingBusyRef.current = true;
      setRatingBusy(true);
      setActiveRating(rating);
      try {
        const db = await getDb();
        await new FlashcardsRepo(db).review(current.id, rating);
        setReviewedCount((n) => n + 1);
        await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_RATING_BUSY_MS);
        const refreshed = await refresh({ clearMessage: false, showLoading: false });
        if (refreshed) setMessage(ratingMessage(rating));
      } catch (e) {
        await waitForMinimumElapsed(startedAt, MIN_FLASHCARD_RATING_BUSY_MS);
        setMessage(`保存复习结果失败:${e instanceof Error ? e.message : String(e)}`);
      } finally {
        ratingBusyRef.current = false;
        setRatingBusy(false);
        setActiveRating(null);
      }
    },
    [current, refresh],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isInteractiveShortcutTarget(e.target)) return;
      if (e.code === "Space" && current && !ratingBusyRef.current) {
        e.preventDefault();
        setRevealed((v) => !v);
        return;
      }
      if (revealed && current && !ratingBusyRef.current) {
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

      <InlineNotice className="study-message" message={message} />

      {loading ? (
        <Card className="study-empty">
          <Badge variant="neutral">Loading</Badge>
          <p>正在读取复习队列</p>
        </Card>
      ) : !current ? (
        <StudyEmptyState
          reviewedCount={reviewedCount}
          hasCards={stats.total > 0}
          onOpenLibrary={() => navigate("/library")}
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
              aria-disabled={ratingBusy || undefined}
              aria-pressed={revealed}
              onClick={() => {
                if (!ratingBusy) setRevealed((v) => !v);
              }}
              onKeyDown={(event) => {
                if (ratingBusy) return;
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
                      disabled={ratingBusy}
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
            <Card>
              <h2>快捷键</h2>
              <StatusLine label="翻面" value="Space" />
              <StatusLine label="评分" value="1 / 2 / 3 / 4" />
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}

function StudyEmptyState({
  reviewedCount,
  hasCards,
  onOpenLibrary,
}: {
  reviewedCount: number;
  hasCards: boolean;
  onOpenLibrary: () => void;
}) {
  const complete = reviewedCount > 0;
  return (
    <Card className="study-empty">
      <Badge variant={complete ? "success" : "neutral"}>
        {complete ? "今日完成" : hasCards ? "暂未到期" : "队列为空"}
      </Badge>
      <p>{complete ? "本轮复习完成" : hasCards ? "现在没有待复习卡片" : "还没有闪卡"}</p>
      <p className="au-text-muted">
        {hasCards
          ? "下一批卡片会按 FSRS 间隔自动回到队列。"
          : "从文献库选择一篇 PDF 生成 AI 重点后，卡片会进入复习队列。"}
      </p>
      <Button variant="secondary" onClick={onOpenLibrary}>
        去文献库
      </Button>
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
