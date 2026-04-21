export type PublicCheckStatus = "hdr_present" | "no_hdr" | "incomplete";

export type BrowserEngine = "chromium" | "firefox";

export type StudioPath = "skipped" | "direct_editor" | "content_list";

export type BadgeState = "hdr" | "non_hdr_only" | "unknown";

export type EditorState =
  | "not_entered"
  | "not_available"
  | "save_disabled"
  | "save_submitted"
  | "save_submitted_unverified";

export type FinalStatus =
  | "hdr_present_public"
  | "hdr_present_studio"
  | "processing_pending_edits"
  | "processing_after_save"
  | "one_frame_trim_not_actionable"
  | "save_submitted_unverified"
  | "studio_not_available"
  | "automation_error";

export interface PublicCheckSignal {
  code: string;
  message: string;
}

export interface PublicCheckResult {
  status: PublicCheckStatus;
  signals: PublicCheckSignal[];
  summary: string;
  ytDlpExitCode: number | null;
}

export interface StudioRunOptions {
  channelId?: string;
  browserName: BrowserEngine;
  browserExecutablePath?: string;
  profileDir?: string;
  browserConnectUrl?: string;
  headless: boolean;
  timeoutMs: number;
  diagnosticsDir?: string;
}

export interface StudioResult {
  studioPath: StudioPath;
  badgeState: BadgeState;
  editorState: EditorState;
  finalStatus: FinalStatus;
  summary: string;
  diagnostics: string[];
}

export interface VideoResult {
  videoId: string;
  publicCheckStatus: PublicCheckStatus;
  publicSignals: PublicCheckSignal[];
  studioPath: StudioPath;
  badgeState: BadgeState;
  editorState: EditorState;
  finalStatus: FinalStatus;
  summary: string;
  timestamps: {
    startedAt: string;
    finishedAt: string;
  };
}

export interface RunRecord {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  channelId: string;
  videoCount: number;
  headless: boolean;
  requestedVideoIds: string[];
}

export interface RunConfig {
  videoIds: string[];
  channelId?: string;
  browserName: BrowserEngine;
  browserExecutablePath?: string;
  profileDir?: string;
  browserConnectUrl?: string;
  dbPath: string;
  headless: boolean;
  timeoutMs: number;
  diagnosticsDir?: string;
}
