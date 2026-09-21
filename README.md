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

## Deployment

`npm run deploy` builds `dist/` and publishes it as a NIP-5A *nsite* via `scripts/deploy-nsite.mjs` (Blossom uploads + kind `15128` manifest), live at `https://<app-npub>.nsite.lol`.

On CI, `.github/workflows/deploy-nsite.yml` does this on every push to `main` using the `NSITE_NSEC` repository secret (an `nsec1...` key whose npub is the site's address); `NSITE_RELAYS` / `NSITE_BLOSSOM_SERVERS` repository variables override the defaults. `.github/workflows/deploy.yml` (GitHub Pages) is disabled by default — set `DEPLOY_GH_PAGES=true` as a repository variable or run it manually to use it.

See `AGENTS.md` for project conventions and `src/lib/webxdc.ts` for the shared NIP-DC parsing contract.
