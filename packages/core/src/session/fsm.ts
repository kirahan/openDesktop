import type { SessionState } from "./types.js";

const terminal: SessionState[] = ["killed", "failed"];

export function isTerminal(state: SessionState): boolean {
  return terminal.includes(state);
}

/** Valid transitions for the session lifecycle */
const allowed: Record<SessionState, SessionState[]> = {
  pending: ["starting", "failed", "killed"],
  starting: ["running", "failed", "killed"],
  running: ["killed", "failed"],
  killed: [],
  failed: [],
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  return allowed[from]?.includes(to) ?? false;
}

export function assertTransition(from: SessionState, to: SessionState): void {
  if (!canTransition(from, to)) {
    throw new Error(`INVALID_TRANSITION: ${from} -> ${to}`);
  }
}
