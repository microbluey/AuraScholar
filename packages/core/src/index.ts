export type { Clue } from "./ingest/clues";
export { clueFromInput, clueFromUrl, cluesFromPdfText } from "./ingest/clues";
export type { ResolvedWork } from "./ingest/resolve";
export { resolveClue, findOaPdf, titleSimilarity } from "./ingest/resolve";
