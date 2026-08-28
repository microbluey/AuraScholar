import { useRef } from "react";
import {
  ResearchViewSuspensionLease,
  type ResearchViewSuspensionLeaseOptions,
} from "./research-view-suspension-lease";

/** Gives a stable lease coordinator the latest renderer IPC callbacks. */
export function useResearchViewLease(options: ResearchViewSuspensionLeaseOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const leaseRef = useRef<ResearchViewSuspensionLease | null>(null);
  if (!leaseRef.current) {
    leaseRef.current = new ResearchViewSuspensionLease({
      acquire: () => optionsRef.current.acquire(),
      release: (suspensionId) => optionsRef.current.release(suspensionId),
    });
  }
  return leaseRef.current;
}
