import path from "node:path";
import { ensureDir } from "./fs-utils.ts";
import { Persistence } from "./persistence.ts";
import { runPublicCheck } from "./publicCheck.ts";
import { StudioSession } from "./studioWorker.ts";
import type { RunConfig, VideoResult } from "./types.ts";

export async function runBatch(config: RunConfig): Promise<{
  runId: number;
  results: VideoResult[];
}> {
  await ensureDir(path.dirname(config.dbPath));
  if (config.profileDir) {
    await ensureDir(config.profileDir);
  }
  if (config.diagnosticsDir) {
    await ensureDir(config.diagnosticsDir);
  }

  const db = await Persistence.open(config.dbPath);
  const startedAt = new Date().toISOString();
  const runId = db.createRun({
    startedAt,
    channelId: config.channelId ?? "auto",
    videoCount: config.videoIds.length,
    headless: config.headless,
    requestedVideoIds: config.videoIds,
  });

  const results: VideoResult[] = [];
  let studioSession: StudioSession | null = null;
  try {
    for (const videoId of config.videoIds) {
      const videoStartedAt = new Date().toISOString();
      const publicResult = await runPublicCheck(videoId);

      let result: VideoResult;
      if (publicResult.status === "hdr_present") {
        result = {
          videoId,
          publicCheckStatus: publicResult.status,
          publicSignals: publicResult.signals,
          studioPath: "skipped",
          badgeState: "unknown",
          editorState: "not_entered",
          finalStatus: "hdr_present_public",
          summary: publicResult.summary,
          timestamps: {
            startedAt: videoStartedAt,
            finishedAt: new Date().toISOString(),
          },
        };
      } else {
        studioSession ??= await StudioSession.open({
          channelId: config.channelId,
          browserName: config.browserName,
          browserExecutablePath: config.browserExecutablePath,
          profileDir: config.profileDir,
          browserConnectUrl: config.browserConnectUrl,
          headless: config.headless,
          timeoutMs: config.timeoutMs,
          diagnosticsDir: config.diagnosticsDir,
        });
        const studioResult = await studioSession.run(videoId);
        result = {
          videoId,
          publicCheckStatus: publicResult.status,
          publicSignals: publicResult.signals,
          studioPath: studioResult.studioPath,
          badgeState: studioResult.badgeState,
          editorState: studioResult.editorState,
          finalStatus: studioResult.finalStatus,
          summary: `${publicResult.summary} ${studioResult.summary}`.trim(),
          timestamps: {
            startedAt: videoStartedAt,
            finishedAt: new Date().toISOString(),
          },
        };
      }

      db.saveVideoResult(runId, result);
      results.push(result);
    }

    return { runId, results };
  } finally {
    db.finishRun(runId, new Date().toISOString());
    await studioSession?.close();
    db.close();
  }
}
