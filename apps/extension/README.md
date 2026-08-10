# BookBridge extension

This directory contains the small Manifest V3 Chrome extension built with WXT,
React, and TypeScript.

The extension:

- detects completed EPUB downloads by filename or MIME type;
- strips the local directory and passes only a suggested filename to its own
  extension page;
- stores user-selected read-only directory handles in extension IndexedDB and
  matches only a direct child with the completed download's filename and size;
- supports multiple authorized folders on any drive, with manual selection as
  a fallback;
- validates the selected EPUB, creates the WebRTC sender, and renders the QR
  code and progress inside `transfer.html`; and
- provides a manual “Choose EPUB” action from the popup.

The QR code points to the hosted phone receiver. The hosted page never acts as
the desktop sender.

It requests only `downloads`, `notifications`, and `windows`. It has no host
permissions, content scripts, native messaging, unrestricted filesystem access,
or page-data access.

Directory access uses the browser's File System Access permission prompt rather
than a manifest permission. The user grants and can remove each folder
explicitly; BookBridge does not recursively enumerate authorized folders.

From the repository root:

```powershell
pnpm --filter @bookbridge/extension test
pnpm --filter @bookbridge/extension lint
pnpm --filter @bookbridge/extension typecheck
pnpm --filter @bookbridge/extension build
```

The unpacked extension is written to `.output/chrome-mv3`. The manifest public
key keeps GitHub unpacked builds on a stable development ID. Runtime code does
not depend on that ID.
