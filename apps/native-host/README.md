# BookBridge native host

This directory contains the standalone Go process used by Chrome Native
Messaging. Current packages implement the bounded, length-prefixed message
codec, EPUB archive metadata validation, and temporary transfer session
lifecycle. The LAN HTTP service adds deterministic private-address selection,
bounded port fallback, a self-contained mobile page, and guarded EPUB
streaming. `cmd/bookbridge-host` provides the standalone executable: stdout is
reserved for framed protocol messages, while diagnostics are written to
stderr. The host accepts strict `CREATE_TRANSFER` and `CANCEL_TRANSFER`
requests and emits `TRANSFER_COMPLETED` after a successful full download.
