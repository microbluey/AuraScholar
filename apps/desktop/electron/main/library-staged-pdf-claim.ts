import type { DataCommandDependencies } from "./data-command-runtime";
import type { StagedPdfClaim } from "./library-pdf-staging";

/**
 * Claims a one-time staging capability, then re-hashes its current canonical
 * blob before any durable ingest transaction begins. A failed recheck must
 * release the capability so the user can retry confirmation.
 */
export async function claimVerifiedStagedPdfBeforeTransaction(
  stageId: string,
  dependencies: DataCommandDependencies,
): Promise<StagedPdfClaim> {
  if (!dependencies.claimStagedPdf) {
    throw new Error("Main-process staged PDF receipt claim is unavailable");
  }
  const claim = await dependencies.claimStagedPdf(stageId);
  try {
    if (!dependencies.verifyStagedPdf) {
      throw new Error("Main-process staged PDF verification is unavailable");
    }
    await dependencies.verifyStagedPdf(claim.receipt);
    return claim;
  } catch (error) {
    claim.release();
    throw error;
  }
}
