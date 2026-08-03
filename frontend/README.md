# H3Zero frontend

Vite, React, Tailwind, and Tiptap frontend for the MiniMax H3 Modal app.
Production is built into the Modal ASGI deployment.

## Develop locally

Put the deployed or `modal serve` URL in the root `.env`:

```env
H3_MODAL_URL=https://your-workspace--minimax-h3-web.modal.run
```

Then run from the repository root:

```bash
npm run frontend:dev
```

Vite opens on `http://localhost:5173` and proxies `/api` to Modal.

## Build

```bash
npm run frontend:build
```
