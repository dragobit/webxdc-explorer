# webxdc explorer

A dedicated [Nostr](https://nostr.com) client for [webxdc](https://webxdc.org/) apps, built on the [mkstack-devin](https://github.com/dragobit/mkstack-devin) template (React 19, Vite, TailwindCSS 4, shadcn/ui, Nostrify).

Implements [NIP-DC](https://gitlab.com/soapbox-pub/dittoroma/-/blob/main/NOSTR_WEBXDC.md) (Nostr Webxdc):

- **Explore** — unified search over webxdc app posts (`imeta` attachments / kind `1063` file metadata) and kind `4932` state-update messages.
- **My Apps** — grid/list view of the webxdc apps you have participated in (derived from your own kind `4932` updates).
- **App detail** (`/app/:i`) — per-`i` view: the app event plus its full update log, inspectable as raw event JSON.

## Development

```bash
npm run dev    # local dev server
npm run test   # tsc + eslint + vitest + build (same as CI)
```

See `AGENTS.md` for project conventions and `src/lib/webxdc.ts` for the shared NIP-DC parsing contract.
