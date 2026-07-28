import type { SmokeCheck, SmokeRendererResult } from "../contracts";

export function buildCommandSmokeChecks(renderer: SmokeRendererResult): SmokeCheck[] {
  return [
    {
      name: "command-palette-shortcut-toggle",
      pass: renderer.commandShortcutToggleOpens && renderer.commandShortcutToggleCloses,
      detail: `opens=${renderer.commandShortcutToggleOpens}; closes=${renderer.commandShortcutToggleCloses}`,
    },
    {
      name: "command-palette-platform-shortcut",
      pass: renderer.commandNonPlatformShortcutIgnored,
    },
    {
      name: "command-palette-keyboard-scroll",
      pass: renderer.commandKeyboardNavigationKeepsActiveVisible,
    },
    {
      name: "command-palette-empty-recovery",
      pass: renderer.commandEmptyActionRestoresResults,
    },
    {
      name: "command-palette-focus-restore",
      pass: renderer.commandCloseRestoresFocus,
    },
    {
      name: "command-palette-ime-enter-guard",
      pass: renderer.commandCompositionIgnored,
    },
    {
      name: "modal-focus-trap-ime-escape-guard",
      pass: renderer.commandCompositionEscapeIgnored,
    },
    {
      name: "command-palette-targeted-settings-action",
      pass:
        renderer.commandTargetedSettingsActionVisible &&
        renderer.commandTargetedSettingsActionTargetsSection,
      detail: `visible=${renderer.commandTargetedSettingsActionVisible}; targeted=${renderer.commandTargetedSettingsActionTargetsSection}`,
    },
    {
      name: "platform-shortcut-labels",
      pass:
        renderer.commandShortcutLabel === (process.platform === "darwin" ? "⌘K" : "Ctrl K") &&
        renderer.librarySearchShortcutLabel === (process.platform === "darwin" ? "⌘ F" : "Ctrl F"),
      detail: `command=${renderer.commandShortcutLabel}; find=${renderer.librarySearchShortcutLabel}`,
    },
  ];
}
