import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  estimateVectorIndexCapacity,
  fitsVectorIndexQuota,
  type VectorStoragePrecision,
} from "@aurascholar/knowledge";
import type { KnowledgeContentIndexStats } from "../../services/knowledge-index-stats";
import { getKnowledgeContentIndexStats } from "../../services/knowledge-index-stats";
import { describeSafeError } from "../../services/sensitive-text";

export const VECTOR_INDEX_PLAN_DIMENSIONS = [384, 768, 1_536] as const;

const VECTOR_INDEX_QUOTA_OPTIONS = [
  { bytes: 512 * 1024 * 1024, label: "512 MiB" },
  { bytes: 1024 * 1024 * 1024, label: "1 GiB" },
  { bytes: 2 * 1024 * 1024 * 1024, label: "2 GiB" },
  { bytes: 5 * 1024 * 1024 * 1024, label: "5 GiB" },
] as const;

type VectorIndexPlanDimension = (typeof VECTOR_INDEX_PLAN_DIMENSIONS)[number];
type IndexStatsLoadState = "error" | "idle" | "loading" | "ready";

export interface KnowledgeIndexPlannerProps {
  enabled: boolean;
}

/**
 * Local-only capacity planning for a future semantic index. It deliberately
 * owns no model selection, persistence setting, or vector-store adapter.
 */
export function KnowledgeIndexPlanner({ enabled }: KnowledgeIndexPlannerProps) {
  const [stats, setStats] = useState<KnowledgeContentIndexStats | null>(null);
  const [loadState, setLoadState] = useState<IndexStatsLoadState>(enabled ? "loading" : "idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dimension, setDimension] = useState<VectorIndexPlanDimension>(768);
  const [precision, setPrecision] = useState<VectorStoragePrecision>("float32");
  const [quotaBytes, setQuotaBytes] = useState<number>(VECTOR_INDEX_QUOTA_OPTIONS[1].bytes);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void getKnowledgeContentIndexStats({ signal: controller.signal })
      .then((nextStats) => {
        if (controller.signal.aborted) return;
        setStats(nextStats);
        setLoadError(null);
        setLoadState("ready");
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setStats(null);
        setLoadError(`无法读取本地索引统计：${describeSafeError(cause)}`);
        setLoadState("error");
      });
    return () => controller.abort();
  }, [enabled]);

  return (
    <section
      className={`knowledge-index-planner${enabled ? "" : " knowledge-index-planner--unavailable"}`}
      aria-labelledby="knowledge-index-planner-title"
      data-knowledge-index-planner
    >
      <div className="knowledge-index-planner__heading">
        <div>
          <p>Semantic index</p>
          <h2 id="knowledge-index-planner-title">语义索引规划</h2>
          <span>基于本机资料库估算空间；不会下载模型、创建向量库或上传资料。</span>
        </div>
        <span className="knowledge-index-planner__scope" aria-label="当前状态：仅规划，未创建索引">
          仅规划
        </span>
      </div>

      {enabled ? (
        <>
          <div className="knowledge-index-planner__controls">
            <PlannerSelect
              label="嵌入维度"
              ariaLabel="选择语义索引嵌入维度"
              value={String(dimension)}
              onChange={(value) => {
                const nextDimension = Number(value);
                if (isVectorIndexPlanDimension(nextDimension)) setDimension(nextDimension);
              }}
            >
              {VECTOR_INDEX_PLAN_DIMENSIONS.map((option) => (
                <option key={option} value={option}>
                  {option} 维
                </option>
              ))}
            </PlannerSelect>
            <PlannerSelect
              label="向量存储"
              ariaLabel="选择语义索引向量存储精度"
              value={precision}
              onChange={(value) => {
                if (value === "float32" || value === "int8") setPrecision(value);
              }}
            >
              <option value="float32">Float32（原始精度）</option>
              <option value="int8">Int8（压缩估算）</option>
            </PlannerSelect>
            <PlannerSelect
              label="磁盘配额"
              ariaLabel="选择语义索引磁盘配额"
              value={String(quotaBytes)}
              onChange={(value) => {
                const nextQuota = Number(value);
                if (VECTOR_INDEX_QUOTA_OPTIONS.some((option) => option.bytes === nextQuota)) {
                  setQuotaBytes(nextQuota);
                }
              }}
            >
              {VECTOR_INDEX_QUOTA_OPTIONS.map((option) => (
                <option key={option.bytes} value={option.bytes}>
                  {option.label}
                </option>
              ))}
            </PlannerSelect>
          </div>

          {loadState === "loading" ? (
            <p className="knowledge-index-planner__feedback" role="status">
              正在读取本机资料库片段统计…
            </p>
          ) : null}
          {loadState === "error" && loadError ? (
            <p className="knowledge-index-planner__feedback" role="alert">
              {loadError}
            </p>
          ) : null}
          {stats ? (
            <KnowledgeIndexPlanSummary
              stats={stats}
              dimension={dimension}
              precision={precision}
              quotaBytes={quotaBytes}
            />
          ) : null}
        </>
      ) : (
        <p className="knowledge-index-planner__feedback">
          语义索引规划需要 AuraScholar 桌面应用中的本地资料库。
        </p>
      )}
    </section>
  );
}

