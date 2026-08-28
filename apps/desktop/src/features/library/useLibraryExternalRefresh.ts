import { useEffect } from "react";
import { LIBRARY_REFERENCES_IMPORTED_EVENT } from "../../services/library-events";

/** Refreshes the Library view for external writes without observing its own read event. */
export function useLibraryExternalRefresh(refresh: () => unknown): void {
  useEffect(() => {
    const onExternalDataUpdated = () => void refresh();
    window.addEventListener("aurascholar:sentinel-updated", onExternalDataUpdated);
    window.addEventListener(LIBRARY_REFERENCES_IMPORTED_EVENT, onExternalDataUpdated);
    return () => {
      window.removeEventListener("aurascholar:sentinel-updated", onExternalDataUpdated);
      window.removeEventListener(LIBRARY_REFERENCES_IMPORTED_EVENT, onExternalDataUpdated);
    };
  }, [refresh]);
}
