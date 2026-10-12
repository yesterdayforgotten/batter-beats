// Where Back on the Edit team screen goes: to game mode when the team was
// opened from there (the ⋮ menu), otherwise to the Teams screen. Kept for the
// browser tab, so it survives visits to a player's page in between.

const KEY = "bb.editFromGame";

/** Game mode is opening the team editor. */
export function cameFromGame(rosterId: number) {
  try {
    sessionStorage.setItem(KEY, String(rosterId));
  } catch {
    // Storage blocked; Back goes to the Teams screen.
  }
}

/** The Teams screen is opening the team editor. */
export function cameFromTeams() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Where the team editor's Back goes. */
export function editBack(rosterId: number | string | undefined): string {
  try {
    if (sessionStorage.getItem(KEY) === String(rosterId)) return `/rosters/${rosterId}`;
  } catch {
    // ignore
  }
  return "/";
}
