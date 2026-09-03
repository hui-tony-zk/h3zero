# Browser API

The deployed `https://...modal.run` URL serves H3Zero and the same-origin API.
The endpoint is public and does not require a Modal or Hugging Face API key.
Polling, static files, and video downloads are CPU-only.

Both generation modes expose the same four sampling profiles: LightX2V Turbo
at four or eight `res_multistep` / `simple` steps, Spectrum at 30 steps, and
Base at 30 steps. H3Zero submits every profile at 480p with a random seed and
does not expose resolution or seed controls. `/api/specs` reports the pinned
files and exact settings. Comfy Kitchen INT8 attention is the global attention
backend. Set `sparse_attention` to `true` and choose a
`sparse_attention_video_budget` of `0.3`, `0.15`, or `0.1`; the conservative
default is `0.3`. Sparse attention defaults to `false`. Text, reference, audio,
and boundary attention remain dense. Spectrum adds transformer
forecasting only to the `spectrum` profile and may be combined with the sparse
toggle.

Copy the URL printed beside `web =>` after `npm run setup`, then set it for the
curl examples in your current terminal:

```bash
export H3_MODAL_URL="https://your-workspace--minimax-h3-web.modal.run"
```

In PowerShell:

```powershell
$env:H3_MODAL_URL = "https://your-workspace--minimax-h3-web.modal.run"
```

This terminal variable is only a convenience for the examples below. The
deployed H3Zero and `npm run generate` do not use it.

## Routes

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness |
| `GET` | `/api/specs` | Versioned model and upload limits |
| `POST` | `/api/jobs` | Submit a multipart job |
| `GET` | `/api/jobs/{id}` | Read status and progress |
| `GET` | `/api/jobs/{id}/video` | Stream the completed MP4 |
| `POST` | `/api/jobs/{id}/acknowledge` | Release a completed result after durable browser caching |
| `DELETE` | `/api/jobs/{id}` | Cancel and delete a job |
| `POST` | `/api/project-exports` | Upload a local project snapshot and start a CPU MP4 export |
| `GET` | `/api/project-exports/{id}` | Read project export status and progress |
| `GET` | `/api/project-exports/{id}/video` | Download a completed project MP4 |
| `GET` | `/api/cloud-sync/{username}/favorites` | List a sync name's favorites |
| `PUT` | `/api/cloud-sync/{username}/favorites/{id}` | Save a favorite video, metadata, and remix sources |
| `GET` | `/api/cloud-sync/{username}/favorites/{id}/video` | Stream a favorite's durable MP4 |
| `DELETE` | `/api/cloud-sync/{username}/favorites/{id}` | Remove a favorite video and its copied sources |
| `GET` | `/api/cloud-sync/{username}/assets/{id}` | Fetch a saved remix source |

## Submit a Frames job

`prompt` is required. `config` is a JSON string. First and last frames accept
PNG, JPEG, or WebP files up to 20 MiB.

Set `sampling_profile` to `turbo_4`, `turbo_8`, `spectrum`, or `base`. It
defaults to `turbo_4`. The production composer always uses a random seed and a
480p canvas; native 16:9 output is 864×480 and portrait output is 480×864.
The API accepts any positive integer `steps` value; profile defaults are UI
choices rather than worker-side restrictions.
`sparse_attention` is an optional boolean and defaults to `false`.
`sparse_attention_video_budget` accepts `0.3`, `0.15`, or `0.1` and defaults
to `0.3`; lower values are faster and more likely to change the result.

```bash
curl -X POST "$H3_MODAL_URL/api/jobs" \
  -F 'prompt=A paper dragon wakes. Audio: paper rustling.' \
  -F 'config={"mode":"frames","duration_seconds":5,"geometry_source":"first_frame","sampling_profile":"turbo_4"}' \
  -F 'first_frame=@first.png;type=image/png'
```

Without frames, `width` and `height` set the canvas. With frames, the first
uploaded frame sets the canvas and `geometry_source` is `first_frame` or
`last_frame`. Two frames must have matching aspect ratios.

## Submit a References job

References preserve upload order. The first uploaded item of each media type is
`<Picture 1>`, `<Video 1>`, or `<Audio 1>`. Each manifest item points to a
multipart field and has a stable `id`, `kind`, and optional `use_audio` for
videos.

```bash
curl -X POST "$H3_MODAL_URL/api/jobs" \
  -F 'prompt=<Picture 1> walks with the motion of <Video 1>.' \
  -F 'config={"mode":"references","width":864,"height":480,"duration_seconds":5,"references":[{"id":"character","kind":"image","field":"reference_0"},{"id":"motion","kind":"video","field":"reference_1"}]}' \
  -F 'reference_0=@character.png;type=image/png' \
  -F 'reference_1=@motion.mp4;type=video/mp4'
```

