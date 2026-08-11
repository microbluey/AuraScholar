import type {
  LibraryGetShellStatsCommandResult,
  LibraryShellCollection as LibraryShellCollectionDto,
} from "../../electron/data-command-contract";

export type LibraryShellCollection = LibraryShellCollectionDto;
export type LibraryShellStats = LibraryGetShellStatsCommandResult;

/**
 * Renderer facade for App Shell counts and sidebar collections. The main
 * process resolves the active Library and returns one scoped read snapshot.
 */
export function loadLibraryShellStats(): Promise<LibraryShellStats> {
  return window.aura.data.command("library.getShellStats", {});
}
