# youtube-hdr

Run-on-demand YouTube Studio automation for:

- public `yt-dlp` HDR checks
- Studio fallback when the public result is incomplete or non-HDR
- exact one-frame trim submission
- recurring full configured batches

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

Run the full `config.json.videoIds` batch:

```bash
yarn rerun
```

Run that batch with a visible browser, overriding `config.json` headless mode:

```bash
yarn rerun -- --no-headless
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

`yarn rerun` runs the full configured `videoIds` list every time. It does not inspect previous runs or skip videos based on SQLite status.

## Repo Notes

- Runtime state lives under `.state/` and is ignored by git.
- Local config lives in `config.json` and is ignored by git.
- CI only runs unit tests. It does not attempt live Studio automation.