export function KnowledgeIndexPlanSummary({
  stats,
  dimension,
  precision,
  quotaBytes,
}: {
  stats: KnowledgeContentIndexStats;
  dimension: VectorIndexPlanDimension;
  precision: VectorStoragePrecision;
  quotaBytes: number;
}) {
  const estimate = useMemo(
    () =>
      estimateVectorIndexCapacity({
        contentUnitCount: stats.readyContentUnits,
        dimension,
        precision,
      }),
    [dimension, precision, stats.readyContentUnits],
  );
  const fitsQuota = fitsVectorIndexQuota(estimate, quotaBytes);
  const languageCoverage = describeLanguagePreferenceCoverage(stats);

  return (
    <div className="knowledge-index-planner__summary" aria-live="polite">
      <p className="knowledge-index-planner__corpus">
        按 <strong>{stats.readyContentUnits.toLocaleString()}</strong> 个可直接引用的片段估算；
        {stats.contextOnlyContentUnits > 0
          ? `${stats.contextOnlyContentUnits.toLocaleString()} 个仅上下文片段不计入语义索引。`
          : "当前没有仅上下文片段。"}
      </p>
      <p className="knowledge-index-planner__language-coverage">{languageCoverage}</p>
      <dl className="knowledge-index-planner__metrics">
        <div>
          <dt>原始向量</dt>
          <dd>{formatBinaryBytes(estimate.rawVectorBytes)}</dd>
        </div>
        <div>
          <dt>索引与元数据</dt>
          <dd>{formatBinaryBytes(estimate.indexOverheadBytes + estimate.metadataBytes)}</dd>
        </div>
        <div>
          <dt>预计总量</dt>
          <dd>{formatBinaryBytes(estimate.totalBytes)}</dd>
        </div>
        <div>
          <dt>当前来源</dt>
          <dd>
            PDF {stats.sourceCounts.pdf} · 批注 {stats.sourceCounts.annotation} · Evidence{" "}
            {stats.sourceCounts.evidence}
          </dd>
        </div>
      </dl>
      <p
        className={`knowledge-index-planner__quota ${
          fitsQuota
            ? "knowledge-index-planner__quota--fits"
            : "knowledge-index-planner__quota--exceeds"
        }`}
        role={fitsQuota ? "status" : "alert"}
      >
        {fitsQuota
          ? `预计在 ${formatBinaryBytes(quotaBytes)} 磁盘配额内。`
          : `预计超过 ${formatBinaryBytes(quotaBytes)} 磁盘配额；可降低维度、选用压缩存储或提高配额。`}
      </p>
      <p className="knowledge-index-planner__assumption">
        此估算预留 50% 索引开销和每片段元数据；最终占用会随所选本地引擎而变化。
      </p>
    </div>
  );
}

function PlannerSelect({
  label,
  ariaLabel,
  value,
  onChange,
  children,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="knowledge-index-planner__control">
      <span>{label}</span>
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

export function formatBinaryBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unitIndex]}`;
}

export function describeLanguagePreferenceCoverage(stats: KnowledgeContentIndexStats): string {
  if (stats.readyContentUnits === 0) {
    return "尚无可直接引用片段；导入并完成内容提取后，才能评估中文/英文资料偏好的语种标注覆盖率。";
  }

  const { en, missing, other, zh } = stats.languageCoverage;
  const supported = zh + en;
  if (supported === stats.readyContentUnits) {
    return `全部 ${stats.readyContentUnits.toLocaleString()} 个可直接引用片段均带有可用于中文/英文资料偏好的语种标签。`;
  }

  const gaps: string[] = [];
  if (missing > 0) gaps.push(`${missing.toLocaleString()} 个未标注`);
  if (other > 0) gaps.push(`${other.toLocaleString()} 个为当前未支持的其他语种`);
  return `中文/英文资料偏好可识别 ${supported.toLocaleString()} / ${stats.readyContentUnits.toLocaleString()} 个可直接引用片段；${gaps.join("，")}。未标注或其他语种候选仍会保留在结果中，但不会获得语言偏好加权。`;
}

function isVectorIndexPlanDimension(value: number): value is VectorIndexPlanDimension {
  return VECTOR_INDEX_PLAN_DIMENSIONS.includes(value as VectorIndexPlanDimension);
}
