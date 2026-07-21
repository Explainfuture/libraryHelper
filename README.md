# BookBridge

BookBridge is an open-source, Windows-first tool for transferring EPUB files
that the user has downloaded normally in Chrome to an iPhone on the same local
network. It is designed to remain independent of book websites: it does not
read cookies, credentials, authorization headers, or page content, and it does
not call a cloud service.

> Only transfer files that you have the right to use.

## Repository layout

- `apps/extension` — WXT, React, and TypeScript Chrome extension
- `apps/native-host` — Go native host and local HTTP server
- `docs` — architecture and implementation notes
- `scripts` — Windows build and installation scripts (planned)

## Current development status

The native host currently includes the tested Chrome Native Messaging frame
codec, bounded EPUB metadata validation, and a concurrency-safe in-memory
transfer session store. It also includes RFC1918 LAN address selection and a
hardened mobile HTTP download service with single-download claiming, safe
headers, expiry enforcement, and failed-token rate limiting. The standalone Go
native host validates strict CREATE/CANCEL messages, serializes responses and
completion events on stdout, and keeps active HTTP sessions alive for a bounded
period after the Native Messaging pipe closes.

The loadable Manifest V3 extension now has the minimal requested permission
set, strict TypeScript protocol parsing, EPUB download detection and bounded
deduplication, and session-scoped transfer state. Its persistent Native
Messaging client correlates requests, enforces timeouts, reconnects with
exponential backoff, handles completion events, and reports an unavailable
local helper through a Chrome notification. The QR transfer window and Windows
installation scripts will arrive in focused follow-up batches.

## Development

Requirements:

- Go 1.24 or newer
- Node.js 22 or newer
- pnpm 10

Install JavaScript tooling and run the current checks:

```powershell
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The native host codec can also be tested directly:

```powershell
go test ./...
```

## License

[MIT](LICENSE)
