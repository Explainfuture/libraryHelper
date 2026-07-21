# BookBridge

BookBridge is an open-source, Windows-first tool for transferring EPUB files
that the user has downloaded normally in Chrome to an iPhone on the same local
network. It is designed to remain independent of book websites: it does not
read cookies, credentials, authorization headers, or page content, and it does
not call a cloud service.

> Only transfer files that you have the right to use.

## Repository layout

- `apps/extension` — WXT, React, and TypeScript Chrome extension (next phase)
- `apps/native-host` — Go native host and local HTTP server
- `docs` — architecture and implementation notes
- `scripts` — Windows build and installation scripts (planned)

## Current development status

The first implementation batch establishes the monorepo and the tested Chrome
Native Messaging frame codec. Transfer sessions, the LAN HTTP server, the
extension, and installation scripts will arrive in focused follow-up batches.

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