H3 reference tokens are case-sensitive:

- images: `<Picture 1>`
- videos: `<Video 1>`
- audio: `<Audio 1>`

Numbering is independent per media type. H3Zero's `@` menu generates these
tokens automatically.

### Reference limits

- Up to 9 images, 3 videos, 3 standalone audio clips, and 12 files total.
- Video and audio clips must each be 2–15 seconds.
- Total video duration and total standalone audio duration are each limited to
  15 seconds.
- Audio cannot be the only reference type.
- Images: 20 MiB each. Videos: 512 MiB each. Audio: 100 MiB each.
- Videos are normalized to H.264 MP4 at 24fps before inference.

Supported image MIME types are PNG, JPEG, and WebP. Supported video containers
are MP4, MOV, and WebM. Common AAC, FLAC, M4A, MP3, Ogg, and WAV audio is
accepted.

## Job status

Creation returns `202` and a stable job ID. Poll `GET /api/jobs/{id}` until
`status` is `completed`, `failed`, or `expired`.

Progress phases are `queued`, `starting`, `loading`, `conditioning`, `sampling`,
`decoding`, `saving`, and `done`. `percent`, when present, is progress within the
sampling phase.

A completed result includes dimensions, frames, actual duration, FPS, audio
metadata, seed, the selected sampling profile and settings, assigned reference
tags, and `video_url`. LoRA fields are present only for Turbo generations;
Every completed generation reports its Comfy Kitchen attention version and
whether sparse attention was enabled. Sparse generations also report the
implementation version, video-attention budget, and denser-early setting.
Spectrum generations additionally include their Spectrum settings.

Completed job videos are delivery artifacts, not permanent server storage. The
H3Zero browser caches the MP4 in IndexedDB and then acknowledges the job so its
server-side video, metadata, call ID, and progress can be removed. API clients
should do the same after safely storing the download:

```bash
curl -X POST "$H3_MODAL_URL/api/jobs/$JOB_ID/acknowledge"
```

Unacknowledged jobs are retained for 24 hours to allow interrupted downloads,
then removed by scheduled maintenance. Acknowledgement is idempotent.

## Project exports

Projects remain browser-local. Export is the only operation that sends a
project's cached media to Modal. `POST /api/project-exports` accepts multipart
`project` JSON plus one MP4 field named `video_{job_id}` for every unique job
referenced by the project. The snapshot supports 16:9 or 9:16 output, up to 24
ordered clips, trim points, playback rates from 0.5× through 2×, and a
`transitionIn` value of `fade-black` or `cut` on each clip. Missing transition
values default to a 0.3-second fade through black; fades are shortened
automatically when a clip is too brief for the full transition.

Creation returns `202` and an export ID. Poll the status route until it reports
`completed` or `failed`, then download `download_url`. Rendering runs on a
dedicated CPU-only FFmpeg function and preserves source audio when every clip
contains audio. Uploads and finished exports are transient and are removed by
scheduled maintenance after 24 hours.

## Local development

Start a temporary Modal endpoint:

```bash
.venv/bin/python -m modal serve modal_services/h3.py
```

On Windows use `.venv\Scripts\python.exe`. Put the printed URL in the root
`.env` as `H3_MODAL_URL`, then run `npm run frontend:dev`. This `.env` setting is
only for Vite's local `/api` proxy; never put Modal credentials in it.

## Favorites

Favorites are the durable server-side results. They are stored under a Modal
cloud sync name and include their own MP4 plus optional source-input copies so
another browser can view and remix them after temporary job storage is gone.

```http
GET /api/cloud-sync/{username}/favorites
PUT /api/cloud-sync/{username}/favorites/{job_id}
GET /api/cloud-sync/{username}/favorites/{job_id}/video
DELETE /api/cloud-sync/{username}/favorites/{job_id}
GET /api/cloud-sync/{username}/assets/{asset_id}
```

`PUT` accepts multipart fields named `job` (the browser job JSON), `assets` (an
array of source-asset descriptors), an optional `video` MP4, and matching file
fields `asset_0`, `asset_1`, and so on. The MP4 is required after temporary job
storage has been acknowledged; while the completed job still exists, the
server can copy it directly. Removing a favorite deletes its durable MP4 and
unreferenced copied sources.

Deployments upgrading from the legacy shared-job layout migrate favorite MP4s
before cleanup. Migration is idempotent and old favorite routes remain readable
during the transition. `npm run maintenance` runs migration followed by cleanup
on demand; the deployed web app also runs it every six hours.

Sync names are lowercase, 2–32 characters, and may contain letters, numbers,
dots, hyphens, and underscores. They identify separate favorite collections but
are not passwords: anyone who knows the deployment URL and sync name can open
the same collection.
