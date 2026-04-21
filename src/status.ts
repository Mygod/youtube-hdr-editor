import { Persistence } from "./persistence.ts";
import type { RunRecord, VideoResult } from "./types.ts";

export async function renderStatus(dbPath: string, latest: boolean): Promise<string> {
  const db = await Persistence.open(dbPath);
  try {
    const runs = db.getRuns(latest ? 1 : 10);
    if (runs.length === 0) {
      return "No runs recorded yet.";
    }

    const blocks: string[] = [];
    for (const run of runs) {
      blocks.push(renderRunBlock(run, db.getVideoResults(run.id)));
    }
    return blocks.join("\n\n");
  } finally {
    db.close();
  }
}

function renderRunBlock(run: RunRecord, videoResults: VideoResult[]): string {
  const header = [
    `Run #${run.id}`,
    `started=${run.startedAt}`,
    `finished=${run.finishedAt ?? "in_progress"}`,
    `channel=${run.channelId}`,
    `videos=${run.videoCount}`,
    `headless=${run.headless}`,
  ].join(" ");

  const lines = videoResults.map(
    (result) =>
      `  ${result.videoId} public=${result.publicCheckStatus} studio=${result.studioPath} badge=${result.badgeState} editor=${result.editorState} final=${result.finalStatus}`,
  );

  return [header, ...lines].join("\n");
}
