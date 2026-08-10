# Pure-browser implementation

BookBridge now separates lightweight download detection from browser-to-browser
file transfer:

1. The Manifest V3 extension detects completed EPUB downloads and opens its own
   `transfer.html` page with only a filename hint.
2. The user grants read-only access to one or more actual save directories on
   any drive. The extension stores those handles in IndexedDB and checks only a
   direct child whose name and size match Chrome's completed download event.
3. If no authorized directory matches, the user explicitly selects the file as
   a safe fallback.
4. The extension validates the EPUB archive and creates a random PeerJS/WebRTC
   pairing session.
5. The QR code keeps the Peer ID and authentication token in the URL fragment.
6. The receiver authenticates inside the encrypted data channel, receives
   bounded ordered chunks, reconstructs the EPUB, and offers the system share
   sheet or a download.
7. GitHub Pages hosts only the static phone receiver. PeerJS Cloud carries
   signaling, and STUN discovers a direct route; no TURN/file relay is
   configured.
8. GitHub Actions deploys the web app and produces one extension ZIP suitable
   for Chrome Web Store upload or unpacked GitHub installation.

The retired Go Native Host, registry installer, firewall workflow, local HTTP
server, and native messaging protocol have been removed.
