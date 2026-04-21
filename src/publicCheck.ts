import { spawn } from "node:child_process";
import { HDR_TOKENS, PUBLIC_INCOMPLETE_PATTERNS } from "./constants.ts";
import type { PublicCheckResult, PublicCheckSignal } from "./types.ts";

interface YtDlpFormat {
  format_id?: string;
  format_note?: string;
  dynamic_range?: string;
  vcodec?: string;
  resolution?: string;
  height?: number;
  width?: number;
}

interface YtDlpPayload {
  dynamic_range?: string;
  formats?: YtDlpFormat[];
}

export interface YtDlpCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export async function runPublicCheck(videoId: string): Promise<PublicCheckResult> {
  const url = `https://youtu.be/${videoId}`;
  const commandResult = await spawnCapture("yt-dlp", ["-J", "--no-playlist", url]);
  return classifyPublicCheck(commandResult);
}

export function classifyPublicCheck(commandResult: YtDlpCommandResult): PublicCheckResult {
  const combinedText = `${commandResult.stdout}\n${commandResult.stderr}`;
  const signals: PublicCheckSignal[] = [];

  let payload: YtDlpPayload | null = null;
  if (commandResult.stdout.trim()) {
    try {
      payload = JSON.parse(commandResult.stdout) as YtDlpPayload;
    } catch (error) {
      signals.push({
        code: "invalid_json",
        message: `yt-dlp did not return valid JSON: ${(error as Error).message}`,
      });
    }
  }

  for (const pattern of PUBLIC_INCOMPLETE_PATTERNS) {
    if (combinedText.includes(pattern)) {
      signals.push({
        code: "incomplete_pattern",
        message: pattern,
      });
    }
  }

  if (payload && hasHdrSignal(payload)) {
    return {
      status: "hdr_present",
      signals,
      summary: "Public yt-dlp check found explicit HDR/HLG/PQ.",
      ytDlpExitCode: commandResult.exitCode,
    };
  }

  if (!payload) {
    return {
      status: "incomplete",
      signals: appendUniqueSignal(signals, {
        code: "no_payload",
        message: "Public yt-dlp result did not yield a usable JSON payload.",
      }),
      summary: "Public yt-dlp result was incomplete.",
      ytDlpExitCode: commandResult.exitCode,
    };
  }

  const playableFormats = (payload.formats ?? []).filter(
    (format) => format.vcodec && format.vcodec !== "none",
  );

  if (commandResult.exitCode !== 0) {
    signals.push({
      code: "nonzero_exit",
      message: `yt-dlp exited with code ${commandResult.exitCode}.`,
    });
  }

  if (playableFormats.length === 0) {
    signals.push({
      code: "no_playable_formats",
      message: "No playable video formats were returned by yt-dlp.",
    });
  }

  if (looksLikeFallbackOnly(playableFormats)) {
    signals.push({
      code: "fallback_only_formats",
      message: "yt-dlp returned only a minimal fallback format set.",
    });
  }

  if (
    commandResult.exitCode !== 0 ||
    signals.some((signal) =>
      ["invalid_json", "incomplete_pattern", "no_playable_formats", "fallback_only_formats"].includes(
        signal.code,
      ),
    )
  ) {
    return {
      status: "incomplete",
      signals,
      summary: "Public yt-dlp result was incomplete and requires Studio fallback.",
      ytDlpExitCode: commandResult.exitCode,
    };
  }

  return {
    status: "no_hdr",
    signals,
    summary: "Public yt-dlp result completed without HDR indicators.",
    ytDlpExitCode: commandResult.exitCode,
  };
}

function hasHdrSignal(payload: YtDlpPayload): boolean {
  if (payload.dynamic_range && HDR_TOKENS.some((token) => payload.dynamic_range!.toUpperCase().includes(token))) {
    return true;
  }

  return (payload.formats ?? []).some((format) => {
    if (!format.vcodec || format.vcodec === "none") {
      return false;
    }
    return (
      Boolean(format.dynamic_range) &&
      HDR_TOKENS.some((token) => format.dynamic_range!.toUpperCase().includes(token))
    );
  });
}

function looksLikeFallbackOnly(formats: YtDlpFormat[]): boolean {
  if (formats.length === 0) {
    return true;
  }
  if (formats.length > 1) {
    return false;
  }
  const [format] = formats;
  const note = `${format.format_note ?? ""}`.toUpperCase();
  const height = inferHeight(format);
  return note.includes("THROTTLED") || height <= 360;
}

function inferHeight(format: YtDlpFormat): number {
  if (typeof format.height === "number") {
    return format.height;
  }
  const match = format.resolution?.match(/x(\d+)/);
  return match ? Number(match[1]) : 0;
}

function appendUniqueSignal(
  signals: PublicCheckSignal[],
  signal: PublicCheckSignal,
): PublicCheckSignal[] {
  if (signals.some((existing) => existing.code === signal.code && existing.message === signal.message)) {
    return signals;
  }
  return [...signals, signal];
}

async function spawnCapture(command: string, args: string[]): Promise<YtDlpCommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
