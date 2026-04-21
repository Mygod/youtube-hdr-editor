import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { UNFINISHED_FINAL_STATUSES } from "./constants.ts";
import { ensureDir } from "./fs-utils.ts";
import type { RunRecord, VideoResult } from "./types.ts";

export class Persistence {
  readonly #db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.#db = db;
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        channel_id TEXT NOT NULL,
        video_count INTEGER NOT NULL,
        headless INTEGER NOT NULL,
        requested_video_ids_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS video_results (
        run_id INTEGER NOT NULL,
        video_id TEXT NOT NULL,
        public_check_status TEXT NOT NULL,
        public_signals_json TEXT NOT NULL,
        studio_path TEXT NOT NULL,
        badge_state TEXT NOT NULL,
        editor_state TEXT NOT NULL,
        final_status TEXT NOT NULL,
        summary TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        PRIMARY KEY (run_id, video_id),
        FOREIGN KEY (run_id) REFERENCES runs(id)
      );
    `);
    try {
      this.#db.exec("ALTER TABLE runs ADD COLUMN requested_video_ids_json TEXT NOT NULL DEFAULT '[]'");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/duplicate column name/i.test(message)) {
        throw error;
      }
    }
  }

  static async open(dbPath: string): Promise<Persistence> {
    await ensureDir(path.dirname(dbPath));
    const db = new DatabaseSync(dbPath);
    return new Persistence(db);
  }

  close(): void {
    this.#db.close();
  }

  createRun(input: {
    startedAt: string;
    channelId: string;
    videoCount: number;
    headless: boolean;
    requestedVideoIds: string[];
  }): number {
    const statement = this.#db.prepare(`
      INSERT INTO runs (started_at, channel_id, video_count, headless, requested_video_ids_json)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = statement.run(
      input.startedAt,
      input.channelId,
      input.videoCount,
      input.headless ? 1 : 0,
      JSON.stringify(input.requestedVideoIds),
    );
    return Number(result.lastInsertRowid);
  }

  finishRun(runId: number, finishedAt: string): void {
    this.#db.prepare("UPDATE runs SET finished_at = ? WHERE id = ?").run(finishedAt, runId);
  }

  saveVideoResult(runId: number, result: VideoResult): void {
    const statement = this.#db.prepare(`
      INSERT OR REPLACE INTO video_results (
        run_id, video_id, public_check_status, public_signals_json, studio_path,
        badge_state, editor_state, final_status, summary, started_at, finished_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    statement.run(
      runId,
      result.videoId,
      result.publicCheckStatus,
      JSON.stringify(result.publicSignals),
      result.studioPath,
      result.badgeState,
      result.editorState,
      result.finalStatus,
      result.summary,
      result.timestamps.startedAt,
      result.timestamps.finishedAt,
    );
  }

  getRuns(limit?: number): RunRecord[] {
    const query = `
      SELECT id, started_at, finished_at, channel_id, video_count, headless, requested_video_ids_json
      FROM runs
      ORDER BY id DESC
      ${limit ? `LIMIT ${limit}` : ""}
    `;
    return this.#db
      .prepare(query)
      .all()
      .map((row) => ({
        id: Number(row.id),
        startedAt: String(row.started_at),
        finishedAt: row.finished_at ? String(row.finished_at) : null,
        channelId: String(row.channel_id),
        videoCount: Number(row.video_count),
        headless: Boolean(row.headless),
        requestedVideoIds: parseRequestedVideoIds(row.requested_video_ids_json),
      }));
  }

  getLatestRun(): RunRecord | null {
    return this.getRuns(1)[0] ?? null;
  }

  getRun(runId: number): RunRecord | null {
    const row = this.#db
      .prepare(`
        SELECT id, started_at, finished_at, channel_id, video_count, headless, requested_video_ids_json
        FROM runs
        WHERE id = ?
      `)
      .get(runId);
    if (!row) {
      return null;
    }
    return {
      id: Number(row.id),
      startedAt: String(row.started_at),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      channelId: String(row.channel_id),
      videoCount: Number(row.video_count),
      headless: Boolean(row.headless),
      requestedVideoIds: parseRequestedVideoIds(row.requested_video_ids_json),
    };
  }

  getVideoResults(runId: number): VideoResult[] {
    return this.#db
      .prepare(`
        SELECT *
        FROM video_results
        WHERE run_id = ?
        ORDER BY finished_at ASC, video_id ASC
      `)
      .all(runId)
      .map((row) => ({
        videoId: String(row.video_id),
        publicCheckStatus: row.public_check_status,
        publicSignals: JSON.parse(String(row.public_signals_json)),
        studioPath: row.studio_path,
        badgeState: row.badge_state,
        editorState: row.editor_state,
        finalStatus: row.final_status,
        summary: String(row.summary),
        timestamps: {
          startedAt: String(row.started_at),
          finishedAt: String(row.finished_at),
        },
      })) as VideoResult[];
  }

  getUnfinishedVideoIds(runId: number): string[] {
    const run = this.getRun(runId);
    if (!run) {
      return [];
    }

    const resultsByVideoId = new Map(
      this.getVideoResults(runId).map((result) => [result.videoId, result]),
    );
    const requestedVideoIds =
      run.requestedVideoIds.length > 0 ? run.requestedVideoIds : [...resultsByVideoId.keys()];

    return requestedVideoIds.filter((videoId) => {
      const result = resultsByVideoId.get(videoId);
      return !result || UNFINISHED_FINAL_STATUSES.has(result.finalStatus);
    });
  }
}

function parseRequestedVideoIds(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
  } catch {
    return [];
  }
}
