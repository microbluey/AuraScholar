import { useEffect, useState } from "react";
import "./knowledge-index-controls.css";
import { Button } from "@aurascholar/ui";
import {
  buildKnowledgeSemanticIndex,
  getKnowledgeSemanticIndexStatus,
  type KnowledgeSemanticIndexStatus,
} from "../../services/knowledge-semantic-index";
import { describeSafeError } from "../../services/sensitive-text";

type LoadState = "error" | "idle" | "loading" | "ready";

export interface LocalSemanticIndexControlProps {
  enabled: boolean;
}

/**
 * Explicitly starts and observes the fixed local semantic-index generation.
 * Installing a model alone does not consume CPU or create vector data.
 */
export function LocalSemanticIndexControl({ enabled }: LocalSemanticIndexControlProps) {
  const [status, setStatus] = useState<KnowledgeSemanticIndexStatus | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(enabled ? "loading" : "idle");
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const refresh = async () => {
      try {
        const next = await getKnowledgeSemanticIndexStatus();
        if (!active) return;
        setStatus(next);
        setLoadState("ready");
      } catch (error) {
        if (!active) return;
        setLoadState("error");
        setNotice(`无法读取语义索引状态：${describeSafeError(error)}`);
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [enabled]);

  const start = async () => {
    if (!enabled || starting) return;
    setStarting(true);
    setNotice(null);
    try {
      const result = await buildKnowledgeSemanticIndex();
      setStatus((current) => ({
        active: current?.active ?? null,
        building: result.index,
        failed: current?.failed ?? null,
      }));
      setLoadState("ready");
      setNotice(
        result.created ? "语义索引已排队，将在本机后台构建。" : "语义索引已在本机后台构建中。",
      );
    } catch (error) {
      setNotice(`无法开始语义索引：${describeSafeError(error)}`);
    } finally {
      setStarting(false);
    }
  };

  const presentation = describeStatus(enabled, loadState, status);
  const building = status?.building ?? null;
  const buildingCurrent = Boolean(building && !building.stale);

  return (
    <section
      className={`local-semantic-index-control${enabled ? "" : " local-semantic-index-control--unavailable"}`}
      aria-labelledby="local-semantic-index-control-title"
      data-local-semantic-index-control
    >
      <div className="local-semantic-index-control__heading">
        <div>
          <p>Local semantic retrieval</p>
          <h2 id="local-semantic-index-control-title">本地语义索引</h2>
          <span>仅在已安装并校验的本地模型上构建；资料文本不会离开设备。</span>
        </div>
        <span className="local-semantic-index-control__scope">{presentation.badge}</span>
      </div>

      <p className="local-semantic-index-control__summary">{presentation.summary}</p>
      {building ? (
        <p className="local-semantic-index-control__progress" role="status">
          正在索引 {building.indexedCount.toLocaleString()} /{" "}
          {building.expectedCount.toLocaleString()} 个片段。
        </p>
      ) : null}
      {notice ? (
        <p
          className="local-semantic-index-control__notice"
          role={notice.includes("无法") ? "alert" : "status"}
        >
          {notice}
        </p>
      ) : null}
      {enabled ? (
        <div className="local-semantic-index-control__actions">
          <Button
            type="button"
            variant="primary"
            disabled={starting || buildingCurrent || loadState === "loading"}
            aria-busy={starting || undefined}
            onClick={() => void start()}
          >
            {starting
              ? "正在排队..."
              : status?.active || building?.stale
                ? "重新构建语义索引"
                : "创建语义索引"}
          </Button>
          <span>模型未安装或本机向量运行时不可用时，不会创建索引。</span>
        </div>
      ) : (
        <p className="local-semantic-index-control__notice">
          语义索引只能在 AuraScholar 桌面应用中创建。
        </p>
      )}
    </section>
  );
}

function describeStatus(
  enabled: boolean,
  loadState: LoadState,
  status: KnowledgeSemanticIndexStatus | null,
): { badge: string; summary: string } {
  if (!enabled) return { badge: "桌面专属", summary: "浏览器预览不会访问本机模型或向量数据。" };
  if (loadState === "loading") return { badge: "检查中", summary: "正在读取本机语义索引状态。" };
  if (loadState === "error") return { badge: "状态未知", summary: "关键词检索不受此状态影响。" };
  if (status?.building) {
    return status.building.stale
      ? {
          badge: "需重建",
          summary: "资料库在本次构建期间发生变化；该快照不会被激活，请重新创建语义索引。",
        }
      : { badge: "构建中", summary: "新 generation 完整就绪前，仍保留当前可用检索。" };
  }
  if (status?.active) {
    if (status.active.stale) {
      return {
        badge: "需重建",
        summary: "资料库已有新变化，当前 generation 只覆盖旧快照；关键词检索仍可用。",
      };
    }
    return {
      badge: "已就绪",
      summary: `当前 generation 已索引 ${status.active.indexedCount.toLocaleString()} 个本地片段。`,
    };
  }
  if (status?.failed)
    return { badge: "构建失败", summary: "可检查本机模型后重新创建；关键词检索仍可用。" };
  return { badge: "尚未创建", summary: "安装本地模型后，可按需创建一份资料库专属语义索引。" };
}
