# BookBridge extension

This directory contains the Manifest V3 Chrome extension built with WXT, React,
and TypeScript.

The current increment provides:

- EPUB detection from completed Chrome downloads using the filename or
  `application/epub+zip` MIME type;
- bounded download-ID deduplication and a bounded queue in
  `chrome.storage.session`;
- strict runtime parsing for the native messaging protocol; and
- a minimal popup that documents the current status and privacy boundary.

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
Persistent native-host communication and the QR transfer flow are planned for
the next extension increment.
