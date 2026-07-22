export type {
  AIProvider,
  AIProviderConfig,
  AIMessage,
  GenerateOptions,
  GenerateResult,
} from "./provider.js";
export { estimateTokens } from "./provider.js";
export { OpenAICompatibleProvider } from "./openai-compatible.js";
export type { OpenAICompatibleOptions } from "./openai-compatible.js";
export { AnthropicProvider } from "./anthropic.js";
export type { AnthropicOptions } from "./anthropic.js";
export {
  FlashcardOutputSchema,
  PROMPT_VERSION,
  generateFlashcards,
  flashcardsToCards,
  trimPaperText,
} from "./flashcards.js";
export type { FlashcardOutput, FlashcardRequest } from "./flashcards.js";
export {
  CANVAS_SYNTHESIS_PROMPT_VERSION,
  CanvasSynthesisModeSchema,
  CanvasSynthesisOutputSchema,
  MAX_CANVAS_SYNTHESIS_SOURCES,
  generateCanvasSynthesis,
} from "./canvas-synthesis.js";
export type {
  CanvasSynthesisMode,
  CanvasSynthesisOutput,
  CanvasSynthesisRequest,
  CanvasSynthesisSource,
} from "./canvas-synthesis.js";
