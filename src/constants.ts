import path from "node:path";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_STATE_DIR = path.resolve(".state");
export const DEFAULT_DB_PATH = path.join(DEFAULT_STATE_DIR, "youtube-hdr.sqlite");
export const DEFAULT_DIAGNOSTICS_DIR = path.join(DEFAULT_STATE_DIR, "diagnostics");

export const HDR_TOKENS = ["HDR", "HLG", "PQ"];
export const NON_HDR_BADGES = ["SD", "HD", "4K"];

export const PUBLIC_INCOMPLETE_PATTERNS = [
  "Precondition check failed",
  "Unable to download API page",
  "Signature extraction failed",
  "No video formats found",
  "Some formats may be missing",
];

export const UNFINISHED_FINAL_STATUSES = new Set([
  "automation_error",
  "save_submitted_unverified",
  "studio_not_available",
]);
