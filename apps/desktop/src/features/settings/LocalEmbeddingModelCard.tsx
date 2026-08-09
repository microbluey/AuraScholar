import { useEffect, useState } from "react";
import { Badge, Button, Card } from "@aurascholar/ui";
import { InlineNotice } from "../../components/InlineNotice";
import { useConfirmDialog } from "../../components/ConfirmDialog";
import {
  getLocalEmbeddingArtifactCatalogStatus,
  getLocalEmbeddingArtifactStatus,
  installLocalEmbeddingArtifact,
  removeLocalEmbeddingArtifact,
  type LocalEmbeddingArtifactCatalogStatus,
  type LocalEmbeddingArtifactStatus,
} from "../../services/local-embedding-artifact";
import { describeSafeError } from "../../services/sensitive-text";

type ArtifactLoadState = "error" | "loading" | "not-supported" | "ready";

export interface LocalEmbeddingModelCardProps {
  enabled: boolean;
}

/**
 * The install control appears only for a complete catalog entry and performs
 * separate license/download confirmations. Its bridge has no source or file
 * inputs, so this card cannot construct a network path from renderer data.
 */
export function LocalEmbeddingModelCard({ enabled }: LocalEmbeddingModelCardProps) {
  const { confirm, confirmDialog } = useConfirmDialog();
  const [catalogStatus, setCatalogStatus] = useState<LocalEmbeddingArtifactCatalogStatus | null>(
    null,
  );
  const [artifactStatus, setArtifactStatus] = useState<LocalEmbeddingArtifactStatus | null>(null);
  const [loadState, setLoadState] = useState<ArtifactLoadState>(
    enabled ? "loading" : "not-supported",
  );
  const [installing, setInstalling] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void getLocalEmbeddingArtifactStatus()
      .then((status) => {
        if (!active) return;
        setArtifactStatus(status);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setArtifactStatus(null);
        setLoadState("error");
        setNotice(`无法读取本地模型状态：${describeSafeError(error)}`);
      });
    void getLocalEmbeddingArtifactCatalogStatus()
      .then((status) => {
        if (active) setCatalogStatus(status);
      })
      .catch(() => {
        // The catalog is informational while installation is disabled. Keep
        // the artifact-status path usable if this extra read fails.
      });
    return () => {
      active = false;
    };
  }, [enabled, refreshSequence]);

  const requestRemoval = async () => {
    const confirmed = await confirm({
      confirmLabel: "删除本地模型",
      description: "这会删除本机已安装的嵌入模型文件，不会删除资料库、PDF 或关键词索引。",
      details: ["语义索引在重新安装并重建前不可用。", "已建立的向量数据不会在此操作中上传。"],
      eyebrow: "本地模型",
      title: "删除本地语义模型？",
      tone: "danger",
    });
    if (!confirmed) return;
    setRemoving(true);
    setNotice(null);
    try {
      const result = await removeLocalEmbeddingArtifact();
      setArtifactStatus(result.status);
      setLoadState("ready");
      setNotice(result.removed ? "已删除本地模型文件。" : "本地模型文件本就不存在。");
    } catch (error) {
      setNotice(`删除本地模型失败：${describeSafeError(error)}`);
    } finally {
      setRemoving(false);
    }
  };

  const requestInstallation = async () => {
    const catalog = catalogStatus;
    if (!enabled || catalog?.state !== "available") return;

    const acceptedLicense = await confirm({
      cancelLabel: "暂不安装",
      confirmationHelp: <>输入“接受”以确认你接受 {catalog.license.label}。</>,
      confirmationPhrase: "接受",
      confirmLabel: "接受许可证",
      description: `安装此本地模型前，请先确认 ${catalog.license.label} 的许可条款。`,
      details: [
        "模型仅安装在本机；资料库、PDF 和查询文本不会因安装而上传。",
        "许可证接受与下载批准会随该模型的本机安装记录保存。",
      ],
      eyebrow: "本地模型许可证",
      title: "接受模型许可证？",
      tone: "warning",
    });
    if (!acceptedLicense) return;

    const approvedDownload = await confirm({
      cancelLabel: "暂不下载",
      confirmationHelp: <>输入“下载”以确认下载并校验此固定版本。</>,
      confirmationPhrase: "下载",
      confirmLabel: "下载并安装",
      description: `将下载 ${formatBinaryBytes(catalog.artifact.totalBytes)} 的已校验本地模型。`,
      details: [
        "下载只会使用已固定的仓库、提交和 SHA-256 文件清单。",
        "任何网络、长度或校验错误都会清理暂存文件，不会启用不完整模型。",
      ],
      eyebrow: "确认下载",
      title: "下载本地语义模型？",
      tone: "warning",
    });
    if (!approvedDownload) return;

    setInstalling(true);
    setNotice(null);
    try {
      const result = await installLocalEmbeddingArtifact();
      setArtifactStatus(result.status);
      setLoadState("ready");
      setNotice(
        result.alreadyInstalled ? "当前已安装并校验此模型版本。" : "本地模型已下载并校验。",
      );
    } catch (error) {
      setNotice(`下载本地模型失败：${describeSafeError(error)}`);
    } finally {
      setInstalling(false);
    }
  };

  const presentation = describeArtifactStatus(enabled, loadState, artifactStatus);
  const catalogPresentation = describeCatalogStatus(catalogStatus);
  const artifactMatchesCatalog = installedArtifactMatchesCatalog(artifactStatus, catalogStatus);
  const canOfferInstallation =
    enabled &&
    loadState === "ready" &&
    catalogStatus?.state === "available" &&
    !artifactMatchesCatalog;

  return (
    <>
      <Card
        className="settings-card settings-card--compact"
        data-settings-section="local-model"
        tabIndex={-1}
      >
        <div className="settings-card__head">
          <div>
            <h2>本地语义模型</h2>
            <p>候选模型仅在本机运行；资料不会因查看或管理模型状态而上传。</p>
          </div>
          <div className="settings-card__badges">
            <Badge variant={presentation.badgeVariant}>{presentation.badge}</Badge>
          </div>
        </div>

        <div className={`settings-backup-safety settings-backup-safety--${presentation.tone}`}>
          <div>
            <span>候选模型</span>
            <strong>multilingual-e5-small</strong>
            <small>384 维 · E5 query/passage</small>
          </div>
          <div>
            <span>本机状态</span>
            <strong>{presentation.title}</strong>
            <small>{presentation.detail}</small>
          </div>
          <div>
            <span>下载策略</span>
            <strong>{catalogPresentation.title}</strong>
            <small>{catalogPresentation.detail}</small>
          </div>
        </div>

        <InlineNotice
          message={
            catalogStatus?.state === "available"
              ? "安装前必须依次确认许可证和下载；不会自动下载模型。"
              : "当前版本不会自动下载模型；完整文件清单、许可确认与下载入口准备完成后才会开放安装。"
          }
          tone="neutral"
        />
        <InlineNotice message={notice} tone={notice?.includes("失败") ? "danger" : "neutral"} />

        {enabled && (
          <div className="settings-theme-options">
            {canOfferInstallation ? (
              <Button
                type="button"
                variant="primary"
                disabled={installing || removing}
                aria-busy={installing || undefined}
                onClick={() => void requestInstallation()}
              >
                {installing ? "下载并校验中..." : "下载并安装"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              disabled={loadState === "loading" || installing || removing}
              onClick={() => {
                setNotice(null);
                setLoadState("loading");
                setRefreshSequence((value) => value + 1);
              }}
            >
              {loadState === "loading" ? "正在检查..." : "刷新状态"}
            </Button>
            {artifactStatus?.state === "ready" || artifactStatus?.state === "corrupt" ? (
              <Button
                type="button"
                variant="danger"
                disabled={installing || removing || loadState === "loading"}
                aria-busy={removing || undefined}
                onClick={() => void requestRemoval()}
              >
                {removing ? "删除中..." : "删除本地模型"}
              </Button>
            ) : null}
          </div>
        )}
      </Card>
      {confirmDialog}
    </>
  );
}

function describeCatalogStatus(status: LocalEmbeddingArtifactCatalogStatus | null): {
  detail: string;
  title: string;
} {
  if (!status || status.state === "incomplete-manifest") {
    const license = status?.license.label ?? "许可证待确认";
    return { detail: `${license} · 等待完整 SHA-256 清单固定`, title: "暂未开放" };
  }
  return {
    detail: `${status.license.label} · ${formatBinaryBytes(status.artifact.totalBytes)} · 等待许可确认与下载入口`,
    title: "清单已固定",
  };
}

function describeArtifactStatus(
  enabled: boolean,
  loadState: ArtifactLoadState,
  status: LocalEmbeddingArtifactStatus | null,
): {
  badge: string;
  badgeVariant: "danger" | "neutral" | "success" | "warning";
  detail: string;
  title: string;
  tone: "ready" | "warning";
} {
  if (!enabled) {
    return {
      badge: "桌面专属",
      badgeVariant: "neutral",
      detail: "浏览器预览不会访问本机模型目录",
      title: "不可用",
      tone: "warning",
    };
  }
  if (loadState === "loading") {
    return {
      badge: "检查中",
      badgeVariant: "neutral",
      detail: "正在读取本机已验证的安装状态",
      title: "正在检查",
      tone: "warning",
    };
  }
  if (loadState === "error" || !status) {
    return {
      badge: "读取失败",
      badgeVariant: "warning",
      detail: "可重试读取；资料库和关键词索引不受影响",
      title: "状态未知",
      tone: "warning",
    };
  }
  if (status.state === "ready") {
    return {
      badge: "已验证",
      badgeVariant: "success",
      detail: `${formatBinaryBytes(status.artifact.totalBytes)} · ${status.artifact.modelRevision.slice(0, 8)}`,
      title: "本机可用",
      tone: "ready",
    };
  }
  if (status.state === "corrupt") {
    return {
      badge: "需处理",
      badgeVariant: "warning",
      detail: "模型目录未通过完整性校验；可删除后重新安装",
      title: "校验失败",
      tone: "warning",
    };
  }
  return {
    badge: "未安装",
    badgeVariant: "neutral",
    detail: "关键词检索仍可正常使用",
    title: "尚未安装",
    tone: "warning",
  };
}

function installedArtifactMatchesCatalog(
  artifactStatus: LocalEmbeddingArtifactStatus | null,
  catalogStatus: LocalEmbeddingArtifactCatalogStatus | null,
): boolean {
  return (
    artifactStatus?.state === "ready" &&
    catalogStatus?.state === "available" &&
    artifactStatus.artifact.manifestSha256 === catalogStatus.artifact.manifestSha256 &&
    artifactStatus.artifact.modelRevision === catalogStatus.artifact.modelRevision
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
