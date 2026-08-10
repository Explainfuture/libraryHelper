export type BookBridgeRoute =
  { kind: "receive"; peerId: string; token: string } | { kind: "invalid" };

export function parseRoute(hash: string): BookBridgeRoute {
  const routeURL = new URL(
    hash.replace(/^#/u, "") || "/",
    "https://route.local",
  );
  if (routeURL.pathname === "/receive") {
    const peerId = routeURL.searchParams.get("peer") ?? "";
    const token = routeURL.searchParams.get("token") ?? "";
    if (peerId !== "" && token !== "") {
      return { kind: "receive", peerId, token };
    }
  }
  return { kind: "invalid" };
}
