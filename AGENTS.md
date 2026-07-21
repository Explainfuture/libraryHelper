# BookBridge contributor notes

- Keep the extension website-agnostic. Never read cookies, credentials, authorization headers, or page content.
- Keep Chrome Native Messaging stdout protocol-only; diagnostics belong on stderr.
- Do not commit build artifacts, secrets, account data, or machine-specific absolute paths.
- Prefer focused packages with unit tests. Run `pnpm test`, `pnpm lint`, and `pnpm typecheck` before publishing a batch.
- Windows is the primary supported development and installation platform.
