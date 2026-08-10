# H3Zero

## Generate 15-second MiniMax H3 videos in about 90 seconds.

Fast, native-audio video generation with the
[MiniMax-H3 Turbo LoRA](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora),
running on Modal.

**15 seconds at 480p in about 1.5 minutes on a warm RTX PRO 6000.**

One-command deployment · Image, video, and audio references · Cloud-synced
favorites · Original base sampler included

864×480 landscape · 480×864 portrait · Desktop and mobile

## Get started

**Requires:** [Modal account](https://modal.com/docs/guide/modal-user-account-setup)
· Node.js 20+ · Python 3.11+ · Git

```bash
git clone https://github.com/hui-tony-zk/h3zero.git
cd h3zero
npm run setup
```

Open the URL printed after deployment:

```text
web => https://your-workspace--minimax-h3-web.modal.run
```

> Initial setup downloads about 94 GiB of model weights and builds the GPU
> image. Completed downloads are reused if setup is interrupted.

> The deployed endpoint is public and unauthenticated. Anyone with its URL can
> start paid GPU work.

## Turbo by default

H3Zero uses the eight-step
[MiniMax-H3 Turbo LoRA](https://huggingface.co/larryvrh/MiniMax-H3-Turbo-Lora)
for both frame and reference generation. Turn off Turbo in the composer to use
the original 20-step `res_multistep` base workflow.

Turbo is a preview. Cold starts and model loading add time, and actual speed
varies with Modal capacity.

## Create with frames or references

- Generate from text, a first frame, a last frame, or both
- Mix ordered images, videos, and audio in one prompt
- Insert automatic `<Picture 1>`, `<Video 1>`, and `<Audio 1>` references
- Use built-in prompt recipes and crop mismatched keyframes before GPU work
- Follow the official [base](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md)
  and [full-reference](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md)
  prompting guides

![Reference prompt structure with inline guidance in H3Zero](docs/images/h3-rich-reference-editor.png)

## Generate and remix

- Launch one to three variations together
- Track durable jobs from queue through loading, sampling, and decoding
- Keep completed results until you delete them
- Sync favorites and remix sources across devices through Modal

![Two completed durable video jobs in H3Zero](docs/images/h3-video-carousel.png)

## Use the API

The same public URL serves H3Zero and its browser API. Submit, poll, download,
cancel, and delete jobs without a second service. Turbo is the default; send
`"turbo": false` to use base sampling.

See the [browser API guide](docs/api.md) for routes and curl examples.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run setup` | Install, download models, build, and deploy everything |
| `npm run deploy` | Deploy only the gateway and frontend |
| `npm run deploy:gpu` | Deploy intentional GPU worker or workflow changes |
| `npm run generate -- ...` | Generate from the terminal |
| `npm run frontend:dev` | Run the frontend locally |
| `npm test` | Run all no-GPU checks |

Web-only deployment preserves the GPU worker and its CPU memory snapshots. Local
frontend development uses `H3_MODAL_URL` in the root `.env`; deployed H3Zero
uses same-origin `/api` routes and needs no configured base URL.

## Before you deploy

- The first generation may be slower while H3 loads
- The GPU scales to zero after thirty idle seconds
- The endpoint is public and unauthenticated
- Model terms differ from this repository's Apache-2.0 license
- Confirm your location, infrastructure, users, and use case comply with the
  [MiniMax H3 model notice](MODEL_NOTICE.md)

## License

- Repository code: [Apache-2.0](LICENSE)
- Model: [MiniMax H3 Community License notice](MODEL_NOTICE.md)
