# BookBridge native host

This directory contains the standalone Go process used by Chrome Native
Messaging. Current packages implement the bounded, length-prefixed message
codec, EPUB archive metadata validation, and temporary transfer session
lifecycle. The LAN HTTP service adds deterministic private-address selection,
bounded port fallback, a self-contained mobile page, and guarded EPUB
streaming. The native messaging request loop is delivered in a later batch.
