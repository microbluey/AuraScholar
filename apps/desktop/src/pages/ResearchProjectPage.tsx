import { CircleNotch, FolderSimplePlus, WarningCircle } from "@phosphor-icons/react";
import { Button } from "@aurascholar/ui";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ResearchProjectWorkspace } from "../features/projects/ResearchProjectWorkspace";
import {
  readLastResearchProjectId,
  rememberLastResearchProjectId,
  researchProjectPath,
  resolveResearchProjectIndexPath,
} from "../features/projects/routes";
import { useResearchProjectController } from "../features/projects/useResearchProjectController";
import {
  researchProjectService,
  type ResearchProjectService,
} from "../services/research-project-service";
import "../features/projects/research-project-workspace.css";
import "../features/projects/research-project-dialog.css";

type LoadPhase = "loading" | "ready" | "error";

export interface ResearchProjectPageProps {
  service?: ResearchProjectService;
}

export function ResearchProjectsIndexPage({
  service = researchProjectService,
}: ResearchProjectPageProps) {
  const navigate = useNavigate();
  const { createProject, loadIndex, snapshot } = useResearchProjectController(service);
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const indexTarget =
    phase === "ready"
      ? resolveResearchProjectIndexPath(snapshot.projects, readLastResearchProjectId())
      : null;

  useEffect(() => {
    let current = true;
    void loadIndex().then((result) => {
      if (current && result.status !== "stale") {
        setPhase(result.status === "completed" ? "ready" : "error");
      }
    });
    return () => {
      current = false;
    };
  }, [loadIndex]);

  useEffect(() => {
    if (phase !== "ready" || snapshot.loading || snapshot.requestedProjectId !== null) return;
    if (indexTarget) navigate(indexTarget, { replace: true });
  }, [indexTarget, navigate, phase, snapshot.loading, snapshot.requestedProjectId]);

  if (phase === "error") {
    return (
      <ProjectRouteState
        tone="error"
        title="研究项目暂时无法载入"
        description={snapshot.error ?? "请检查桌面数据服务后重试。"}
        actionLabel="重新载入"
        onAction={() => {
          setPhase("loading");
          void loadIndex().then((result) =>
            setPhase(result.status === "completed" ? "ready" : "error"),
          );
        }}
      />
    );
  }

  if (phase === "ready" && !indexTarget) {
    return (
      <ProjectRouteState
        tone="empty"
        title="创建第一个研究项目"
        description="项目会把相关文献组织成清晰的研究范围，同时保留文献库原始资产。"
        actionLabel="创建“研究项目”"
        onAction={() => {
          void createProject("研究项目").then((result) => {
            if (result.status === "completed" && result.project) {
              navigate(researchProjectPath(result.project.id), { replace: true });
            }
          });
        }}
      />
    );
  }

  return (
    <ProjectRouteState
      tone="loading"
      title="正在打开研究项目"
      description={
        service.mode === "preview"
          ? "浏览器预览会载入可交互的会话级示例数据。"
          : "正在恢复你最近使用的项目。"
      }
    />
  );
}

export function ResearchProjectPage({
  service = researchProjectService,
}: ResearchProjectPageProps) {
  const navigate = useNavigate();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId?.trim() ?? "";
  const {
    addWorks,
    createProject,
    dismissFeedback,
    loadProject,
    removeWork,
    renameProject,
    snapshot,
  } = useResearchProjectController(service);
  const [phase, setPhase] = useState<LoadPhase>("loading");

  useEffect(() => {
    if (!projectId) {
      navigate("/projects", { replace: true });
      return;
    }
    let current = true;
    void loadProject(projectId).then((result) => {
      if (current && result.status !== "stale") {
        setPhase(result.status === "completed" ? "ready" : "error");
      }
    });
    return () => {
      current = false;
    };
  }, [loadProject, navigate, projectId]);

  const project =
    snapshot.project?.id === projectId && snapshot.project.status === "active"
      ? snapshot.project
      : null;
  const requestComplete =
    phase === "ready" && !snapshot.loading && snapshot.requestedProjectId === projectId;
  const fallback =
    requestComplete && !project ? resolveResearchProjectIndexPath(snapshot.projects, null) : null;

  useEffect(() => {
    if (requestComplete && project) rememberLastResearchProjectId(project.id);
  }, [project, requestComplete]);

  useEffect(() => {
    if (fallback) navigate(fallback, { replace: true });
  }, [fallback, navigate]);

  if (phase === "error" && snapshot.requestedProjectId === projectId) {
    return (
      <ProjectRouteState
        tone="error"
        title="无法打开这个研究项目"
        description={snapshot.error ?? "项目可能已归档，或当前数据源暂时不可用。"}
        actionLabel="重试"
        onAction={() => {
          setPhase("loading");
          void loadProject(projectId).then((result) =>
            setPhase(result.status === "completed" ? "ready" : "error"),
          );
        }}
      />
    );
  }

  if (!requestComplete || (!project && fallback)) {
    return (
      <ProjectRouteState
        tone="loading"
        title="正在载入项目工作区"
        description="正在确认项目范围与来源成员关系。"
      />
    );
  }

  if (!project) {
    return (
      <ProjectRouteState
        tone="empty"
        title="没有可打开的研究项目"
        description="创建一个项目，开始组织课题相关的文献来源。"
        actionLabel="新建研究项目"
        onAction={() => {
          void createProject("研究项目").then((result) => {
            if (result.status === "completed" && result.project) {
              navigate(researchProjectPath(result.project.id), { replace: true });
            }
          });
        }}
      />
    );
  }

  return (
    <ResearchProjectWorkspace
      busyAction={snapshot.busyAction}
      error={snapshot.error}
      message={snapshot.message}
      onAddWorks={async (workIds) => (await addWorks(workIds)).status === "completed"}
      onCreate={async (name) => {
        const result = await createProject(name);
        if (result.status === "completed" && result.project) {
          navigate(researchProjectPath(result.project.id));
          return true;
        }
        return false;
      }}
      onDismissFeedback={dismissFeedback}
      onOpenSource={(workId) => navigate(`/reader?work=${encodeURIComponent(workId)}`)}
      onRemoveWork={async (workId) => (await removeWork(workId)).status === "completed"}
      onRename={async (name) => (await renameProject(name)).status === "completed"}
      onSelect={(nextProjectId) => navigate(researchProjectPath(nextProjectId))}
      previewMode={service.mode === "preview"}
      project={project}
      projects={snapshot.projects}
      service={service}
      sources={snapshot.sources}
    />
  );
}

function ProjectRouteState({
  actionLabel,
  description,
  onAction,
  title,
  tone,
}: {
  actionLabel?: string;
  description: string;
  onAction?: () => void;
  title: string;
  tone: "empty" | "error" | "loading";
}) {
  return (
    <main className="research-project-route-state" aria-busy={tone === "loading"}>
      <section>
        <span
          className={`research-project-route-state__icon research-project-route-state__icon--${tone}`}
        >
          {tone === "loading" ? (
            <CircleNotch className="research-project-spin" size={28} />
          ) : tone === "error" ? (
            <WarningCircle size={28} weight="duotone" />
          ) : (
            <FolderSimplePlus size={28} weight="duotone" />
          )}
        </span>
        <h1>{title}</h1>
        <p>{description}</p>
        {actionLabel && onAction && (
          <Button type="button" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </section>
    </main>
  );
}
