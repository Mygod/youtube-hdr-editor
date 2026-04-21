import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, firefox } from "playwright-core";
import type { Browser, BrowserContext, BrowserType, Locator, Page } from "playwright-core";
import { ensureDir, sanitizeFileComponent, timestampLabel } from "./fs-utils.ts";
import type { BadgeState, StudioResult, StudioRunOptions } from "./types.ts";

const CHROMIUM_IGNORED_DEFAULT_ARGS = [
  "--disable-sync",
  "--password-store=basic",
];
const ENABLED_BUTTON_SELECTOR = "button:not([disabled]):not([aria-disabled='true'])";
const ACTIONABLE_HOST_SELECTOR = "[role='button']:not([aria-disabled='true']):not([disabled])";
const TRIM_ENTRYPOINT_SELECTORS = [
  "#entrypoint-trim-row #add-trim-icon-button",
  "#entrypoint-trim-row a",
  `#entrypoint-trim-row ${ACTIONABLE_HOST_SELECTOR}`,
  `#entrypoint-trim-row ${ENABLED_BUTTON_SELECTOR}`,
  `#action-buttons ytve-trim-editor ${ENABLED_BUTTON_SELECTOR}`,
  `ytve-trim-editor#TRIM-toolbar ${ENABLED_BUTTON_SELECTOR}`,
];
const WARM_WELCOME_BUTTON_SELECTORS = [
  `ytve-warm-welcome ytcp-button-shape ${ENABLED_BUTTON_SELECTOR}`,
  `ytve-warm-welcome ytcp-button ${ACTIONABLE_HOST_SELECTOR}`,
  `ytve-warm-welcome ${ENABLED_BUTTON_SELECTOR}`,
];
const NEW_CUT_BUTTON_SELECTORS = [
  `ytve-trim-options-panel #new-cut-button ${ENABLED_BUTTON_SELECTOR}`,
  `ytve-trim-options-panel #new-cut-button`,
  `ytve-trim-options-panel ${ENABLED_BUTTON_SELECTOR}`,
];
const APPROVE_CUT_BUTTON_SELECTORS = [
  `ytve-trim-options-panel #approve-cut-button`,
  `ytve-timeline-markers [button-type='APPROVE'] [role='button']`,
];
const POST_SAVE_PROCESSING_SIGNAL_SELECTORS = [
  "ytve-app[is-processing]",
  "ytve-editing-progress",
  "ytcp-video-upload-progress-hover[progress-type='PROCESSING']",
  "ytve-control-bar tp-yt-paper-progress:not([hidden])",
  "ytve-toast[shown]",
];
const INLINE_EDIT_SIGNAL_TOKENS = [
  "\"inlineEditProcessingStatus\":\"VIDEO_PROCESSING_STATUS_PROCESSING\"",
  "UPLOAD_CHECKS_DATA_SUMMARY_STATUS_INLINE_EDIT_IN_PROGRESS",
  "UPLOAD_CHECKS_DATA_COPYRIGHT_STATUS_INLINE_EDIT_IN_PROGRESS",
];
const SHELL_SETTLE_TIMEOUT_MS = 200;
const LOGIN_TIMEOUT_MS = 20_000;
const DIRECT_EDITOR_READY_TIMEOUT_MS = 4_000;
const EDITOR_READY_TIMEOUT_MS = 5_000;
const CONTROL_DISCOVERY_TIMEOUT_MS = 4_000;
const SAVE_ENABLE_TIMEOUT_MS = 7_500;
const CONFIRM_DIALOG_VISIBLE_TIMEOUT_MS = 2_500;
const CONFIRM_DIALOG_HIDDEN_TIMEOUT_MS = 4_000;
const CONFIRM_DIALOG_APPLY_ENABLE_TIMEOUT_MS = 4_000;
const POST_SAVE_CONFIRMATION_TIMEOUT_MS = 20_000;
const POST_SAVE_RELOAD_INTERVAL_MS = 5_000;
const EDITOR_POLL_INTERVAL_MS = 250;
const SAVE_POLL_INTERVAL_MS = 200;
const CONTROL_POLL_INTERVAL_MS = 150;
const PROCESSING_POLL_INTERVAL_MS = 500;

export class StudioSession {
  readonly #browser?: Browser;
  readonly #context: BrowserContext;
  readonly #page: Page;
  readonly #options: StudioRunOptions;
  readonly #attached: boolean;

  private constructor(
    context: BrowserContext,
    page: Page,
    options: StudioRunOptions,
    attached: boolean,
    browser?: Browser,
  ) {
    this.#browser = browser;
    this.#context = context;
    this.#page = page;
    this.#options = options;
    this.#attached = attached;
  }

