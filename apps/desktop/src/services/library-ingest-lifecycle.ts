import { describeSafeError } from "./sensitive-text";

export interface BestEffortPdfFetch {
  pdfError?: string;
  pdfFetched: boolean;
}

export async function fetchPdfForCommittedWork(
  fetchPdf: () => Promise<boolean>,
): Promise<BestEffortPdfFetch> {
  try {
    return { pdfFetched: await fetchPdf() };
  } catch (error) {
    return { pdfFetched: false, pdfError: describeSafeError(error) };
  }
}
