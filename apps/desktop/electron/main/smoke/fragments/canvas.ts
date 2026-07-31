export const smokeCanvas = String.raw`        location.hash = "#/canvas?workId=" + encodeURIComponent(SAMPLE.workId);
        await waitFor(
          () =>
            location.hash.startsWith("#/canvas/") &&
            !location.hash.includes("workId=") &&
            Boolean(document.querySelector(".canvas-workspace")) &&
            Boolean(
              Array.from(document.querySelectorAll(".canvas-card--paper")).find((card) =>
                card.querySelector(".canvas-card__title")?.textContent?.includes(SAMPLE.title)
              )
            ),
          8_000
        );
        canvasLibraryWorkIngressHash = location.hash;
        canvasLibraryWorkIngressNavigated =
          libraryCanvasIngressSourceVisible &&
          canvasLibraryWorkIngressHash.startsWith("#/canvas/") &&
          !canvasLibraryWorkIngressHash.includes("workId=");
        canvasLibraryWorkIngressVisible = Boolean(
          Array.from(document.querySelectorAll(".canvas-card--paper")).find((card) =>
            card.querySelector(".canvas-card__title")?.textContent?.includes(SAMPLE.title)
          )
        );
        const persistedCanvasPaper = await waitFor(async () => {
          const rows = await window.aura.db.query(
            "SELECT id, data_json FROM canvas_nodes WHERE workspace_id = ? AND type = 'paper'",
            ["canvas:default"]
          );
          return rows.find((row) => {
            try {
              const data = JSON.parse(row.data_json);
              return data.workId === SAMPLE.workId && data.title === SAMPLE.title;
            } catch {
              return false;
            }
          }) ?? null;
        }, 5_000);
        canvasLibraryWorkIngressPersisted = Boolean(persistedCanvasPaper);

        const canvasHashBeforeSplitReader = location.hash;
        const splitReaderPaperCard = Array.from(
          document.querySelectorAll(".canvas-card--paper")
        ).find((card) =>
          card.querySelector(".canvas-card__title")?.textContent?.includes(SAMPLE.title)
        );
        splitReaderPaperCard?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })
        );
        const splitReader = await waitFor(() => {
          const drawer = document.querySelector(".canvas-reader-drawer");
          return drawer?.querySelector(".au-reader-page__canvas") ? drawer : null;
        }, 10_000);
        canvasSplitReaderOpened = Boolean(splitReader);
        canvasSplitReaderKeptContext =
          Boolean(splitReader) &&
          location.hash === canvasHashBeforeSplitReader &&
          Boolean(document.querySelector(".canvas-workspace")) &&
          !document.querySelector("[data-canvas-toolbox-panel]");

        const splitReaderAnnotation = await waitFor(
          () =>
            splitReader?.querySelector(
              '.au-reader-annotation[data-annotation-id="' +
                SAMPLE.annotationId +
                '"]'
            ) ?? null,
          3_000
        );
        splitReaderAnnotation?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        );
        const splitReaderExcerptChip = await waitFor(
          () =>
            document.querySelector(
              '[data-canvas-annotation-id="' + SAMPLE.annotationId + '"]'
            ),
          2_000
        );
        const splitReaderAddButton = splitReader?.querySelector(
          ".canvas-reader-drawer__add"
        );
        if (splitReaderExcerptChip && splitReaderAddButton instanceof HTMLButtonElement) {
          splitReaderAddButton.click();
        }
        const splitReaderLinkedExcerpt = await waitFor(async () => {
          if (!persistedCanvasPaper) return null;
          const excerptRows = await window.aura.db.query(
            "SELECT id, data_json FROM canvas_nodes WHERE workspace_id = ? AND type = 'excerpt'",
            ["canvas:default"]
          );
          const excerpt = excerptRows.find((row) => {
            try {
              const data = JSON.parse(row.data_json);
              return (
                data.workId === SAMPLE.workId &&
                data.annotationId === SAMPLE.annotationId &&
                data.highlightText === "AuraScholar Smoke PDF"
              );
            } catch {
              return false;
            }
          });
          if (!excerpt) return null;
          const edgeRows = await window.aura.db.query(
            "SELECT source_id, target_id, relation_type " +
              "FROM canvas_edges " +
              "WHERE workspace_id = ? AND source_id = ? AND target_id = ? " +
              "AND relation_type = 'derived-from'",
            ["canvas:default", persistedCanvasPaper.id, excerpt.id]
          );
          return edgeRows.length === 1 ? excerpt : null;
        }, 5_000);
        canvasSplitReaderExcerptLinked =
          Boolean(splitReaderLinkedExcerpt) &&
          Boolean(
            Array.from(document.querySelectorAll(".canvas-card--excerpt")).find((card) =>
              card.querySelector(".canvas-card__quote")?.textContent?.trim() ===
              "AuraScholar Smoke PDF"
            )
          );
        splitReader
          ?.querySelector('button[aria-label="关闭同屏阅读器"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        canvasSplitReaderClosed = Boolean(
          await waitFor(() => !document.querySelector(".canvas-reader-drawer"), 2_000)
        );
        const splitReaderExcerptCard = Array.from(
          document.querySelectorAll(".canvas-card--excerpt")
        ).find(
          (card) =>
            card.querySelector(".canvas-card__quote")?.textContent?.trim() ===
            "AuraScholar Smoke PDF"
        );
        const splitReaderExcerptNodeId =
          splitReaderExcerptCard?.getAttribute("data-canvas-node-id") ??
          splitReaderLinkedExcerpt?.id ??
          "";
        if (splitReaderExcerptCard) {
          const cardRect = splitReaderExcerptCard.getBoundingClientRect();
          splitReaderExcerptCard.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              button: 2,
              clientX: cardRect.left + Math.min(32, cardRect.width / 2),
              clientY: cardRect.top + Math.min(32, cardRect.height / 2)
            })
          );
        }
        const splitReaderExcerptMenu = await waitFor(() => {
          if (!splitReaderExcerptNodeId) return null;
          const menu = document.querySelector(
            '[data-canvas-node-menu-for="' +
              CSS.escape(splitReaderExcerptNodeId) +
              '"]'
          );
          return menu?.querySelector('[data-canvas-node-action="details"]') ? menu : null;
        }, 2_000);
        canvasNodeContextMenuVisible = Boolean(splitReaderExcerptMenu);
        splitReaderExcerptMenu
          ?.querySelector('[data-canvas-node-action="details"]')
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        const splitReaderExcerptDetails = await waitFor(() => {
          if (!splitReaderExcerptNodeId) return null;
          return document.querySelector(
            '[data-canvas-toolbox-panel="details"] ' +
              '[data-canvas-details-for="' +
              CSS.escape(splitReaderExcerptNodeId) +
              '"]'
          );
        }, 2_000);
        const splitReaderExcerptMarginNote =
          splitReaderExcerptDetails?.querySelector("textarea");
        if (splitReaderExcerptMarginNote instanceof HTMLTextAreaElement) {
          setInputValue(splitReaderExcerptMarginNote, "Smoke excerpt toolbox edit");
          canvasToolboxDetailsEditPersisted = Boolean(
            await waitFor(async () => {
              const rows = await window.aura.db.query(
                "SELECT data_json FROM canvas_nodes WHERE workspace_id = ? AND id = ?",
                ["canvas:default", splitReaderExcerptNodeId]
              );
              if (!rows[0]?.data_json) return false;
              try {
                return (
                  JSON.parse(rows[0].data_json).marginNote ===
                  "Smoke excerpt toolbox edit"
                );
              } catch {
                return false;
              }
            }, 5_000)
          );
        }
        const splitReaderKeyboardDeleteTarget = document.querySelector(
          '.canvas-card--excerpt[data-canvas-node-id="' +
            CSS.escape(splitReaderExcerptNodeId) +
            '"]'
        );
        if (splitReaderKeyboardDeleteTarget instanceof HTMLElement) {
          splitReaderKeyboardDeleteTarget.focus();
          await waitFor(
            () => document.activeElement === splitReaderKeyboardDeleteTarget,
            1_000
          );
          const nodeDeleteShortcut = new KeyboardEvent("keydown", {
            key: "Delete",
            code: "Delete",
            bubbles: true,
            cancelable: true
          });
          splitReaderKeyboardDeleteTarget.dispatchEvent(nodeDeleteShortcut);
          canvasNodeKeyboardDeleteHandled = nodeDeleteShortcut.defaultPrevented;
          canvasSplitReaderCleanupSucceeded = Boolean(
            await waitFor(async () => {
              const nodeRows = await window.aura.db.query(
                "SELECT id FROM canvas_nodes WHERE workspace_id = ? AND id = ?",
                ["canvas:default", splitReaderExcerptNodeId]
              );
              const edgeRows = await window.aura.db.query(
                "SELECT id FROM canvas_edges " +
                  "WHERE workspace_id = ? AND (source_id = ? OR target_id = ?)",
                [
                  "canvas:default",
                  splitReaderExcerptNodeId,
                  splitReaderExcerptNodeId
                ]
              );
              return (
                nodeRows.length === 0 &&
                edgeRows.length === 0 &&
                !document.querySelector(
                  '[data-canvas-node-id="' +
                    CSS.escape(splitReaderExcerptNodeId) +
                    '"]'
                )
              );
            }, 5_000)
          );
        }

        if (persistedCanvasPaper) {
          const selectTool = document.querySelector(
            '.canvas-dock button[title^="选择与框选"]'
          );
          if (selectTool instanceof HTMLButtonElement) selectTool.click();
          await waitFor(
            () => selectTool?.getAttribute("aria-pressed") === "true",
            1_000
          );

          const quickLinkNode = (nodeId) =>
            Array.from(document.querySelectorAll(".react-flow__node")).find(
              (node) => node.getAttribute("data-id") === nodeId
            ) ?? null;
          const resolveQuickLinkSourceHandle = () => {
            const handle = quickLinkNode(
              persistedCanvasPaper.id
            )?.querySelector(
              '[data-canvas-connection-handle="link-right"]'
            );
            if (
              !(handle instanceof HTMLElement) ||
              !handle.isConnected ||
              !handle.classList.contains("connectablestart") ||
              handle.getAttribute("data-nodeid") !== persistedCanvasPaper.id
            ) {
              return null;
            }
            const rect = handle.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return null;
            const hitTarget = document.elementFromPoint(
              rect.left + rect.width / 2,
              rect.top + rect.height / 2
            );
            return hitTarget?.closest(".react-flow__handle") === handle
              ? handle
              : null;
          };
          const quickLinkSourceHandle = await waitFor(
            resolveQuickLinkSourceHandle,
            3_000
          );
          canvasQuickLinkSourceReady =
            quickLinkSourceHandle instanceof HTMLElement;
          const quickLinkEdgeRowsBefore = await window.aura.db.query(
            "SELECT id FROM canvas_edges WHERE workspace_id = ?",
            ["canvas:default"]
          );
          const quickLinkNodeRowsBefore = await window.aura.db.query(
            "SELECT id FROM canvas_nodes WHERE workspace_id = ?",
            ["canvas:default"]
          );
          const quickLinkEdgeIdsBefore = new Set(
            quickLinkEdgeRowsBefore.map((row) => row.id)
          );
          const quickLinkNodeIdsBefore = new Set(
            quickLinkNodeRowsBefore.map((row) => row.id)
          );
          const resolveQuickLinkDropPoint = () => {
            const quickLinkPane = document.querySelector(".react-flow__pane");
            if (!(quickLinkPane instanceof HTMLElement)) return null;
            const paneRect = quickLinkPane.getBoundingClientRect();
            const nodeRects = Array.from(
              document.querySelectorAll(".react-flow__node")
            ).map((node) => node.getBoundingClientRect());
            let bestPoint = null;
            let bestClearance = -1;
            for (let row = 1; row < 9; row += 1) {
              for (let column = 1; column < 10; column += 1) {
                const point = {
                  x: paneRect.left + paneRect.width * (column / 10),
                  y: paneRect.top + paneRect.height * (row / 9)
                };
                const target = document.elementFromPoint(point.x, point.y);
                if (
                  target?.closest(".react-flow__pane") !== quickLinkPane ||
                  target.closest(
                    ".react-flow__node, .react-flow__edge, .react-flow__handle, " +
                      "[data-canvas-interactive]"
                  )
                ) {
                  continue;
                }
                const clearance = nodeRects.reduce((minimum, rect) => {
                  const deltaX = Math.max(
                    rect.left - point.x,
                    0,
                    point.x - rect.right
                  );
                  const deltaY = Math.max(
                    rect.top - point.y,
                    0,
                    point.y - rect.bottom
                  );
                  return Math.min(minimum, Math.hypot(deltaX, deltaY));
                }, Number.POSITIVE_INFINITY);
                if (clearance > bestClearance) {
                  bestClearance = clearance;
                  bestPoint = point;
                }
              }
            }
            return bestClearance >= 80 ? bestPoint : null;
          };
          const quickLinkDropPoint = await waitFor(
            resolveQuickLinkDropPoint,
            3_000
          );
          canvasQuickLinkDropPointReady = Boolean(quickLinkDropPoint);
          if (
            quickLinkSourceHandle instanceof HTMLElement &&
            quickLinkDropPoint
          ) {
            await new Promise((resolve) =>
              window.requestAnimationFrame(() =>
                window.requestAnimationFrame(() => resolve(undefined))
              )
            );
            const liveSourceHandle = resolveQuickLinkSourceHandle();
            const liveDropPoint = resolveQuickLinkDropPoint();
            if (liveSourceHandle instanceof HTMLElement && liveDropPoint) {
              const sourceRect = liveSourceHandle.getBoundingClientRect();
              const sourcePoint = {
                x: sourceRect.left + sourceRect.width / 2,
                y: sourceRect.top + sourceRect.height / 2
              };
              const dragDistance = Math.hypot(
                liveDropPoint.x - sourcePoint.x,
                liveDropPoint.y - sourcePoint.y
              );
              if (dragDistance >= 24) {
                const handshakePoint = {
                  x:
                    sourcePoint.x +
                    ((liveDropPoint.x - sourcePoint.x) / dragDistance) * 16,
                  y:
                    sourcePoint.y +
                    ((liveDropPoint.y - sourcePoint.y) / dragDistance) * 16
                };
                let observedConnectionStart = false;
                const connectionObserver = new MutationObserver(() => {
                  if (
                    document.querySelector(
                      ".canvas-workspace--connecting, " +
                        ".react-flow__connection, " +
                        ".react-flow__handle.connectingfrom"
                    )
                  ) {
                    observedConnectionStart = true;
                  }
                });
                connectionObserver.observe(document.documentElement, {
                  attributes: true,
                  attributeFilter: ["class"],
                  childList: true,
                  subtree: true
                });
                const dragInputCompleted = await requestSmokeMouseInput({
                  kind: "mouse-drag",
                  source: sourcePoint,
                  through: handshakePoint,
                  target: liveDropPoint
                });
                canvasQuickLinkConnectionStarted =
                  dragInputCompleted && observedConnectionStart;
                connectionObserver.disconnect();
              }
            }
          }

          const persistedQuickLinkEdge = await waitFor(async () => {
            const rows = await window.aura.db.query(
              "SELECT e.id, e.relation_type, e.label, e.target_id " +
                "FROM canvas_edges e " +
                "INNER JOIN canvas_nodes n " +
                "ON n.workspace_id = e.workspace_id AND n.id = e.target_id " +
                "WHERE e.workspace_id = ? AND e.source_id = ? " +
                "AND n.type = 'idea-note'",
              ["canvas:default", persistedCanvasPaper.id]
            );
            return (
              rows.find(
                (row) =>
                  !quickLinkEdgeIdsBefore.has(row.id) &&
                  !quickLinkNodeIdsBefore.has(row.target_id)
              ) ?? null
            );
          }, 5_000);
          const persistedQuickLinkNode = persistedQuickLinkEdge?.target_id
            ? quickLinkNode(persistedQuickLinkEdge.target_id)
            : null;
          canvasQuickLinkCreatedImmediately =
            Boolean(persistedQuickLinkEdge) &&
            Boolean(
              persistedQuickLinkNode?.querySelector(".canvas-card--idea")
            );
          canvasQuickLinkUntyped =
            persistedQuickLinkEdge?.relation_type === "custom" &&
            (persistedQuickLinkEdge.label === null ||
              persistedQuickLinkEdge.label === "");
          canvasQuickLinkLegacyUiAbsent =
            !document.querySelector(".canvas-semantic-link-menu") &&
            !document.querySelector(".canvas-link-target-picker");

          const quickLinkEdgeElement = await waitFor(() => {
            if (!persistedQuickLinkEdge?.id) return null;
            return document.querySelector(
              '[data-canvas-edge-id="' +
                CSS.escape(persistedQuickLinkEdge.id) +
                '"]'
            );
          }, 2_000);
          if (quickLinkEdgeElement instanceof SVGPathElement) {
            const screenMatrix = quickLinkEdgeElement.getScreenCTM();
            if (screenMatrix) {
              const edgeWrapper = quickLinkEdgeElement.closest(".react-flow__edge");
              const totalLength = quickLinkEdgeElement.getTotalLength();
              const clickPoint = [0.5, 0.35, 0.65, 0.2, 0.8]
                .map((progress) => {
                  const pathPoint = quickLinkEdgeElement.getPointAtLength(
                    totalLength * progress
                  );
                  return new DOMPoint(pathPoint.x, pathPoint.y).matrixTransform(
                    screenMatrix
                  );
                })
                .find((point) => {
                  const hitTarget = document.elementFromPoint(point.x, point.y);
                  return (
                    edgeWrapper &&
                    hitTarget?.closest(".react-flow__edge") === edgeWrapper
                  );
                });
              if (clickPoint) {
                await requestSmokeMouseInput({
                  kind: "mouse-double-click",
                  target: { x: clickPoint.x, y: clickPoint.y }
                });
              }
            }
          }
          const quickLinkEdgeTextInput = await waitFor(() => {
            const input = document.querySelector(
              '.canvas-edge-label-editor input[aria-label="连线文字"]'
            );
            const selectedExpectedEdge = persistedQuickLinkEdge?.id
              ? document.querySelector(
                  '.react-flow__edge.selected[data-id="' +
                    CSS.escape(persistedQuickLinkEdge.id) +
                    '"]'
                )
              : null;
            return input instanceof HTMLInputElement && selectedExpectedEdge
              ? input
              : null;
          }, 2_000);
          canvasQuickLinkEdgeTextEditorOpened =
            quickLinkEdgeTextInput instanceof HTMLInputElement;
          if (quickLinkEdgeTextInput instanceof HTMLInputElement) {
            setInputValue(quickLinkEdgeTextInput, "Smoke free-form edge text");
            quickLinkEdgeTextInput.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Enter",
                code: "Enter",
                bubbles: true,
                cancelable: true
              })
            );
          }
          canvasQuickLinkEdgeTextPersisted = Boolean(
            await waitFor(async () => {
              if (!persistedQuickLinkEdge?.id) return false;
              const rows = await window.aura.db.query(
                "SELECT label FROM canvas_edges WHERE workspace_id = ? AND id = ?",
                ["canvas:default", persistedQuickLinkEdge.id]
              );
              const visibleLabel = document.querySelector(
                '[data-canvas-edge-label-id="' +
                  CSS.escape(persistedQuickLinkEdge.id) +
                  '"]'
              );
              return (
                rows[0]?.label === "Smoke free-form edge text" &&
                visibleLabel?.textContent?.trim() ===
                  "Smoke free-form edge text" &&
                !document.querySelector(".canvas-edge-label-editor")
              );
            }, 5_000)
          );

          const canvasWorkspace = document.querySelector(".canvas-workspace");
          if (
            persistedQuickLinkEdge?.id &&
            persistedQuickLinkEdge.target_id &&
            canvasQuickLinkEdgeTextPersisted &&
            canvasWorkspace instanceof HTMLElement
          ) {
            canvasWorkspace.focus();
            await waitFor(() => document.activeElement === canvasWorkspace, 1_000);
            const edgeDeleteShortcut = new KeyboardEvent("keydown", {
              key: "Backspace",
              code: "Backspace",
              bubbles: true,
              cancelable: true
            });
            canvasWorkspace.dispatchEvent(edgeDeleteShortcut);
            canvasQuickLinkKeyboardDeleteHandled =
              edgeDeleteShortcut.defaultPrevented;
            const quickLinkEdgeRemoved = Boolean(
              await waitFor(async () => {
                const rows = await window.aura.db.query(
                  "SELECT id FROM canvas_edges WHERE workspace_id = ? AND id = ?",
                  ["canvas:default", persistedQuickLinkEdge.id]
                );
                return (
                  rows.length === 0 &&
                  !document.querySelector(
                    '[data-canvas-edge-id="' +
                      CSS.escape(persistedQuickLinkEdge.id) +
                      '"]'
                  ) &&
                  !document.querySelector(
                    '[data-canvas-edge-label-id="' +
                      CSS.escape(persistedQuickLinkEdge.id) +
                      '"]'
                  )
                );
              }, 5_000)
            );
            const quickLinkCreatedNode = quickLinkNode(
              persistedQuickLinkEdge.target_id
            );
            quickLinkCreatedNode?.dispatchEvent(
              new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                button: 0,
                shiftKey: true,
                view: window
              })
            );
            const quickLinkCreatedCard = await waitFor(() => {
              const card = quickLinkNode(
                persistedQuickLinkEdge.target_id
              )?.querySelector(".canvas-card--idea.canvas-card--selected");
              return card instanceof HTMLElement ? card : null;
            }, 2_000);
            if (quickLinkCreatedCard instanceof HTMLElement) {
              quickLinkCreatedCard.focus();
              await waitFor(
                () => document.activeElement === quickLinkCreatedCard,
                1_000
              );
              quickLinkCreatedCard.dispatchEvent(
                new KeyboardEvent("keydown", {
                  key: "Delete",
                  code: "Delete",
                  bubbles: true,
                  cancelable: true
                })
              );
            }
            canvasQuickLinkCleanupSucceeded =
              quickLinkEdgeRemoved &&
              Boolean(
                await waitFor(async () => {
                  const rows = await window.aura.db.query(
                    "SELECT id FROM canvas_nodes WHERE workspace_id = ? AND id = ?",
                    ["canvas:default", persistedQuickLinkEdge.target_id]
                  );
                  return (
                    rows.length === 0 &&
                    !quickLinkNode(persistedQuickLinkEdge.target_id)
                  );
                }, 5_000)
              );
          }
        }

        location.hash = "#/flashcards";
        await waitFor(
          () =>
            location.hash.startsWith("#/canvas") &&
            !location.hash.includes("/flashcards") &&
            Boolean(document.querySelector(".canvas-workspace")) &&
            Boolean(
              Array.from(document.querySelectorAll(".canvas-card--paper")).find((card) =>
                card.querySelector(".canvas-card__title")?.textContent?.includes(SAMPLE.title)
              )
            ) &&
            Boolean(
              Array.from(document.querySelectorAll(".canvas-card--idea")).find((card) =>
                card.querySelector(".canvas-card__title")?.textContent?.includes(
                  "Smoke canvas status race"
                )
              )
            ),
          10_000
        );
        canvasLegacyRedirectHash = location.hash;
        canvasLegacyFlashcardsRedirected =
          canvasLegacyRedirectHash.startsWith("#/canvas") &&
          !canvasLegacyRedirectHash.includes("/flashcards") &&
          Boolean(document.querySelector(".canvas-workspace"));
        const persistedCanvasRows = await window.aura.db.query(
          "SELECT id, type, data_json FROM canvas_nodes WHERE workspace_id = ? ORDER BY sort_order, id",
          ["canvas:default"]
        );
        canvasPersistedNodeCount = persistedCanvasRows.length;
        const persistedCanvasPaperVisible = Boolean(
          Array.from(document.querySelectorAll(".canvas-card--paper")).find((card) =>
            card.querySelector(".canvas-card__title")?.textContent?.includes(SAMPLE.title)
          )
        );
        const persistedCanvasIdeaVisible = Boolean(
          Array.from(document.querySelectorAll(".canvas-card--idea")).find((card) =>
            card.querySelector(".canvas-card__title")?.textContent?.includes(
              "Smoke canvas status race"
            )
          )
        );
        const persistedCanvasPaperRow = persistedCanvasRows.find((row) => {
          if (row.type !== "paper") return false;
          try {
            return JSON.parse(row.data_json).workId === SAMPLE.workId;
          } catch {
            return false;
          }
        });
        canvasPersistedNodeReloaded =
          persistedCanvasPaperVisible &&
          persistedCanvasIdeaVisible &&
          Boolean(persistedCanvasPaperRow) &&
          persistedCanvasRows.some((row) => row.id === "smoke-app-shell-canvas-stats-race");
        window.__AURASCHOLAR_SMOKE_SNIPPETS_FAIL_NEXT_READ__ =
          "Smoke snippets initial load failure";
`;
