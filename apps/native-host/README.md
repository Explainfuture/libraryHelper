# BookBridge native host

This directory contains the standalone Go process used by Chrome Native
Messaging. The initial package implements the bounded, length-prefixed message
codec. The host request loop and LAN transfer service are delivered in later
batches.
