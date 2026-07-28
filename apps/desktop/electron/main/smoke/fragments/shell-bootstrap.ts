export const smokeShellBootstrap = String.raw`        await waitFor(() => document.querySelector("main") && document.body.innerText.includes("文献库"));
        await waitFor(() => document.documentElement.getAttribute("data-theme") === "dawn", 2_000);
        const themeFallbackApplied = document.documentElement.getAttribute("data-theme") === "dawn";
        const themeStoredInvalid = (() => {
          try {
            return localStorage.getItem("theme") === "__aurascholar-invalid-theme__";
          } catch {
            return false;
          }
        })();
        const aiSettingsFallbackVisible = bodyIncludes("AI 待配置") || bodyIncludes("配置 AI");
        try {
          localStorage.setItem(
            "ai-settings",
            JSON.stringify({
              baseUrl: "https://api.shell-model-only.example/v1",
              kind: "openai-compatible",
              model: "smoke-shell-model-only"
            })
          );
          await window.aura?.secrets?.delete?.("secret:ai:apiKey");
          window.dispatchEvent(new Event("aurascholar:ai-settings-updated"));
        } catch {}
        const appShellAiModelWithoutSecretRequiresConfig = Boolean(
          await waitFor(() => {
            const statusbarButton = Array.from(
              document.querySelectorAll(".app-statusbar button")
            ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "配置 AI");
            return statusbarButton && !bodyIncludes("AI 就绪") ? statusbarButton : null;
          }, 2_000)
        );
        const appStatusbarAiSettingsButton = Array.from(
          document.querySelectorAll(".app-statusbar button")
        ).find((button) => button.textContent?.replace(/\s+/g, " ").trim() === "配置 AI");
        let appShellAiSettingsCtaVisible =
          aiSettingsFallbackVisible && Boolean(appStatusbarAiSettingsButton);
        appStatusbarAiSettingsButton?.click();
        await waitFor(
          () =>
            location.hash.includes("/settings?section=ai") &&
            Boolean(document.querySelector('[data-settings-section="ai"].settings-card--targeted')) &&
            bodyIncludes("AI 服务") &&
            bodyIncludes("阅读翻译"),
          3_000
        );
        const appShellAiSettingsCtaTargetsSection =
          location.hash.includes("/settings?section=ai") &&
          Boolean(document.querySelector('[data-settings-section="ai"].settings-card--targeted'));
        const appShellAiSettingsCtaNavigates =
          location.hash.includes("/settings?section=ai") &&
          bodyIncludes("AI 服务") &&
          bodyIncludes("阅读翻译");
        const appShellAiSettingsPreservesModelOnlyDraft = Boolean(
          await waitFor(() => {
            const aiInputs = Array.from(document.querySelectorAll(".settings-card--ai input"));
            return aiInputs[0]?.value === "https://api.shell-model-only.example/v1" &&
              aiInputs[1]?.value === "smoke-shell-model-only" &&
              aiInputs[2]?.value === ""
              ? aiInputs[1]
              : null;
          }, 2_000)
        );
        location.hash = "#/library";
        await waitFor(
          () =>
            location.hash.includes("/library") &&
            Boolean(document.querySelector(".library-page")) &&
            bodyIncludes("文献库"),
          4_000
        );

`;
