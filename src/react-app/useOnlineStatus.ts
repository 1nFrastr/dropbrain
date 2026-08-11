import { useEffect, useState } from "react";

/** Tracks `navigator.onLine` for offline-aware UI. */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    function sync() {
      setOnline(navigator.onLine);
    }
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    sync();
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}
