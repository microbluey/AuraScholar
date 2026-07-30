import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { DiscoveryResultWithLibrary } from "../../services/discovery";
import type { IngestResult } from "../../services/library-types";
import { describeSafeError } from "../../services/sensitive-text";
import { createDiscoveryImportController } from "./discovery-import-controller";
import { discoveryImportMessage, sameDiscoveryResultIdentity } from "./discovery-result-model";

const MIN_DISCOVERY_IMPORT_BUSY_MS = 350;

export interface UseDiscoveryResultImportControllerOptions {
  desktopRuntime: boolean;
  hasResult(result: DiscoveryResultWithLibrary): boolean;
  onMessage(message: string): void;
  results: readonly DiscoveryResultWithLibrary[];
  selectResult(id: string): void;
  updateResultByIdentity(
    result: DiscoveryResultWithLibrary,
    updater: (current: DiscoveryResultWithLibrary) => DiscoveryResultWithLibrary,
  ): string | null;
}

export function useDiscoveryResultImportController(
  options: UseDiscoveryResultImportControllerOptions,
) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const pendingResultsRef = useRef<
    Array<{ imported: IngestResult; result: DiscoveryResultWithLibrary }>
  >([]);

  const controllerRef = useRef<ReturnType<
    typeof createDiscoveryImportController<DiscoveryResultWithLibrary, IngestResult>
  > | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = createDiscoveryImportController({
      isSameResult: sameDiscoveryResultIdentity,
      onStarted: (result) => {
        const current = optionsRef.current;
        current.onMessage(
          current.desktopRuntime
            ? result.work.oaPdfUrl
              ? "正在加入文献库并获取开放 PDF..."
              : "正在加入文献库..."
            : "正在演示入库状态...",
        );
      },
      persist: async (result) => {
        const startedAt = Date.now();
        try {
          if (!optionsRef.current.desktopRuntime) {
            const previewResult: IngestResult = {
              workId: `preview-library:${result.id}`,
              deduped: false,
              title: result.work.title,
              pdfFetched: Boolean(result.work.oaPdfUrl),
            };
            await waitForMinimumElapsed(startedAt);
            return previewResult;
          }
          const { importDiscoveryResult } = await import("../../services/discovery");
          const imported = await importDiscoveryResult(result.work);
          await waitForMinimumElapsed(startedAt);
          return imported;
        } catch (error) {
          await waitForMinimumElapsed(startedAt);
          throw error;
        }
      },
      onPersisted: () => {
        if (optionsRef.current.desktopRuntime) {
          window.dispatchEvent(new Event("aurascholar:library-updated"));
        }
      },
      onApplied: (result, imported) => {
        const current = optionsRef.current;
        const canonicalId = current.hasResult(result)
          ? applyImportResult(current, result, imported)
          : null;
        if (!canonicalId) {
          pendingResultsRef.current = [
            ...pendingResultsRef.current.filter(
              (pending) => !sameDiscoveryResultIdentity(pending.result, result),
            ),
            { imported, result },
          ].slice(-32);
          return;
        }
        current.selectResult(canonicalId);
        current.onMessage(
          current.desktopRuntime
            ? discoveryImportMessage(result, imported)
            : "预览已标记为已入库；真实入库会在桌面应用中写入本地文献库。",
        );
      },
      onFailed: (result, error) => {
        const current = optionsRef.current;
        if (current.hasResult(result)) current.onMessage(`入库失败:${describeSafeError(error)}`);
      },
      toError: (error) => (error instanceof Error ? error : new Error(describeSafeError(error))),
    });
  }
  const controller = controllerRef.current;
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );

  useEffect(() => {
    controller.start();
    return () => controller.stop();
  }, [controller]);

  useEffect(() => {
    if (pendingResultsRef.current.length === 0) return;
    const current = optionsRef.current;
    pendingResultsRef.current = pendingResultsRef.current.filter(
      ({ imported, result }) => !applyImportResult(current, result, imported),
    );
  }, [options.results]);

  const importResult = useCallback(
    (result: DiscoveryResultWithLibrary) => controller.import(result),
    [controller],
  );
  const isImporting = useCallback(
    (result: DiscoveryResultWithLibrary) =>
      snapshot.activeResult !== null && sameDiscoveryResultIdentity(snapshot.activeResult, result),
    [snapshot.activeResult],
  );

  return {
    ...snapshot,
    importResult,
    isImporting,
  };
}

function applyImportResult(
  options: UseDiscoveryResultImportControllerOptions,
  result: DiscoveryResultWithLibrary,
  imported: IngestResult,
): string | null {
  return options.updateResultByIdentity(result, (item) => ({
    ...item,
    inLibrary: true,
    libraryWorkId: imported.workId,
    needsFulltext: !imported.pdfFetched,
  }));
}

async function waitForMinimumElapsed(startedAt: number): Promise<void> {
  const remaining = MIN_DISCOVERY_IMPORT_BUSY_MS - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
}
