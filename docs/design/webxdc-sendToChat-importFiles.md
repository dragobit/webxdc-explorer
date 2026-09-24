# Design: `sendToChat` / `importFiles` for the webxdc runtime

Status: **implemented** on this branch (previously design-only). Follow-up to PR #12 (webxdc runtime).
Budget for the implementation session: ~5 ACU.

## Context

PR #12 runs `.xdc` apps in an iframe.diy sandbox. `window.webxdc` is a bridge
(`generateWebxdcBridge` in `src/components/webxdc/WebxdcFrame.tsx`) that turns
each API call into a JSON-RPC request to the parent, dispatched in `onRpc`:

```
webxdc.sendToChat  → onRpc → throw new Error('sendToChat is not supported')
webxdc.importFiles → onRpc → return []
```

Armada (`/tmp/armada/src/hooks/useWebxdcApi.ts` in the reference clone) also
stubs both, so there is no reference implementation to copy — this is new work.

Spec (from `@webxdc/types/webxdc.d.ts`, already a dependency):

```ts
type XDCFile = { name: string } & ({ plainText: string } | { base64: string } | { blob: Blob });
type SendOptions = { file: XDCFile; text?: string } | { file?: XDCFile; text: string };

sendToChat(message: SendOptions): Promise<void>;   // "may not resolve", rejects on error
importFiles(filter: { extensions?: string[]; mimeTypes?: string[]; multiple?: boolean }): Promise<File[]>;
```

Both are user-mediated by spec: `sendToChat` must show a draft the user
confirms; `importFiles` must open a picker. Nothing may be sent or read
without a user gesture in the **parent** origin.

## Constraints that shape the design

- **Explorer has no "chat".** The nearest equivalent of "send to the current
  chat" is: publish a Nostr event that references this webxdc session.
- **Signer never enters the iframe.** All publishing/uploading happens in the
  parent (`useNostrPublish`, `useUploadFile`).
- **`Blob` cannot cross the bridge as-is** in the current design: the bridge
  posts messages from the *inner* frame → iframe.diy outer frame → parent, and
  the outer frame relays with structured clone, so `Blob`/`File` *do* survive
  `postMessage`. Still, keep payloads bounded (see limits below).
- **Anonymous users** can run apps but cannot publish/upload; both APIs must
  fail with a clear error (reject) when `user` is null, not hang.
- Reuse existing UI primitives (`src/components/ui/*` shadcn) and hooks; no
  new deps.

## `sendToChat` design

### Behaviour

1. App calls `webxdc.sendToChat({ text, file })`.
2. Bridge → RPC `webxdc.sendToChat` with `{ message }`. `XDCFile` is
   forwarded verbatim (`plainText` | `base64` | `blob`).
3. Parent opens a **confirmation dialog** ("Share from *AppName*") in the
   `WebxdcRunner` showing:
   - editable text (`Textarea`, prefilled with `message.text`),
   - file preview row (name, size, MIME; image thumbnail when `image/*`),
   - destination: fixed to "Post a note (kind 1)". Keep a single destination
     for the first version; a "Download file only" secondary button is cheap
     and useful when logged out.
4. On confirm:
   - if `file`: `File` = `xdcFileToFile(message.file)`; upload via
     `useUploadFile().mutateAsync(file)` → NIP-94 tags (`url`, `x`, `m`, …);
   - publish kind `1` with:
     - `content`: `${text}\n\n${url}` (url only when a file was uploaded),
     - tags: `imeta` (from upload tags, joined the way `useMyWebxdcApps`/NIP-92
       expects), `["i", identifier]` and `["k", "4932"]`-style reference is
       *not* standard for kind 1 — instead add `["r", xdcUrl]` and a hashtag
       `["t", "webxdc"]`; plus `["client", "webxdc-explorer"]` if the repo
       already uses it elsewhere (check `useNostrPublish`).
   - resolve the RPC. On cancel → reject with `Error('sendToChat cancelled')`.
   - The spec allows the promise to never resolve; resolving on success is
     fine and simpler for apps.

### Placement / code

- `src/components/webxdc/SendToChatDialog.tsx` (new): controlled dialog;
  props `{ open, appName, message: SendOptions, onConfirm(text, file?), onCancel }`.
- `src/hooks/useNostrWebxdcApi.ts`: replace the throwing `sendToChat` with an
  implementation that resolves through a **pending-request ref** exposed to the
  runner:

  ```ts
  // in useNostrWebxdcApi
  const sendToChatRequest = useRef<((m: SendOptions) => Promise<void>) | null>(null);
  const sendToChat = useCallback((m: SendOptions) => {
    if (!user) return Promise.reject(new Error('Log in to share from this app'));
    if (!sendToChatRequest.current) return Promise.reject(new Error('sendToChat is not available'));
    return sendToChatRequest.current(m);
  }, [user]);
  return { api, setSendToChatHandler: (fn) => { sendToChatRequest.current = fn; } };
  ```

  `WebxdcRunner` registers the handler (opens the dialog, returns a promise
  settled by confirm/cancel). Keep the hook UI-free.
- `src/lib/xdcFile.ts` (new, pure, unit-testable): `xdcFileToFile(XDCFile): File`
  (decode `base64` with `base64ToBytes` from `src/lib/sandbox.ts`; sniff MIME
  from the extension with `getMimeType`), plus `SEND_FILE_MAX_BYTES`.
