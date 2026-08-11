/**
 * Narrow main-process AI commands. Renderer code may submit bounded document
 * text or selected Canvas sources, but provider configuration, credentials,
 * HTTP egress, and durable Library scope stay in Electron main.
 */

export type AiProviderKind = "openai-compatible" | "anthropic";

/** Public-only settings snapshot. The API key is intentionally write-only. */
export interface AiSettingsSnapshot {
  baseUrl: string;
  hasApiKey: boolean;
  kind: AiProviderKind;
  model: string;
}

/** Explicit empty DTO; settings are never a renderer-readable config file. */
export type AiGetSettingsCommandInput = Record<string, never>;

export interface AiSaveSettingsCommandInput {
  /** Omitted only when preserving a key already bound to the same target. */
  apiKey?: string;
  baseUrl: string;
  kind: AiProviderKind;
  model: string;
}

/** One-time handoff from the former renderer localStorage settings. */
export interface AiAdoptLegacySettingsCommandInput {
  baseUrl: string;
  /** A plaintext legacy key is only paired with the same submitted legacy target. */
  inlineApiKey?: string;
  kind: AiProviderKind;
  model: string;
}

export interface AiTestProviderCommandInput {
  // Provider target and secret are always resolved in main.
  requestId: string;
}

export interface AiTestProviderCommandResult {
  text: string;
}

/** Cancellation is best-effort until the durable commit boundary begins. */
export interface AiCancelRunCommandInput {
  requestId: string;
}

export interface AiCancelRunCommandResult {
  cancelled: boolean;
}

export interface AiGenerateFlashcardsCommandInput {
  paperText: string;
  requestId: string;
  workId: string;
}

export interface AiGenerateFlashcardsCommandResult {
  created: number;
}

export interface AiCanvasSynthesisSource {
  content: string;
  id: string;
  kind: "paper" | "excerpt";
  title: string;
  /** Main proves every source work is active in the current Library. */
  workId: string;
}

export type AiCanvasSynthesisMode =
  | "methodology_matrix"
  | "contradiction_analysis"
  | "research_gap"
  | "tldr";

export interface AiSynthesizeCanvasCommandInput {
  mode: AiCanvasSynthesisMode;
  requestId: string;
  sources: AiCanvasSynthesisSource[];
}

export interface AiCanvasSynthesisTable {
  headers: string[];
  rows: string[][];
}

export interface AiSynthesizeCanvasCommandResult {
  contentMarkdown: string;
  modelName: string;
  structuredTable?: AiCanvasSynthesisTable;
  title: string;
}

export interface AiFlashcardGeneration {
  contributions: string[];
  limitations: string;
  method: string;
  problem: string;
  qaCards: Array<{ a: string; q: string }>;
  results: string;
  tldr: string;
}

/** Checks whether one work remains active in the durable local Library. */
export interface AiGetFlashcardTargetCommandInput {
  workId: string;
}

export interface AiGetFlashcardTargetCommandResult {
  active: boolean;
}

/**
 * Commits one provider-validated flashcard generation. Main derives the
 * Library and verifies the target work; neither a Library id nor card ids
 * cross the renderer boundary. Card labels derive from the durable work title,
 * never a renderer-supplied title.
 */
export interface AiCommitFlashcardGenerationCommandInput {
  model: string;
  promptVersion: string;
  result: AiFlashcardGeneration;
  workId: string;
}

export interface AiCommitFlashcardGenerationCommandResult {
  created: number;
}

/** Records a safe user-facing generation failure when the target is still active. */
export interface AiRecordFlashcardFailureCommandInput {
  error: string;
  workId: string;
}

export interface AiRecordFlashcardFailureCommandResult {
  recorded: boolean;
}

export interface AiDataCommandMap {
  "ai.adoptLegacySettings": {
    input: AiAdoptLegacySettingsCommandInput;
    output: AiSettingsSnapshot | null;
  };
  "ai.cancelRun": {
    input: AiCancelRunCommandInput;
    output: AiCancelRunCommandResult;
  };
  "ai.commitFlashcardGeneration": {
    input: AiCommitFlashcardGenerationCommandInput;
    output: AiCommitFlashcardGenerationCommandResult;
  };
  "ai.generateFlashcards": {
    input: AiGenerateFlashcardsCommandInput;
    output: AiGenerateFlashcardsCommandResult;
  };
  "ai.getFlashcardTarget": {
    input: AiGetFlashcardTargetCommandInput;
    output: AiGetFlashcardTargetCommandResult;
  };
  "ai.getSettings": {
    input: AiGetSettingsCommandInput;
    output: AiSettingsSnapshot | null;
  };
  "ai.recordFlashcardFailure": {
    input: AiRecordFlashcardFailureCommandInput;
    output: AiRecordFlashcardFailureCommandResult;
  };
  "ai.saveSettings": {
    input: AiSaveSettingsCommandInput;
    output: AiSettingsSnapshot;
  };
  "ai.synthesizeCanvas": {
    input: AiSynthesizeCanvasCommandInput;
    output: AiSynthesizeCanvasCommandResult;
  };
  "ai.testProvider": {
    input: AiTestProviderCommandInput;
    output: AiTestProviderCommandResult;
  };
}

export type AiDataCommandName = keyof AiDataCommandMap;
export type AiDataCommandInput<K extends AiDataCommandName> = AiDataCommandMap[K]["input"];
export type AiDataCommandOutput<K extends AiDataCommandName> = AiDataCommandMap[K]["output"];

export type AiDataCommandRequest = {
  [K in AiDataCommandName]: {
    input: AiDataCommandInput<K>;
    name: K;
  };
}[AiDataCommandName];
