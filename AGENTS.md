# AGENTS.md

## Start here

`README.md` is the product-facing introduction and user setup path. This file is
the source of truth for agents and contributors working in the repository. Read
`MODEL_NOTICE.md` before any deployment or model download.

## Project overview

This repository exposes MiniMax H3 FL2VA through one Modal app in
`modal_services/h3.py`. It contains the model downloader, `H3Service.generate`,
a CPU-only ASGI gateway, and a local entrypoint. The gateway serves the compiled
Vite app and durable asynchronous jobs from `minimax-h3-outputs`.

Important paths:

- `modal_services/h3.py`: Modal images, functions, GPU service, and entrypoint.
- `modal_services/gateway.py`: public ASGI application and HTTP routes.
- `modal_services/jobs.py`: durable job and output storage.
- `minimax_h3/`: workflow, runtime, media, progress, and ComfyUI integration.
- `frontend/`: H3Zero Vite/React application.
- `scripts/`: root setup, deploy, rotation, and command orchestration.
- `docs/api.md`: public browser API contract and curl examples.
- `tests/`: CPU-only Python contract and runtime tests.

## Setting up for a user

Requirements are Node.js 20+, Python 3.11+, Git, and a Modal account. From the
repository root, run:

```bash
npm run setup
```

The root setup command owns the complete flow: it creates `.venv`, installs the
pinned local Python tooling, launches `python -m modal setup` if no active Modal
profile exists, creates the Volumes, downloads the pinned weights, installs and
builds the frontend, deploys the app, rotates stale CPU web containers, and
verifies the deployed frontend bundle.

When acting on behalf of a user:

1. Verify the three local tool versions before starting.
2. Let the user complete Modal's browser authentication if it opens.
3. Never ask for, print, copy, or store their Modal token.
4. Do not add a Hugging Face token; the pinned public files download from inside
   Modal directly into the model Volume.
5. Wait for the `web => https://...modal.run` line and return that URL.
6. Verify `GET <url>/api/health`; this check is CPU-only.
7. Do not run `npm run smoke` or submit another paid GPU job unless the user asks.

The deployed URL is not required by H3Zero or `npm run generate`. Save it as
`H3_MODAL_URL` in the root `.env` only for local Vite development. For curl
examples, set `H3_MODAL_URL` in the current shell. The deployed endpoint is
public and unauthenticated.

## Commands

Keep user-facing workflows behind these root commands:

| Command | Purpose |
| --- | --- |
| `npm run setup` | First setup, model download, frontend build, and deployment |
| `npm run modal-setup` | Modal authentication and Volume preparation only |
| `npm run models` | Download or validate the pinned model weights |
| `npm run deploy` | Build, deploy, rotate stale web containers, and verify assets |
| `npm run smoke` | Submit the built-in paid test generation |
| `npm run generate -- ...` | Generate a video through the Modal entrypoint |
| `npm run frontend:dev` | Run Vite locally against `H3_MODAL_URL` |
| `npm run frontend:build` | Type-check and build the frontend |
| `npm test` | Run all no-GPU tests and JavaScript syntax checks |

## Local development

The production frontend uses same-origin `/api` routes and needs no configured
base URL. Local Vite development needs the deployed or temporary ASGI URL in the
root `.env`:

```env
H3_MODAL_URL=https://your-workspace--minimax-h3-web.modal.run
```

Then run:

```bash
npm run frontend:dev
```

To use a temporary endpoint, run the project Python executable with:

```bash
.venv/bin/python -m modal serve modal_services/h3.py
```

On Windows, use `.venv\Scripts\python.exe`. Copy the printed temporary URL into
`H3_MODAL_URL`. Never place Modal credentials in `.env`.

## Testing and verification

Run `npm test` after code or workflow changes. It compiles the Python sources,
runs the `unittest` suite, checks the JavaScript orchestration files, and runs
the deployment-rotation Node tests without starting a GPU.

Run `npm run frontend:build` after frontend changes when a focused frontend
check is useful. A real smoke generation incurs GPU cost and requires explicit
user intent.

Deployment verifies the expected hashed frontend bundle on three consecutive
requests. Do not weaken this check or replace graceful web-container rotation
with broad app/container termination.

## Guardrails

- Never commit `.env`, Modal credentials, generated media, or model weights.
- Keep the public setup flow behind the root `npm run ...` commands.
- Keep Modal authentication in `python -m modal setup`, not `.env`.
- Preserve the MiniMax license notice and do not deploy into an excluded
  territory. See `MODEL_NOTICE.md`.
- Pin upstream ComfyUI and Hugging Face revisions. Update them intentionally and
  together with workflow tests.
- The model weights are not part of this Apache-2.0 repository.
- Keep health, polling, static serving, and video downloads CPU-only; only job
  submission may spawn `H3Service.generate`.
- Preserve durable asynchronous jobs in `minimax-h3-outputs`.
- Preserve GPU workers during web-only deployment rotation.
