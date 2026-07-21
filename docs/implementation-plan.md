# Implementation plan

BookBridge will be delivered in small, independently verified batches:

1. **Complete:** Establish the pnpm monorepo and implement the bounded Chrome Native
   Messaging frame codec with Go unit tests.
2. **Complete:** Add EPUB validation and the concurrency-safe transfer session store.
3. Add LAN address selection and the hardened local HTTP download server.
4. Connect the native host request loop to transfer creation, cancellation,
   expiry, and completion events.
5. Build the WXT/React extension download listener, persistent native channel,
   popup, QR code, notifications, and TypeScript tests.
6. Add Windows build, install, uninstall, and development scripts; then run the
   complete lint, typecheck, test, build, and manual Chrome verification gates.
