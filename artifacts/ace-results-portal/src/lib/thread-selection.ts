import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";

/** Thread id from the Messages page query string. Not an authorization decision. */
export function readThreadId(search: string): number | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const id = Number(params.get("threadId"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Keep the open conversation in the page URL so a reload restores it.
 * The server still authorizes every thread request.
 */
export function usePersistedThreadId() {
  const search = useSearch();
  const [pathname, navigate] = useLocation();
  const urlId = readThreadId(search);
  const [activeId, setActiveIdState] = useState<number | null>(urlId);

  useEffect(() => {
    setActiveIdState(urlId);
  }, [urlId]);

  const setActiveId = useCallback(
    (id: number | null) => {
      setActiveIdState(id);
      const path = pathname.split("?")[0] || "/";
      navigate(id ? `${path}?threadId=${id}` : path, { replace: true });
    },
    [navigate, pathname],
  );

  return { activeId, setActiveId };
}
