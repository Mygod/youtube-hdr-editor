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

## Recurring Every 10 Minutes

Install the bundled user-level `systemd` timer:

```bash
./scripts/install-systemd-user-timer.sh
```

That enables a `youtube-hdr-editor.timer` which runs `yarn rerun` every 10 minutes.

Useful commands:

```bash
systemctl --user status youtube-hdr-editor.timer
systemctl --user list-timers --all | grep youtube-hdr-editor
systemctl --user start youtube-hdr-editor.service
systemctl --user disable --now youtube-hdr-editor.timer
```

If you want it to keep running when you are logged out, also enable linger for your user:

```bash
sudo loginctl enable-linger "$USER"
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
