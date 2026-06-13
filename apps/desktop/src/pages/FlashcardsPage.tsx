// Review queue: FSRS-due cards, flip-to-reveal, four-grade rating.
import { useCallback, useEffect, useState } from "react";
import { FlashcardsRepo, Rating, type DueCard } from "@aurascholar/db";
import { Badge, Button, Card } from "@aurascholar/ui";
import { getDb } from "../services/tauri-db";

export function FlashcardsPage() {
  const [queue, setQueue] = useState<DueCard[]>([]);
  const [revealed, setRevealed] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!("__TAURI_INTERNALS__" in window)) {
      setQueue([]);
      setRevealed(false);
      return;
    }
    const db = await getDb();
    setQueue(await new FlashcardsRepo(db).dueCards(50));
    setRevealed(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const current = queue[0] ?? null;

  const rate = useCallback(
    async (rating: Rating) => {
      if (!current) return;
      const db = await getDb();
      await new FlashcardsRepo(db).review(current.id, rating);
      setReviewedCount((n) => n + 1);
      await refresh();
    },
    [current, refresh],
  );

  // Keyboard: space = flip, 1-4 = rate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        setRevealed((v) => !v);
      } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        const map: Record<string, Rating> = {
          "1": Rating.Again,
          "2": Rating.Hard,
          "3": Rating.Good,
          "4": Rating.Easy,
        };
        void rate(map[e.key]!);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, rate]);

  return (
    <div className="study-page">
      <p className="app-page-kicker">AI digest to memory</p>
      <h1 className="app-page-title">闪卡复习</h1>
      <p className="app-page-subtitle">
        FSRS 间隔重复 · 今日待复习 {queue.length} 张
        {reviewedCount > 0 && ` · 本次已复习 ${reviewedCount} 张`}
      </p>

      {!current ? (
        <Card className="study-empty">
          <Badge variant={reviewedCount > 0 ? "success" : "neutral"}>
            {reviewedCount > 0 ? "今日完成" : "队列为空"}
          </Badge>
          <p>{reviewedCount > 0 ? "今日复习完成" : "暂无待复习的卡片"}</p>
          <p className="au-text-muted" style={{ fontSize: 13 }}>
            在文献库中对一篇文献生成 AI 闪卡,新卡片会立即进入复习队列
          </p>
        </Card>
      ) : (
        <div className="study-review">
          <Card
            className="study-card"
            onClick={() => setRevealed((v) => !v)}
          >
            <div className="study-card__meta">
              <Badge variant="neutral">{current.card_type}</Badge>
              {current.source === "ai" && <Badge>AI</Badge>}
              <span className="au-kbd">Space</span>
            </div>
            <div className="study-card__front">{current.front_md}</div>
            {revealed && (
              <>
                <hr className="study-card__divider" />
                <div className="study-card__back">{current.back_md}</div>
              </>
            )}
            {!revealed && (
              <p className="au-text-muted" style={{ fontSize: 12, marginTop: 24, marginBottom: 0 }}>
                点击或按空格显示答案
              </p>
            )}
          </Card>

          {revealed && (
            <div className="study-rating">
              <Button variant="danger" onClick={() => void rate(Rating.Again)}>
                忘了 (1)
              </Button>
              <Button variant="secondary" onClick={() => void rate(Rating.Hard)}>
                困难 (2)
              </Button>
              <Button onClick={() => void rate(Rating.Good)}>记得 (3)</Button>
              <Button variant="secondary" onClick={() => void rate(Rating.Easy)}>
                轻松 (4)
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
