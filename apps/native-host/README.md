# BookBridge native host

This directory contains the standalone Go process used by Chrome Native
Messaging. Current packages implement the bounded, length-prefixed message
codec, EPUB archive metadata validation, and temporary transfer session
lifecycle. The host request loop and LAN transfer service are delivered in
later batches.
