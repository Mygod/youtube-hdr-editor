# youtube-hdr

Run-on-demand YouTube Studio automation for:

- public `yt-dlp` HDR checks
- Studio fallback when the public result is incomplete or non-HDR
- exact one-frame trim submission
- recurring retry of unfinished work from SQLite

## Requirements

- Node `>=23`
- `yarn`
- `yt-dlp` on `PATH`
- Chromium installed and signed into the YouTube Studio account you want to use

## Local Setup

1. Install dependencies:

```bash
yarn install
```

2. Copy the example config and fill in your local values:

```bash
cp config.example.json config.json
```

`config.json` is intentionally ignored by git. Local browser/profile/runtime settings belong there, not in the repo.

## Commands

Run a specific batch once:

```bash
yarn run-once -- --videos VIDEO_ID_1,VIDEO_ID_2
```

Rerun only unfinished work from SQLite, then fall back to `config.json.videoIds` if nothing is pending:

```bash
yarn rerun
```

Inspect the latest recorded run:

```bash
yarn status --latest
```

## How `--rerun` Works

`yarn rerun` resumes the latest run by taking:

- requested videos that never got a result because a previous batch stopped early
- videos whose latest result is still unresolved

Current unresolved statuses are:

- `automation_error`
- `studio_not_available`
- `save_submitted_unverified`

Resolved statuses such as `processing_after_save`, `processing_pending_edits`, and `one_frame_trim_not_actionable` are not retried automatically.

## Repo Notes

- Runtime state lives under `.state/` and is ignored by git.
- Local config lives in `config.json` and is ignored by git.
- CI only runs unit tests. It does not attempt live Studio automation.
