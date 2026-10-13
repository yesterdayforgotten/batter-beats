// A short pause while a backup is being restored: the database is closed and
// the data folders swapped, so requests and background jobs must wait.

let paused = false;

export const isPaused = () => paused;

export function setPaused(value: boolean) {
  paused = value;
}
