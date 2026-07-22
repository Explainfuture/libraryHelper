# BookBridge extension

This directory contains the Manifest V3 Chrome extension built with WXT, React,
and TypeScript.

The current increment provides:

- EPUB detection from completed Chrome downloads using the filename or
  `application/epub+zip` MIME type;
- bounded download-ID deduplication and a bounded queue in
  `chrome.storage.session`;
- strict runtime parsing for the native messaging protocol;
- one persistent Native Messaging connection with request correlation,
  timeouts, exponential-backoff reconnects, and structured error handling;
- session-scoped public transfer records that never contain a local path; and
- an automatically opened QR transfer window with a live countdown, copy and
  cancel controls, and completed, cancelled, and expired states.

The extension requests only `downloads`, `nativeMessaging`, `notifications`,
`storage`, and `windows`. It has no host permissions and does not inspect page
content, cookies, credentials, or authorization headers.

## Development

From the repository root:

```powershell
pnpm install
pnpm --filter @bookbridge/extension test
pnpm --filter @bookbridge/extension lint
pnpm --filter @bookbridge/extension typecheck
pnpm --filter @bookbridge/extension build
```

The unpacked Chrome extension is written to `.output/chrome-mv3` after a build.
Its public manifest key pins the development and release ID to
`hmdckfnmfjkcbacphammiaelinplkkfb`, so Native Messaging installation never
requires copying an ID from Chrome. QR codes are rendered locally as SVG by
`qrcode.react`; the page loads no external assets or services.
