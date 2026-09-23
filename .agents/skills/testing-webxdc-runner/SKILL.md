---
name: testing-webxdc-runner
description: How to e2e-test the sandboxed webxdc runner (Run app card) locally, including a workaround for iframe.diy service-worker stalls and how to trigger sendToChat/importFiles without publishing to Nostr.
---

# Testing the webxdc runner locally

The app runs a `.xdc` in an iframe pointed at `https://<hmac-sub>.iframe.diy` (see
`src/components/webxdc/SandboxFrame.tsx`, `src/lib/iframeSubdomain.ts`).

## iframe.diy may stall in Chrome-for-Testing

Third-party service-worker registration inside the sandboxed iframe can hang for
minutes or fail silently (frame shows a spinner forever). A working fallback:

1. `mkdir /tmp/sandboxsrv && cd /tmp/sandboxsrv && curl -O https://any.iframe.diy/ -o index.html && curl -O https://any.iframe.diy/sw.js` then `python3 -m http.server 8081`.
2. Temp-edit `SandboxFrame` origin to `` `http://${id}.localhost:8081` `` (localhost subdomains resolve to 127.0.0.1).
3. Temp-add `http://*.localhost:8081` to `frame-src` in the `index.html` CSP meta.
4. Reload the page. First SW install on a fresh subdomain takes ~5-15s.

Caveat: an origin's SW gets poisoned if the iframe is reloaded mid-init (blank
frame / "Something went wrong"). Fix: change the webxdc `identifier` prop to get
a fresh subdomain.

## Triggering webxdc.* RPCs without publishing to Nostr

App detail pages need an event with an https `.xdc` URL. Simpler: temp-add a route
rendering `<WebxdcRunner identifier="test" xdcUrl="/test.xdc" appName="Test App" />`
with a hand-made zip in `public/test.xdc` (`zip` an index.html that calls
`window.webxdc.sendToChat(...)` / `importFiles(...)` and logs results into the DOM).

- `sendToChat` rejects `Log in to share from this app` when logged out — testable
  anonymously. To exercise the dialog without a real login, temp-stub
  `useCurrentUser` to return `{ pubkey: 'a'.repeat(64) }` — the dialog opens;
  use Cancel (Post would try to sign/publish).
- `importFiles` needs no login; the prompt's `Choose…` opens the OS file picker
  (drive it with Ctrl+L + path).
- KNOWN BUG (verify before assuming fixed): the injected bridge must postMessage
  to the **frame origin** (`https://${id}.${SANDBOX_DOMAIN}`), not
  `window.location.origin` — the inner iframe's parent is the iframe.diy loader,
  not the app page.

## Devin Secrets Needed

None for anonymous testing. A real Nostr login (nsec) is only needed to test the
Post-note path of SendToChatDialog — request user approval before doing that.
