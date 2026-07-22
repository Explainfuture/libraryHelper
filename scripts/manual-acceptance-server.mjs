import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";

const [portArgument, fixtureDirectoryArgument] = process.argv.slice(2);
const port = Number.parseInt(portArgument ?? "", 10);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
  throw new TypeError("A valid unprivileged loopback port is required.");
}
if (!fixtureDirectoryArgument) {
  throw new TypeError("The fixture directory is required.");
}

const fixtureDirectory = resolve(fixtureDirectoryArgument);
const routes = new Map([
  [
    "/",
    {
      path: resolve(fixtureDirectory, "index.html"),
      contentType: "text/html; charset=utf-8",
    },
  ],
  [
    "/bookbridge-release-test.epub",
    {
      path: resolve(fixtureDirectory, "bookbridge-release-test.epub"),
      contentType: "application/epub+zip",
    },
  ],
]);

const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    response.writeHead(405).end("method not allowed");
    return;
  }

  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const route = url.search === "" ? routes.get(url.pathname) : undefined;
  if (route === undefined) {
    response.writeHead(404).end("not found");
    return;
  }

  let file;
  try {
    file = statSync(route.path);
  } catch {
    response.writeHead(404).end("not found");
    return;
  }
  if (!file.isFile()) {
    response.writeHead(404).end("not found");
    return;
  }

  response.setHeader("Content-Type", route.contentType);
  response.setHeader("Content-Length", file.size);
  response.writeHead(200);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(route.path).pipe(response);
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(
    `BookBridge fixture server listening on 127.0.0.1:${port}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
