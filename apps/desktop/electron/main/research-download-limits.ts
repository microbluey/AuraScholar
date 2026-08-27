/** Shared resource bounds for short-lived research download files. */
export const RESEARCH_DOWNLOAD_TTL_MS = 30 * 60 * 1000;
export const MAX_PENDING_RESEARCH_DOWNLOADS = 128;
export const MAX_PENDING_RESEARCH_DOWNLOAD_BYTES = 4 * 1024 * 1024 * 1024;
// IPC returns the complete file to the renderer, so keep the one-shot memory
// bound below the larger canonical-PDF staging limit.
export const MAX_RESEARCH_DOWNLOAD_BYTES = 512 * 1024 * 1024;
export const MAX_RESEARCH_DOWNLOAD_ID_LENGTH = 128;
