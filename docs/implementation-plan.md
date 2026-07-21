# Implementation plan

BookBridge will be delivered in small, independently verified batches:

1. **Complete:** Establish the pnpm monorepo and implement the bounded Chrome Native
   Messaging frame codec with Go unit tests.
2. **Complete:** Add EPUB validation and the concurrency-safe transfer session store.
3. **Complete:** Add LAN address selection and the hardened local HTTP download server.
4. **Complete:** Connect the native host request loop to transfer creation, cancellation,
   expiry, and completion events.
5. **In progress:** Build the WXT/React extension.
   - **Complete:** Manifest V3 foundation, minimal permissions, EPUB download
     listener, bounded deduplication, session storage, strict protocol parsing,
     popup foundation, and TypeScript tests.
   - **Complete:** Persistent native channel, request timeouts, exponential
     reconnects, transfer-state persistence, completion events, and host-error
     notifications.
   - **Next:** QR transfer window, countdown, copying, cancellation, and
     success-state UI.
6. Add Windows build, install, uninstall, and development scripts; then run the
   complete lint, typecheck, test, build, and manual Chrome verification gates.
