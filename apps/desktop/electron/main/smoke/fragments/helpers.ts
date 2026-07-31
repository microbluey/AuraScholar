import { SMOKE_INPUT_REQUEST_PREFIX, SMOKE_INPUT_RESULT_EVENT } from "../input-driver";

export const smokeHelpers = String.raw`        const smokeProgress = (stage) => {
          console.info("AURASCHOLAR_SMOKE_PROGRESS " + stage);
        };
        let smokeInputRequestSequence = 0;
        const requestSmokeMouseInput = (request) =>
          new Promise((resolve) => {
            smokeInputRequestSequence += 1;
            const requestId =
              "mouse:" + Date.now() + ":" + smokeInputRequestSequence;
            let settled = false;
            let timeoutId = 0;
            const settle = (completed) => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timeoutId);
              window.removeEventListener(
                ${JSON.stringify(SMOKE_INPUT_RESULT_EVENT)},
                handleResult
              );
              resolve(completed);
            };
            const handleResult = (event) => {
              if (event.detail?.id === requestId) settle(true);
            };
            window.addEventListener(
              ${JSON.stringify(SMOKE_INPUT_RESULT_EVENT)},
              handleResult
            );
            timeoutId = window.setTimeout(() => settle(false), 4_000);
            console.info(
              ${JSON.stringify(SMOKE_INPUT_REQUEST_PREFIX)} +
                JSON.stringify({ ...request, id: requestId })
            );
          });
        const waitFor = async (predicate, timeoutMs = 8_000) => {
          const startedAt = Date.now();
          while (Date.now() - startedAt < timeoutMs) {
            const value = await predicate();
            if (value) return value;
            await wait(100);
          }
          return null;
        };
        const text = (selector) =>
          document.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        const bodyIncludes = (value) => document.body.innerText.includes(value);
        const statusbarMetric = (label) => {
          const metrics = document.querySelector(".app-statusbar__metrics");
          const item = Array.from(metrics?.querySelectorAll("span") ?? []).find((span) =>
            span.textContent?.includes(label)
          );
          const raw = item?.querySelector("strong")?.textContent ?? "";
          if (!raw.trim()) return null;
          const value = Number(raw.replace(/[^\d]/g, ""));
          return Number.isFinite(value) ? value : null;
        };
          const selectedLibrarySection = (heading) =>
            Array.from(document.querySelectorAll(".library-inspector__section")).find((section) =>
              section.querySelector("h3")?.textContent?.includes(heading)
            );
          const selectLibraryDetailTab = async (label) => {
            const tab = Array.from(document.querySelectorAll(".library-side-tab")).find((button) =>
              button.textContent?.replace(/\s+/g, " ").trim().startsWith(label)
            );
            tab?.click();
            return Boolean(
              tab &&
                (await waitFor(
                  () => tab.isConnected && tab.getAttribute("aria-selected") === "true",
                  1_500
                ))
            );
          };
        const findButton = (label) =>
          Array.from(document.querySelectorAll("button")).find((button) => {
            const values = [
              button.textContent ?? "",
              button.getAttribute("aria-label") ?? "",
              button.getAttribute("title") ?? "",
            ];
            return values.some((value) => value.includes(label));
          });
        const findExactButton = (label) =>
          Array.from(document.querySelectorAll("button")).find((button) =>
            button.textContent?.replace(/\s+/g, " ").trim() === label
          );
        const rowText = () =>
          Array.from(document.querySelectorAll(".library-table__row"))
            .map((row) => row.textContent?.replace(/\s+/g, " ").trim() ?? "")
            .join("\n");
        const clickRowByTitle = (title) => {
          const row = Array.from(document.querySelectorAll(".library-table__row")).find((item) =>
            item.textContent?.includes(title)
          );
          row?.click();
          return Boolean(row);
        };
        const dispatchDropEvent = (target, type, dataTransfer) => {
          const event = new Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(event, "dataTransfer", {
            configurable: true,
            value: dataTransfer
          });
          target.dispatchEvent(event);
        };
        const setInputValue = (input, value) => {
          const previous = input.value;
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
          input.focus();
          input.select?.();
          let changedByEditCommand = false;
          if (typeof document.execCommand === "function") {
            document.execCommand("delete", false);
            changedByEditCommand = value
              ? document.execCommand("insertText", false, value)
              : input.value === "";
          }
          if (!changedByEditCommand || input.value !== value) {
            setter?.call(input, value);
          }
          input._valueTracker?.setValue(previous);
          const inputEvent =
            typeof InputEvent === "function"
              ? new InputEvent("input", {
                  bubbles: true,
                  data: value,
                  inputType: "insertReplacementText"
                })
              : new Event("input", { bubbles: true });
          input.dispatchEvent(inputEvent);
          input.dispatchEvent(new Event("change", { bubbles: true }));
        };
        const dispatchComposingEnter = (target) => {
          const event = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter"
          });
          Object.defineProperty(event, "isComposing", {
            configurable: true,
            value: true
          });
          target.dispatchEvent(event);
        };
        const isMacShortcut = () => /Mac|iPhone|iPad/.test(navigator.platform);
        const defineKeyboardCode = (event, keyCode) => {
          Object.defineProperty(event, "keyCode", {
            configurable: true,
            value: keyCode
          });
          Object.defineProperty(event, "which", {
            configurable: true,
            value: keyCode
          });
          return event;
        };
        const makeSmokePdf = (label = "AuraScholar Smoke PDF") => {
          const escapedLabel = String(label).replace(/[\\()]/g, "\\$&");
          const text = "BT /F1 18 Tf 48 120 Td (" + escapedLabel + ") Tj ET";
          const objects = [
            "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
            "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
            "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
            "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
            "5 0 obj\n<< /Length " + text.length + " >>\nstream\n" + text + "\nendstream\nendobj\n"
          ];
          let body = "%PDF-1.4\n";
          const offsets = [0];
          for (let i = 0; i < objects.length; i += 1) {
            offsets[i + 1] = body.length;
            body += objects[i];
          }
          const xrefOffset = body.length;
          body += "xref\n0 " + (objects.length + 1) + "\n";
          body += "0000000000 65535 f \n";
          for (let i = 1; i <= objects.length; i += 1) {
            body += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
          }
          body +=
            "trailer\n<< /Size " +
            (objects.length + 1) +
            " /Root 1 0 R >>\nstartxref\n" +
            xrefOffset +
            "\n%%EOF\n";
          return new TextEncoder().encode(body);
        };
        const sha256Hex = async (bytes) => {
          if (!window.crypto?.subtle) return "0000000000000000000000000000000000000000000000000000000000000001";
          const digest = await window.crypto.subtle.digest("SHA-256", bytes);
          return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        };

`;
