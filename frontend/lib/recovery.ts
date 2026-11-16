// Crash-loop breaker. A boot marker is written before the stored draft is rendered and cleared
// once the page has painted it. If the next load still finds the marker, the previous one never got there (render
// exception, frozen tab, killed renderer), so the draft is held back instead of being rendered again.

const BOOT_KEY = "workbench.boot.v1";

export type Boot = { id: string; recovering: boolean };

// sessionStorage: one marker per tab, so tabs that start at the same moment cannot mistake each other for a failed load.
const store = (): Storage | null => {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
};

const attempt = (action: (storage: Storage) => void) => {
  try {
    const storage = store();
    if (storage) action(storage);
  } catch {
    // Storage can be unavailable or full; the app works without it.
  }
};

/** Call once per page load. A leftover marker means the previous load failed; the marker is then kept until the user chooses. */
export function beginBoot(): Boot {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let recovering = false;
  try {
    recovering = store()?.getItem(BOOT_KEY) != null;
  } catch {
    // treated as a normal boot
  }
  if (!recovering) armBoot(id);
  return { id, recovering };
}

export function armBoot(id: string) {
  attempt((storage) => storage.setItem(BOOT_KEY, id));
}

/** Only the load that wrote the marker may clear it, so a second tab cannot hide the first one's failure. */
export function markHealthy(id: string) {
  attempt((storage) => {
    if (storage.getItem(BOOT_KEY) === id) storage.removeItem(BOOT_KEY);
  });
}

export function clearBootMarker() {
  attempt((storage) => storage.removeItem(BOOT_KEY));
}

/** The next load starts in recovery mode; used after an unrecoverable render error. */
export function flagCrash() {
  attempt((storage) => storage.setItem(BOOT_KEY, "crashed"));
}
