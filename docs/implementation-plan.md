# Implementation plan

BookBridge will be delivered in small, independently verified batches:

1. **Complete:** Establish the pnpm monorepo and implement the bounded Chrome Native
   Messaging frame codec with Go unit tests.
2. **Complete:** Add EPUB validation and the concurrency-safe transfer session store.
3. **Complete:** Add LAN address selection and the hardened local HTTP download server.
4. **Complete:** Connect the native host request loop to transfer creation, cancellation,
   expiry, and completion events.
5. **Complete:** Build the WXT/React extension.
   - **Complete:** Manifest V3 foundation, minimal permissions, EPUB download
     listener, bounded deduplication, session storage, strict protocol parsing,
     popup foundation, and TypeScript tests.
   - **Complete:** Persistent native channel, request timeouts, exponential
     reconnects, transfer-state persistence, completion events, and host-error
     notifications.
   - **Complete:** Automatically opened QR transfer window, countdown, copying,
     cancellation, session-backed status updates, and terminal-state UI.
6. **Complete:** Add Windows build, current-user install, safe uninstall, and
   parallel WXT/Go development scripts; document Chrome/iPhone setup and run
   the automated lint, typecheck, test, and build gates.
7. **Complete:** Generate Chrome-compatible raster icons, isolate HTTP handler
   panics, centralize Native Messaging manifest generation, verify builds from
   Unicode/space paths, and load the production extension in isolated Chromium
   to prove its exact permissions, MV3 worker, and popup.
8. **Manual release gate:** Verify the installed host with real Google Chrome,
   approve only the private-network Windows Firewall scope, and complete the
   QR/download/Apple Books flow on a real iPhone on the same Wi-Fi.