  static async open(options: StudioRunOptions): Promise<StudioSession> {
    if (options.diagnosticsDir) {
      await ensureDir(options.diagnosticsDir);
    }

    const attachUrl = await resolveChromiumAttachUrl(options);
    if (attachUrl) {
      return await openAttachedChromiumSession(attachUrl, options);
    }

    if (!options.profileDir) {
      throw new Error(`Studio automation needs a profile directory when launching ${options.browserName}.`);
    }
    await ensureDir(options.profileDir);

    if (!options.browserExecutablePath) {
      throw new Error(`Studio automation needs a browser executable when launching ${options.browserName}.`);
    }

    const browserType = selectBrowserType(options.browserName);
    try {
      const context = await browserType.launchPersistentContext(options.profileDir, {
        executablePath: options.browserExecutablePath,
        headless: options.headless,
        viewport: { width: 1440, height: 1000 },
        ignoreDefaultArgs: browserType === chromium ? CHROMIUM_IGNORED_DEFAULT_ARGS : undefined,
      });

      const page = context.pages()[0] ?? (await context.newPage());
      page.setDefaultTimeout(options.timeoutMs);
      return new StudioSession(context, page, options, false);
    } catch (error) {
      const attachFallbackUrl = await resolveChromiumAttachUrl(options, true);
      if (attachFallbackUrl) {
        return await openAttachedChromiumSession(attachFallbackUrl, options);
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.#attached) {
      await this.#page.close().catch(() => {});
      await this.#browser?.close().catch(() => {});
      return;
    }
    await this.#context.close();
  }

  async run(videoId: string): Promise<StudioResult> {
    const diagnostics: string[] = [];
    const directEditorUrl = `https://studio.youtube.com/video/${videoId}/editor`;
    const page = this.#page;

    try {
      if (!this.#attached) {
        await closeExtraPages(this.#context, page);
      }
      page.setDefaultTimeout(this.#options.timeoutMs);

      const directReady = await openDirectEditor(page, directEditorUrl, this.#options.timeoutMs);
      if (directReady) {
        const directResult = await handleEditorPage(
          page,
          videoId,
          this.#options,
          diagnostics,
          "direct_editor",
        );
        if (directResult) {
          return directResult;
        }
      }
      return await evaluateCurrentEditorPage(
        page,
        videoId,
        this.#options,
        diagnostics,
        "direct_editor",
      );
    } catch (error) {
      if (this.#options.diagnosticsDir) {
        diagnostics.push(...(await captureDiagnostics(page, videoId, this.#options.diagnosticsDir, "error")));
      }
      return {
        studioPath: "direct_editor",
        badgeState: "unknown",
        editorState: "not_entered",
        finalStatus: "automation_error",
        summary: buildBrowserErrorSummary(error as Error, this.#options),
        diagnostics,
      };
    }
  }
}

export async function runStudioFallback(
  videoId: string,
  options: StudioRunOptions,
): Promise<StudioResult> {
  const session = await StudioSession.open(options);
  try {
    return await session.run(videoId);
  } finally {
    await session.close();
  }
}

async function closeExtraPages(context: BrowserContext, primaryPage: Page): Promise<void> {
  for (const page of context.pages()) {
    if (page !== primaryPage) {
      await page.close().catch(() => {});
    }
  }
}

function selectBrowserType(browserName: StudioRunOptions["browserName"]): BrowserType {
  return browserName === "firefox" ? firefox : chromium;
}

async function openAttachedChromiumSession(
  connectUrl: string,
  options: StudioRunOptions,
): Promise<StudioSession> {
  const browser = await chromium.connectOverCDP(connectUrl);
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    throw new Error(
      `Connected to Chromium at ${connectUrl}, but no default browser context was available for the signed-in session.`,
    );
  }

  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs);
  return new StudioSession(context, page, { ...options, browserConnectUrl: connectUrl }, true, browser);
}

async function resolveChromiumAttachUrl(
  options: StudioRunOptions,
  lockedProfileFallback = false,
): Promise<string | undefined> {
  if (options.browserName !== "chromium") {
    return undefined;
  }

  if (options.browserConnectUrl) {
    return options.browserConnectUrl;
  }

  if (options.profileDir) {
    const fromActivePort = discoverChromiumConnectUrlFromProfile(options.profileDir);
    if (fromActivePort) {
      return fromActivePort;
    }
  }

  if (lockedProfileFallback) {
    return await probeCommonChromiumDebugEndpoints();
  }

  return undefined;
}

function buildBrowserErrorSummary(error: Error, options: StudioRunOptions): string {
  const message = error.message;
  if (
    options.browserName === "chromium" &&
    /ProcessSingleton|profile directory|SingletonLock|already in use/i.test(message)
  ) {
    return `Studio automation failed: Chromium profile is already in use and no attachable DevTools endpoint was found. Start Chromium with --remote-debugging-port=9222 or set browserConnectUrl / --browser-connect-url. Original error: ${message}`;
  }
  if (
    options.browserName === "firefox" &&
    /profile|lock|another instance|already running|NS_ERROR_FILE_ACCESS_DENIED/i.test(message)
  ) {
    return `Studio automation failed: Firefox profile is likely in use or locked. Close Firefox or choose a different --profile-dir. Original error: ${message}`;
  }
  return `Studio automation failed: ${message}`;
}

function discoverChromiumConnectUrlFromProfile(profileDir: string): string | undefined {
  for (const candidate of chromiumProfileCandidates(profileDir)) {
    const activePortPath = path.join(candidate, "DevToolsActivePort");
    const connectUrl = readChromiumActivePortFile(activePortPath);
    if (connectUrl) {
      return connectUrl;
    }
  }
  return undefined;
}

function chromiumProfileCandidates(profileDir: string): string[] {
  const candidates = [profileDir];
  const baseName = path.basename(profileDir);
  if (/^Default$|^Profile\b/.test(baseName)) {
    candidates.push(path.dirname(profileDir));
  }
  return [...new Set(candidates)];
}

function readChromiumActivePortFile(activePortPath: string): string | undefined {
  try {
    const [port] = requirePortFile(activePortPath);
    if (!/^\d+$/.test(port ?? "")) {
      return undefined;
    }
    return `http://127.0.0.1:${port}`;
  } catch {
    return undefined;
  }
}

function requirePortFile(activePortPath: string): string[] {
  return fsSync.readFileSync(activePortPath, "utf8").split(/\r?\n/, 2);
}

async function probeCommonChromiumDebugEndpoints(): Promise<string | undefined> {
  const candidates = [
    "http://127.0.0.1:9222",
    "http://127.0.0.1:9223",
    "http://127.0.0.1:9333",
  ];

  for (const candidate of candidates) {
    if (await isReachableChromiumDebugEndpoint(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function isReachableChromiumDebugEndpoint(connectUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/json/version", connectUrl), {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) {
      return false;
    }
    const body = await response.json().catch(() => null);
    return Boolean(body && typeof body === "object" && "Browser" in body);
  } catch {
    return false;
  }
}

async function openDirectEditor(page: Page, url: string, timeoutMs: number): Promise<boolean> {
  await gotoStudioPage(page, url, timeoutMs);
  if (await detectStudioProcessingState(page)) {
    return true;
  }
  return await isEditorInteractive(page, Math.min(timeoutMs, DIRECT_EDITOR_READY_TIMEOUT_MS));
}

async function ensureStudioShell(page: Page): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(SHELL_SETTLE_TIMEOUT_MS);
}

async function gotoStudioPage(page: Page, url: string, timeoutMs: number): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitForInteractiveLoginIfNeeded(page, timeoutMs);

  if (!isStudioUrl(page.url())) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  await ensureStudioShell(page);
}

async function waitForInteractiveLoginIfNeeded(page: Page, timeoutMs: number): Promise<void> {
  if (!looksLikeGoogleLogin(page.url())) {
    return;
  }

  await page
    .waitForURL((url) => !looksLikeGoogleLogin(url.toString()), {
      timeout: Math.max(timeoutMs, LOGIN_TIMEOUT_MS),
    })
    .catch(() => {});
}

function looksLikeGoogleLogin(url: string): boolean {
  return /accounts\.google\.com|accounts\.youtube\.com|\/ServiceLogin\b|\/signin\b/i.test(url);
}

function isStudioUrl(url: string): boolean {
  return /^https:\/\/studio\.youtube\.com\/video\/[^/]+\/editor(?:[/?#]|$)/i.test(url);
}

async function handleEditorPage(
  page: Page,
  videoId: string,
  options: StudioRunOptions,
  diagnostics: string[],
  studioPath: "direct_editor",
  badgeState: BadgeState = "unknown",
): Promise<StudioResult | null> {
  logStage(videoId, "entered_editor_page");
  if (await detectStudioProcessingState(page)) {
    logStage(videoId, "processing_detected_before_edit");
    return buildProcessingResult(studioPath, badgeState, diagnostics);
  }

  logStage(videoId, "ensuring_editor_ready");
  if (!(await ensureEditorReady(page))) {
    if (await detectStudioProcessingState(page)) {
      logStage(videoId, "processing_detected_while_loading_editor");
      return buildProcessingResult(studioPath, badgeState, diagnostics);
    }
    const editorLink = locateEditorLink(page);
    if ((await editorLink.count()) === 0) {
      diagnostics.push(...(await maybeCaptureDiagnostics(page, videoId, options, "editor-not-ready")));
      return null;
    }
    logStage(videoId, "opening_editor_link");
    await clickWithFallback(editorLink, videoId, "editor_link");
    if (!(await ensureEditorReady(page))) {
      if (await detectStudioProcessingState(page)) {
        logStage(videoId, "processing_detected_after_editor_link");
        return buildProcessingResult(studioPath, badgeState, diagnostics);
      }
      diagnostics.push(...(await maybeCaptureDiagnostics(page, videoId, options, "editor-still-not-ready")));
      return null;
    }
  }

  await dismissWarmWelcomeIfPresent(page, videoId);

  if (await detectStudioProcessingState(page)) {
    logStage(videoId, "processing_detected_after_welcome");
    return buildProcessingResult(studioPath, badgeState, diagnostics);
  }

  logStage(videoId, "finding_trim_entry");
  const trimAndCut = await findTrimAndCutButton(page);
  if (!trimAndCut) {
    diagnostics.push(...(await maybeCaptureDiagnostics(page, videoId, options, "trim-entry-missing")));
    return null;
  }

  logStage(videoId, "clicking_trim_entry");
  await clickWithFallback(trimAndCut, videoId, "trim_entry");
  logStage(videoId, "finding_new_cut");
  const newCut = await findNewCutButton(page, Math.min(options.timeoutMs, CONTROL_DISCOVERY_TIMEOUT_MS));
  if (!newCut) {
    diagnostics.push(...(await maybeCaptureDiagnostics(page, videoId, options, "new-cut-missing")));
    return {
      studioPath,
      badgeState,
      editorState: "not_available",
      finalStatus: "studio_not_available",
      summary: "Could not find the New Cut control in Studio trim mode.",
      diagnostics,
    };
  }
  logStage(videoId, "clicking_new_cut");
  await clickWithFallback(newCut, videoId, "new_cut");

  logStage(videoId, "locating_cut_inputs");
  const cutInputs = await locateCutInputs(page);
  if (cutInputs.length < 2) {
    diagnostics.push(...(await maybeCaptureDiagnostics(page, videoId, options, "cut-inputs-missing")));
    return {
      studioPath,
      badgeState,
      editorState: "not_available",
      finalStatus: "studio_not_available",
      summary: "Could not find exact cut time inputs in Studio editor.",
      diagnostics,
    };
  }

  logStage(videoId, "typing_cut_inputs");
  const expectedStartValue = await buildExactFrameValue(cutInputs[0], 0);
  const expectedEndValue = await buildExactFrameValue(cutInputs[1], 1);
  logStage(videoId, `expected_cut_inputs start=${expectedStartValue} end=${expectedEndValue}`);

  await overwriteInput(cutInputs[0], expectedStartValue);
  await overwriteInput(cutInputs[1], expectedEndValue);

  const actualStartValue = await readTimestampValue(cutInputs[0]);
  const actualEndValue = await readTimestampValue(cutInputs[1]);
  logStage(videoId, `actual_cut_inputs start=${actualStartValue} end=${actualEndValue}`);
  if (actualStartValue !== expectedStartValue || actualEndValue !== expectedEndValue) {
    diagnostics.push(...(await maybeCaptureDiagnostics(page, videoId, options, "cut-inputs-normalized")));
    return {
      studioPath,
      badgeState,
      editorState: "save_disabled",
      finalStatus: "one_frame_trim_not_actionable",
      summary: `Studio normalized the exact cut inputs unexpectedly (${actualStartValue} -> ${actualEndValue}).`,
      diagnostics,
    };
  }

  logStage(videoId, "finding_cut_confirm");
  const cutButton = await findCutButton(page, Math.min(options.timeoutMs, CONTROL_DISCOVERY_TIMEOUT_MS));
  if (!cutButton) {
    diagnostics.push(...(await maybeCaptureDiagnostics(page, videoId, options, "cut-confirm-missing")));
    return {
      studioPath,
      badgeState,
      editorState: "not_available",
      finalStatus: "studio_not_available",
      summary: "Could not find the Cut confirmation control in Studio trim mode.",
      diagnostics,
    };
  }
  logStage(videoId, "clicking_cut_confirm");
  await clickWithFallback(cutButton, videoId, "cut_confirm");

  logStage(videoId, "waiting_for_save_enabled");
  const saveEnabled = await waitForSaveEnabled(page, Math.min(options.timeoutMs, SAVE_ENABLE_TIMEOUT_MS));
  if (!saveEnabled) {
    diagnostics.push(...(await maybeCaptureDiagnostics(page, videoId, options, "save-disabled")));
    return {
      studioPath,
      badgeState,
      editorState: "save_disabled",
      finalStatus: "one_frame_trim_not_actionable",
      summary: "Save stayed disabled after the exact one-frame New Cut workflow.",
      diagnostics,
    };
  }

  const saveButton = locateSaveButton(page);
  logStage(videoId, "clicking_save");
  await clickWithFallback(saveButton, videoId, "save");
  logStage(videoId, "acknowledging_confirm_dialog");
  await acknowledgeAndConfirm(page, videoId);

  logStage(videoId, "waiting_for_processing_confirmation");
  if (await waitForProcessingConfirmation(page, Math.min(options.timeoutMs, POST_SAVE_CONFIRMATION_TIMEOUT_MS))) {
    logStage(videoId, "processing_confirmed_after_save");
    return {
      studioPath,
      badgeState,
      editorState: "save_submitted",
      finalStatus: "processing_after_save",
      summary: "Studio indicates the video edit is now processing.",
      diagnostics,
    };
  }

  logStage(videoId, "processing_not_confirmed_after_save");
  diagnostics.push(...(await maybeCaptureDiagnostics(page, videoId, options, "unverified-save")));
  return {
    studioPath,
    badgeState,
    editorState: "save_submitted_unverified",
    finalStatus: "save_submitted_unverified",
    summary: "Save was submitted, but processing could not be confirmed.",
    diagnostics,
  };
}

function locateEditorLink(page: Page): Locator {
  return page.locator('a[href*="/editor"]').first();
}

async function evaluateCurrentEditorPage(
  page: Page,
  videoId: string,
  options: StudioRunOptions,
  diagnostics: string[],
  studioPath: "direct_editor",
): Promise<StudioResult> {
  if (await detectStudioProcessingState(page)) {
    return buildProcessingResult(studioPath, "unknown", diagnostics);
  }

  const detailsResult = await handleEditorPage(
    page,
    videoId,
    options,
    diagnostics,
    studioPath,
    "unknown",
  );
  if (detailsResult) {
    return detailsResult;
  }

  diagnostics.push(...(await maybeCaptureDiagnostics(page, videoId, options, "editor-surface-no-editor")));

  return {
    studioPath,
    badgeState: "unknown",
    editorState: "not_available",
    finalStatus: "studio_not_available",
    summary: "Editor controls were not available on the Studio editor surface.",
    diagnostics,
  };
}

async function ensureEditorReady(page: Page): Promise<boolean> {
  if (await isEditorInteractive(page, EDITOR_READY_TIMEOUT_MS)) {
    return true;
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await ensureStudioShell(page);
  await dismissWarmWelcomeIfPresent(page);
  return await isEditorInteractive(page, EDITOR_READY_TIMEOUT_MS);
}

async function isEditorInteractive(page: Page, timeoutMs: number): Promise<boolean> {
  const locator = await waitForFirstVisibleLocator(
    page,
    [
      "ytve-app.ready:not([is-processing])",
      "ytve-editor:not([editor-disabled])",
      "ytve-timeline",
      "ytve-toolbar ytcp-media-timestamp-input input",
    ],
    timeoutMs,
  );
  if (!locator) {
    return false;
  }
  return !(await detectStudioProcessingState(page));
}

async function locateCutInputs(page: Page): Promise<Locator[]> {
  const candidates = [
    page.locator("ytve-trim-options-panel .cut-row[selected] ytcp-media-timestamp-input input"),
    page.locator("ytve-trim-options-panel .cut-framestamps-container ytcp-media-timestamp-input input"),
    page.locator("ytcp-media-timestamp-input input"),
    page.locator("input[type='text']"),
  ];

  for (const locator of candidates) {
    const count = await locator.count();
    if (count >= 2) {
      return [locator.nth(0), locator.nth(1)];
    }
  }

  return [];
}

async function overwriteInput(locator: Locator, value: string): Promise<void> {
  await locator.click({ clickCount: 3 });
  await locator.press("ControlOrMeta+A");
  await locator.press("Delete");
  await locator.type(value, { delay: 20 });
}

async function buildExactFrameValue(locator: Locator, finalFrameValue: number): Promise<string> {
  const template = await locator
    .evaluate((input) => {
      const host = input.closest("ytcp-media-timestamp-input");
      const displayText =
        host?.querySelector<HTMLElement>("#display")?.innerText?.trim() ??
        host?.querySelector<HTMLElement>("#sizing")?.textContent?.trim() ??
        "";
      const currentValue = (input as HTMLInputElement).value?.trim() ?? "";
      return displayText || currentValue;
    })
    .catch(() => "");

  const parts = template
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return finalFrameValue === 0 ? "0:00:00:00" : "0:00:00:01";
  }

  const filled = parts.map((part) => {
    const digitsOnly = part.replace(/\D/g, "");
    const width = Math.max(digitsOnly.length, 1);
    return "0".repeat(width);
  });
  const lastIndex = filled.length - 1;
  filled[lastIndex] = String(finalFrameValue).padStart(filled[lastIndex].length, "0");
  return filled.join(":");
}

async function readTimestampValue(locator: Locator): Promise<string> {
  return await locator
    .evaluate((input) => {
      const currentValue = (input as HTMLInputElement).value?.trim();
      if (currentValue) {
        return currentValue;
      }
      const host = input.closest("ytcp-media-timestamp-input");
      return (
        host?.querySelector<HTMLElement>("#display")?.innerText?.trim() ??
        host?.querySelector<HTMLElement>("#sizing")?.textContent?.trim() ??
        ""
      );
    })
    .catch(() => "");
}

async function waitForSaveEnabled(page: Page, timeoutMs: number): Promise<boolean> {
  return await page
    .evaluate(async ({ timeoutMs }) => {
      const readEnabledState = (): boolean | null => {
        const host = document.querySelector("#save-button");
        if (!host) {
          return null;
        }

        const target =
          host.matches("button") ? host : host.querySelector("button") ?? host;
        const disabled =
          target.hasAttribute("disabled") ||
          target.getAttribute("aria-disabled") === "true" ||
          host.hasAttribute("disabled") ||
          host.getAttribute("aria-disabled") === "true";
        return !disabled;
      };

      const initialState = readEnabledState();
      if (initialState === true) {
        return true;
      }

      return await new Promise<boolean>((resolve) => {
        const finish = (value: boolean) => {
          observer.disconnect();
          clearTimeout(timer);
          resolve(value);
        };

        const observer = new MutationObserver(() => {
          const enabled = readEnabledState();
          if (enabled === true) {
            finish(true);
          }
        });
        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ["disabled", "aria-disabled", "class"],
        });

        const timer = window.setTimeout(() => finish(false), timeoutMs);
      });
    }, { timeoutMs })
    .catch(() => false);
}

async function acknowledgeAndConfirm(page: Page, videoId: string): Promise<void> {
  logStage(videoId, "waiting_for_confirm_dialog");
  const dialog = page.locator("tp-yt-paper-dialog:not([aria-hidden='true'])").last();
  const dialogVisible = await dialog
    .waitFor({ state: "visible", timeout: CONFIRM_DIALOG_VISIBLE_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!dialogVisible) {
    logStage(videoId, "confirm_dialog_not_present");
    return;
  }

  logStage(videoId, "confirm_dialog_visible");
  const checkbox = await findConfirmDialogCheckbox(dialog);
  if (checkbox && !(await isConfirmDialogCheckboxChecked(checkbox))) {
    logStage(videoId, "clicking_confirm_dialog_checkbox");
    await clickDialogControl(checkbox, videoId, "confirm_dialog_checkbox");
  }

  const confirmButtonEnabled = await waitForConfirmDialogApplyEnabled(
    dialog,
    CONFIRM_DIALOG_APPLY_ENABLE_TIMEOUT_MS,
  );
  if (!confirmButtonEnabled) {
    logStage(videoId, "confirm_dialog_button_not_enabled");
    return;
  }

  const confirmButton = await findConfirmDialogApplyButton(dialog);
  if (!confirmButton) {
    logStage(videoId, "confirm_dialog_button_missing");
    return;
  }

  logStage(videoId, "clicking_confirm_dialog_button");
  await clickDialogControl(confirmButton, videoId, "confirm_dialog_button");
  await dialog.waitFor({ state: "hidden", timeout: CONFIRM_DIALOG_HIDDEN_TIMEOUT_MS }).catch(() => {});
  logStage(videoId, "confirm_dialog_handled");
}

async function findConfirmDialogCheckbox(dialog: Locator): Promise<Locator | null> {
  return await findFirstVisibleScopedLocator(dialog, [
    "#confirm-checkbox #checkbox",
    "#confirm-checkbox [role='checkbox']",
    "#confirm-checkbox",
    "tp-yt-paper-checkbox",
    "[role='checkbox']",
  ]);
}

async function isConfirmDialogCheckboxChecked(locator: Locator): Promise<boolean> {
  return await locator
    .evaluate((element) => {
      const host =
        element.closest("#confirm-checkbox") ??
        element.closest("ytcp-checkbox-lit") ??
        element.closest("tp-yt-paper-checkbox") ??
        element;
      const checkbox =
        host.querySelector("[role='checkbox']") ??
        (host.matches("[role='checkbox']") ? host : null);
      if (!checkbox) {
        return host.hasAttribute("checked") || host.getAttribute("aria-checked") === "true";
      }
      return (
        checkbox.getAttribute("aria-checked") === "true" ||
        host.hasAttribute("checked") ||
        checkbox.hasAttribute("checked")
      );
    })
    .catch(() => false);
}

async function waitForConfirmDialogApplyEnabled(dialog: Locator, timeoutMs: number): Promise<boolean> {
  return await dialog
    .evaluate(
      async (element, { timeoutMs }) => {
        const readEnabledState = (): boolean | null => {
          const host = element.querySelector("#apply-button");
          if (!host) {
            return null;
          }

          const target =
            host.matches("button") ? host : host.querySelector("button") ?? host;
          const disabled =
            target.hasAttribute("disabled") ||
            target.getAttribute("aria-disabled") === "true" ||
            host.hasAttribute("disabled") ||
            host.getAttribute("aria-disabled") === "true";
          return !disabled;
        };

        const initialState = readEnabledState();
        if (initialState === true) {
          return true;
        }

        return await new Promise<boolean>((resolve) => {
          const finish = (value: boolean) => {
            observer.disconnect();
            clearTimeout(timer);
            resolve(value);
          };

          const observer = new MutationObserver(() => {
            const enabled = readEnabledState();
            if (enabled === true) {
              finish(true);
            }
          });
          observer.observe(element, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ["disabled", "aria-disabled", "class", "checked", "aria-checked"],
          });

          const timer = window.setTimeout(() => finish(false), timeoutMs);
        });
      },
      { timeoutMs },
    )
    .catch(() => false);
}

async function findConfirmDialogApplyButton(dialog: Locator): Promise<Locator | null> {
  return await findFirstVisibleScopedLocator(dialog, [
    "#apply-button button:not([disabled]):not([aria-disabled='true'])",
    "#apply-button:not([disabled]):not([aria-disabled='true'])",
    ".footer #apply-button button:not([disabled]):not([aria-disabled='true'])",
    ".footer #apply-button:not([disabled]):not([aria-disabled='true'])",
  ]);
}

async function waitForProcessingConfirmation(page: Page, timeoutMs: number): Promise<boolean> {
  if (await detectStudioProcessingState(page)) {
    return true;
  }

  return await page
    .evaluate(
      async ({ timeoutMs, selectors, inlineTokens }) => {
        const root = document.documentElement;
        if (!root) {
          return false;
        }

        const hasProcessingSignal = (): boolean => {
          for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (!element) {
              continue;
            }
            const htmlElement = element as HTMLElement;
            const style = window.getComputedStyle(htmlElement);
            const rect = htmlElement.getBoundingClientRect();
            if (
              style.visibility !== "hidden" &&
              style.display !== "none" &&
              (rect.width > 0 || rect.height > 0)
            ) {
              return true;
            }
          }

          const processingToast = document.querySelector("#processing-toast #message-container");
          if (processingToast?.textContent?.trim()) {
            return true;
          }

          const serialized = root.innerHTML;
          return inlineTokens.some((token) => serialized.includes(token));
        };

        if (hasProcessingSignal()) {
          return true;
        }

        return await new Promise<boolean>((resolve) => {
          const finish = (value: boolean) => {
            observer.disconnect();
            clearTimeout(timer);
            resolve(value);
          };

          const observer = new MutationObserver(() => {
            if (hasProcessingSignal()) {
              finish(true);
            }
          });
          observer.observe(root, {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,
          });

          const timer = window.setTimeout(() => finish(false), timeoutMs);
        });
      },
      {
        timeoutMs,
        selectors: POST_SAVE_PROCESSING_SIGNAL_SELECTORS,
        inlineTokens: INLINE_EDIT_SIGNAL_TOKENS,
      },
    )
    .catch(() => false);
}

async function detectStudioProcessingState(page: Page): Promise<boolean> {
  const structuralSignals = POST_SAVE_PROCESSING_SIGNAL_SELECTORS.map((selector) =>
    page.locator(selector).first(),
  );

  for (const signal of structuralSignals) {
    if ((await signal.count()) === 0) {
      continue;
    }
    if (await signal.isVisible().catch(() => true)) {
      return true;
    }
  }

  if (await hasProcessingToastMessage(page)) {
    return true;
  }

  const html = await page.content().catch(() => "");
  return hasInlineEditProcessingSignal(html);
}

async function hasProcessingToastMessage(page: Page): Promise<boolean> {
  return await page
    .locator("#processing-toast #message-container")
    .evaluate((element) => element.textContent?.trim().length !== 0)
    .catch(() => false);
}

function buildProcessingResult(
  studioPath: "direct_editor",
  badgeState: BadgeState,
  diagnostics: string[],
): StudioResult {
  return {
    studioPath,
    badgeState,
    editorState: "not_entered",
    finalStatus: "processing_pending_edits",
    summary: "Studio indicates the video edit is still processing.",
    diagnostics,
  };
}

function locateNewCutButton(page: Page): Locator {
  return page.locator(NEW_CUT_BUTTON_SELECTORS.join(", ")).first();
}

function locateCutButton(page: Page): Locator {
  return page.locator(APPROVE_CUT_BUTTON_SELECTORS.join(", ")).first();
}

function locateSaveButton(page: Page): Locator {
  return page
    .locator("#save-button button, #save-button")
    .first();
}

async function dismissWarmWelcomeIfPresent(page: Page, videoId?: string): Promise<void> {
  const welcomeOverlay = page.locator("ytve-warm-welcome").first();
  if ((await welcomeOverlay.count()) === 0) {
    return;
  }
  if (!(await welcomeOverlay.isVisible().catch(() => false))) {
    return;
  }

  const welcomeButton = await findFirstVisibleLocator(page, WARM_WELCOME_BUTTON_SELECTORS);
  if (!welcomeButton) {
    return;
  }

  if (videoId) {
    logStage(videoId, "dismissing_warm_welcome");
  }
  await welcomeButton.click({ force: true, timeout: 300 }).catch(async () => {
    await welcomeButton.click({ timeout: 300 }).catch(() => {});
  });
  await welcomeOverlay.waitFor({ state: "hidden", timeout: 150 }).catch(() => {});
}

async function findTrimAndCutButton(page: Page): Promise<Locator | null> {
  return await findFirstVisibleLocator(page, TRIM_ENTRYPOINT_SELECTORS);
}

async function findNewCutButton(page: Page, timeoutMs: number): Promise<Locator | null> {
  return await waitForFirstVisibleLocator(page, NEW_CUT_BUTTON_SELECTORS, timeoutMs);
}

async function findCutButton(page: Page, timeoutMs: number): Promise<Locator | null> {
  return await waitForFirstVisibleLocator(page, APPROVE_CUT_BUTTON_SELECTORS, timeoutMs);
}

async function findFirstVisibleLocator(page: Page, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function waitForFirstVisibleLocator(
  page: Page,
  selectors: string[],
  timeoutMs: number,
): Promise<Locator | null> {
  const attempts = selectors.map(async (selector) => {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: "visible", timeout: timeoutMs });
    return locator;
  });

  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

async function findFirstVisibleScopedLocator(scope: Locator, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = scope.locator(selector).first();
    if ((await locator.count()) === 0) {
      continue;
    }
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function findLastVisibleScopedLocator(scope: Locator, selectors: string[]): Promise<Locator | null> {
  for (const selector of selectors) {
    const locator = scope.locator(selector);
    const count = await locator.count().catch(() => 0);
    for (let index = count - 1; index >= 0; index -= 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) {
        return candidate;
      }
    }
  }
  return null;
}

async function clickWithFallback(
  locator: Locator,
  videoId: string | undefined,
  label: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await locator.click({ timeout: 3_000 });
  } catch (error) {
    if (videoId) {
      logStage(videoId, `${label}_normal_click_failed`);
    }
    await locator.click({ force: true, timeout: 3_000 }).catch(() => {
      throw error;
    });
  }
}

async function clickDialogControl(
  locator: Locator,
  videoId: string | undefined,
  label: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  try {
    await locator.click({ timeout: 1_500 });
  } catch (error) {
    if (videoId) {
      logStage(videoId, `${label}_normal_click_failed`);
    }
    try {
      await locator.click({ force: true, timeout: 1_500 });
      return;
    } catch {
      if (videoId) {
        logStage(videoId, `${label}_force_click_failed`);
      }
    }
    await locator
      .evaluate((element) => {
        const target =
          element.matches("button,[role='button'],[role='checkbox']") ?
            element :
            element.querySelector("button,[role='button'],[role='checkbox']");
        if (!(target instanceof HTMLElement)) {
          throw new Error("Dialog control target was not clickable.");
        }
        target.click();
      })
      .catch(() => {
        throw error;
      });
  }
}

function logStage(videoId: string, stage: string): void {
  console.log(`[studio:${videoId}] ${stage}`);
}

async function countVisibleSelectors(page: Page, selectors: string[]): Promise<number> {
  let total = 0;
  for (const selector of selectors) {
    total += await page.locator(selector).count().catch(() => 0);
  }
  return total;
}

export function hasInlineEditProcessingSignal(serialized: string): boolean {
  return INLINE_EDIT_SIGNAL_TOKENS.some((token) => serialized.includes(token));
}

async function maybeCaptureDiagnostics(
  page: Page,
  videoId: string,
  options: StudioRunOptions,
  label: string,
): Promise<string[]> {
  if (!options.diagnosticsDir) {
    return [];
  }
  return await captureDiagnostics(page, videoId, options.diagnosticsDir, label);
}

async function captureDiagnostics(
  page: Page,
  videoId: string,
  diagnosticsDir: string,
  label: string,
): Promise<string[]> {
  await ensureDir(diagnosticsDir);
  const stem = `${sanitizeFileComponent(videoId)}-${sanitizeFileComponent(label)}-${timestampLabel()}`;
  const htmlPath = path.join(diagnosticsDir, `${stem}.html`);
  const metaPath = path.join(diagnosticsDir, `${stem}.json`);
  const screenshotPath = path.join(diagnosticsDir, `${stem}.png`);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const visibleButtons = await collectVisibleElementSummaries(page, "button", 30);
  const visibleLinks = await collectVisibleElementSummaries(page, "a", 30);
  const editorSignals = {
    editorLinkCount: await locateEditorLink(page).count().catch(() => 0),
    trimAndCutButtonCount: await countVisibleSelectors(page, TRIM_ENTRYPOINT_SELECTORS),
    newCutButtonCount: await countVisibleSelectors(page, NEW_CUT_BUTTON_SELECTORS),
    ytveEditorCount: await page.locator("ytve-editor").count().catch(() => 0),
    ytveTimelineCount: await page.locator("ytve-timeline").count().catch(() => 0),
    processingAppCount: await page.locator("ytve-app[is-processing]").count().catch(() => 0),
    editingProgressCount: await page.locator("ytve-editing-progress").count().catch(() => 0),
    processingHoverCount: await page.locator("ytcp-video-upload-progress-hover[progress-type='PROCESSING']").count().catch(() => 0),
  };

  await fs.writeFile(htmlPath, await page.content(), "utf8");
  const screenshotCaptured = await page
    .screenshot({ path: screenshotPath, fullPage: true })
    .then(() => true)
    .catch(() => false);
  await fs.writeFile(
    metaPath,
    JSON.stringify(
      {
        url: page.url(),
        title: await page.title().catch(() => ""),
        capturedAt: new Date().toISOString(),
        bodyTextSnippet: bodyText.slice(0, 4_000),
        visibleButtons,
        visibleLinks,
        editorSignals,
      },
      null,
      2,
    ),
    "utf8",
  );
  return screenshotCaptured ? [htmlPath, metaPath, screenshotPath] : [htmlPath, metaPath];
}

async function collectVisibleElementSummaries(
  page: Page,
  selector: string,
  limit: number,
): Promise<string[]> {
  return await page.locator(selector).evaluateAll((elements, maxItems) => {
    const summaries: string[] = [];

    for (const element of elements) {
      if (summaries.length >= maxItems) {
        break;
      }

      if (!(element instanceof HTMLElement)) {
        continue;
      }

      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.visibility === "hidden" ||
        style.display === "none" ||
        rect.width === 0 ||
        rect.height === 0
      ) {
        continue;
      }

      const text = element.innerText.replace(/\s+/g, " ").trim();
      const ariaLabel = element.getAttribute("aria-label")?.trim();
      const href = element instanceof HTMLAnchorElement ? element.href : undefined;
      const summary = [text, ariaLabel, href]
        .filter((value): value is string => Boolean(value))
        .join(" | ");

      if (summary) {
        summaries.push(summary);
      }
    }

    return summaries;
  }, limit).catch(() => []);
}