- `WebxdcFrame.onRpc` case `webxdc.sendToChat`: validate shape (`text` string
  ≤ 4 000 chars, `file.name` ≤ 255 chars, exactly one of
  `plainText|base64|blob`), then `await api.sendToChat(message)`.
- Bridge: no change needed (`sendToChat` already calls
  `sendRequest("webxdc.sendToChat", { message })`).

### Limits / security

- File ≤ 10 MiB (Blossom servers commonly cap around there); reject early.
- Never auto-send: the dialog must require a click; ignore repeat requests
  while one dialog is open (reject the second with "busy").
- Sanitise `file.name` (strip path separators / control chars) before use.
- Text is rendered as plain text in the dialog (no markup interpretation).

## `importFiles` design

### Behaviour

1. App calls `webxdc.importFiles({ extensions, mimeTypes, multiple })`.
2. Bridge → RPC `webxdc.importFiles` with `{ filter }`.
3. Parent creates a hidden `<input type="file">` **inside the `WebxdcRunner`**,
   sets `accept` from `[...extensions, ...mimeTypes].join(',')` and
   `multiple`, then `click()`s it.
   - Browsers require a user activation to open the picker, and a click inside
     the cross-origin iframe does not grant activation to the parent window
     when the request arrives via `postMessage`. **Do not rely on `click()`
     from the RPC handler.** Instead show a small inline prompt in the runner toolbar
     ("*AppName* wants to import files — Choose…") whose button opens the
     picker. This is spec-compliant (the spec explicitly allows an integrated
     picker UI) and deterministic across browsers.
4. On `change`: resolve RPC with `File[]`. `File` objects survive structured
   clone through the iframe.diy relay (inner → outer → parent → outer → inner),
   so the RPC **result** can be the `File[]` directly — but `SandboxFrame.handleRpc`
   currently posts `result` via `post(...)` with no transfer list; that is fine
   (clone, not transfer). Verify in the implementation session with a real
   app; fall back to `{ name, type, lastModified, base64 }[]` + reconstruct
   `File` in the bridge if the relay drops Blobs.
5. On cancel (picker closed, or prompt dismissed) → resolve `[]` (spec: empty
   array is the normal "nothing chosen" result).

### Placement / code

- `src/components/webxdc/ImportFilesPrompt.tsx` (new): toolbar strip with
  "Choose…" / "Cancel" and the hidden input. Props
  `{ request: { filter, appName }, onFiles(File[]), onCancel() }`.
- `useNostrWebxdcApi`: same pending-request-ref pattern as `sendToChat`
  (`setImportFilesHandler`). `importFiles` does **not** require login.
- `WebxdcFrame.onRpc` case `webxdc.importFiles`: validate `filter`
  (arrays of strings, extensions must match `/^\.[A-Za-z0-9]+$/`, drop
  invalid ones), cap total selected size at 50 MiB, then
  `return await api.importFiles(filter)`.
- Bridge (`generateWebxdcBridge`): `importFiles` already forwards; if the
  base64 fallback is needed, map results with `new File([bytes], name, {type, lastModified})`.

## Runner integration

`WebxdcRunner` owns the two UI surfaces and wires handlers once:

```tsx
const { api, setSendToChatHandler, setImportFilesHandler } = useNostrWebxdcApi(identifier);
useEffect(() => {
  setSendToChatHandler((m) => new Promise((res, rej) => setChatReq({ m, res, rej })));
  setImportFilesHandler((f) => new Promise((res) => setImportReq({ f, res })));
}, [...]);
```

Both requests are cleared on Stop / unmount (reject `sendToChat`, resolve
`importFiles` with `[]`) so promises inside the (now destroyed) iframe never
dangle in parent state.

Fullscreen mode: render the dialog/prompt inside the fullscreen overlay
container so they are visible above the iframe (`z-index`).

## Test plan (for the implementation session)

- `src/lib/xdcFile.test.ts`: `plainText`/`base64`/`blob` → `File` (name, type,
  bytes), size limit, name sanitisation.
- `src/components/webxdc/SendToChatDialog.test.tsx` (TestApp wrapper):
  confirm → `onConfirm` called with edited text; cancel → `onCancel`.
- `useNostrWebxdcApi`: logged-out `sendToChat` rejects; handler-less
  `importFiles` resolves `[]`.
- Manual: a test `.xdc` that calls both APIs (a ~20-line `index.html` zipped
  and uploaded to Blossom via the My Apps page) — verify a kind 1 appears on
  relays with `imeta`, and that `importFiles` returns readable `File`s in-app.

## Out of scope

- Sending into another app's session / DMs / groups.
- Custom "recent files" picker (spec-optional; use native picker).
- Persisting drafts.

## Implementation checklist

- [ ] `src/lib/xdcFile.ts` + tests
- [ ] `SendToChatDialog.tsx`
- [ ] `ImportFilesPrompt.tsx`
- [ ] `useNostrWebxdcApi`: handler refs, login guard, return `{ api, set*Handler }`
      (update the one call site in `WebxdcRunner`)
- [ ] `WebxdcFrame.onRpc`: validation for both methods; remove the throw / `[]` stubs
- [ ] `WebxdcRunner`: wire handlers, render surfaces (incl. fullscreen), cleanup on Stop
- [ ] Update the "Run app" helper text (mention sharing requires login)
- [ ] `npm run test`, PR
