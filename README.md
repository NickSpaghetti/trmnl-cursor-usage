# trmnl-cursor-usage

[![CI](https://github.com/NickSpaghetti/trmnl-cursor-usage/actions/workflows/ci.yml/badge.svg)](https://github.com/NickSpaghetti/trmnl-cursor-usage/actions/workflows/ci.yml)

TRMNL plugins that put Cursor AI usage on an e-ink dashboard.

Each plugin lives under `plugins/`. They share one Docker dev container and one
Makefile.

| Plugin | What it shows |
|--------|---------------|
| [`cursor-member-usage`](plugins/cursor-member-usage) | One teammate's Cursor spend, broken down by model |

![Cursor Member Usage, full layout](plugins/cursor-member-usage/docs/full.png)

The [plugin README](plugins/cursor-member-usage#layouts) has the other three
layouts.

## Requirements

Docker. That's it. Every target runs inside the
[`trmnl/trmnlp`](https://github.com/usetrmnl/trmnlp) image, so there's no Ruby
or Node to install on the host.

## Quickstart

```bash
cp .env.example .env    # add your Cursor admin API key + member email
make dev                # http://localhost:4567
```

`make dev` serves the plugin with live reload. Edit anything under
`plugins/<name>/src` and the preview refreshes.

## Make targets

| Target | Does |
|--------|------|
| `make help` | List targets and available plugins |
| `make dev` | Serve with live reload at http://localhost:4567 |
| `make up` / `make down` | Same, detached |
| `make logs` | Tail the dev container |
| `make shell` | Shell into the container at `/plugin` |
| `make build` | Render static HTML to `plugins/<name>/_build/` |
| `make build-png` | Also render 800x480 PNGs |
| `make screenshots` | Regenerate the README layout images from the demo fixture |
| `make test` | Run the plugin's transform unit tests |
| `make test-local` | Same tests on host node, no Docker |
| `make lint` | Check against TRMNL best practices |
| `make check` | `lint` + `test` |
| `make clean` | Remove build output |
| `make pull` | Pull the latest `trmnl/trmnlp` image |

Every target takes `PLUGIN=` to pick a plugin. It defaults to
`cursor-member-usage`.

```bash
make build PLUGIN=cursor-member-usage
```

## Environment

`.env` at the repo root is loaded into the container by `docker-compose.yml`.
trmnlp has no dotenv support of its own, so this is the only place secrets get
in.

| Variable | Used for |
|----------|----------|
| `CURSOR_API_KEY` | Cursor admin API key. cursor.com/dashboard → Settings → Cursor Admin API Keys |
| `CURSOR_MEMBER_EMAIL` | The teammate `cursor-member-usage` reports on |

`.env` is gitignored. `make test` and `make lint` work without one.

## CI

`.github/workflows/ci.yml` runs on push to `main`, on every PR, and on demand.

| Job | Does |
|-----|------|
| `discover` | Builds a matrix from `plugins/*`, so a new plugin needs no CI change |
| `plugin` | Per plugin: `make lint`, `make test`, renders the empty state, renders the demo data, uploads the PNGs |
| `workflows` | actionlint over the workflow files themselves |
| `secrets` | gitleaks over full history, plus a guard against tracked env files |

Renders are uploaded as artifacts to look at on a PR. They are not diffed
against the committed screenshots. The `trmnl/trmnlp` tag is unpinned and the
page fetches its font over the network, so identical markup can produce
different bytes. Pin the image by digest and self-host the font if you want a
real drift gate.

Secret scanning:

- No configuration needed on a personal account.
- On a GitHub organization, `gitleaks-action` needs a free license key in
  `GITLEAKS_LICENSE`. `trufflesecurity/trufflehog` has no licensing gate if you
  would rather swap.
- Inline PR comments are on for branches in this repo and off for forks. GitHub
  forces `GITHUB_TOKEN` read-only on fork PRs, so commenting there fails the
  step for an infrastructure reason. The check still fails and the job summary
  still reports the leak.

Dependabot bumps action versions weekly. No npm entry, because the plugin has
zero JS dependencies and no lockfile.

## Adding a plugin

```
plugins/<name>/
  .trmnlp.yml        local dev config, not uploaded
  src/               the plugin itself, uploaded by trmnlp push
    settings.yml
    *.liquid
    transform.js
  fixtures/          sample API responses
  tests/             transform unit tests
```

Keep fixtures and tests out of `src/`. trmnlp uploads everything in there.

The Makefile picks up new directories automatically. `make plugins` lists them.
