# Browser API

The deployed `https://...modal.run` URL serves H3Zero and the same-origin API.
The endpoint is public and does not require a Modal or Hugging Face API key.
Polling, static files, and video downloads are CPU-only.

Both generation modes use the preview MiniMax-H3 Turbo LoRA with its required
version-adaptive audio/video sampler. The default is eight `simple` steps at
LoRA strength `1.0`; `/api/specs` reports the pinned filename and supported
4–8 step range.

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
| `DELETE` | `/api/jobs/{id}` | Cancel and delete a job |
| `GET` | `/api/cloud-sync/{username}/favorites` | List a sync name's favorites |
| `PUT` | `/api/cloud-sync/{username}/favorites/{id}` | Save favorite metadata and remix sources |
| `DELETE` | `/api/cloud-sync/{username}/favorites/{id}` | Remove a favorite and its copied sources |
| `GET` | `/api/cloud-sync/{username}/assets/{id}` | Fetch a saved remix source |

## Submit a Frames job

`prompt` is required. `config` is a JSON string. First and last frames accept
PNG, JPEG, or WebP files up to 20 MiB.

```bash
curl -X POST "$H3_MODAL_URL/api/jobs" \
  -F 'prompt=A paper dragon wakes. Audio: paper rustling.' \
  -F 'config={"mode":"frames","duration_seconds":5,"geometry_source":"first_frame"}' \
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
metadata, seed, Turbo LoRA and sampler details, assigned reference tags, and
`video_url`.

## Local development

Start a temporary Modal endpoint:

```bash
.venv/bin/python -m modal serve modal_services/h3.py
```

On Windows use `.venv\Scripts\python.exe`. Put the printed URL in the root
`.env` as `H3_MODAL_URL`, then run `npm run frontend:dev`. This `.env` setting is
only for Vite's local `/api` proxy; never put Modal credentials in it.

## Favorites

Favorites are stored under a Modal cloud sync name in the same durable output
Volume as completed jobs. The generated video is not duplicated. A favorite
may additionally store copies of its source inputs so another browser can
restore them for remixing.

```http
GET /api/cloud-sync/{username}/favorites
PUT /api/cloud-sync/{username}/favorites/{job_id}
DELETE /api/cloud-sync/{username}/favorites/{job_id}
GET /api/cloud-sync/{username}/assets/{asset_id}
```

`PUT` accepts multipart fields named `job` (the browser job JSON), `assets` (an
array of source-asset descriptors), and matching file fields `asset_0`,
`asset_1`, and so on. Only completed jobs with an existing persisted video can
be favorited. Removing a favorite deletes its copied sources but not the
generated video.

Sync names are lowercase, 2–32 characters, and may contain letters, numbers,
dots, hyphens, and underscores. They identify separate favorite collections but
are not passwords: anyone who knows the deployment URL and sync name can open
the same collection.
