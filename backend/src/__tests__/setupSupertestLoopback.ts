import type { Server } from "http";
import type { AddressInfo } from "net";
import supertest from "supertest";

/**
 * Make supertest reach its own server over IPv6 loopback.
 *
 * supertest calls `listen(0)`, which binds the dual-stack `[::]`, and then
 * connects to `127.0.0.1:<port>`. On macOS a listener bound to 127.0.0.1 alone
 * wins over the wildcard one, and OrbStack, temporal and other local dev tools
 * keep such listeners in the ephemeral range. When the random port coincides,
 * the request reaches that app instead, and a test fails with a stray 404,
 * "socket hang up" or a parse error. Linux refuses that double bind, so CI
 * never sees it.
 *
 * Those apps listen on IPv4 only, so connecting to `[::1]` always reaches the
 * test server. supertest reads the address synchronously right after
 * `listen(0)`, so the server cannot be moved to a 127.0.0.1 bind instead; Node
 * binds asynchronously whenever a host is given. A server bound elsewhere
 * (127.0.0.1 or IPv4-only `0.0.0.0`) keeps the URL supertest built.
 *
 * Tests that start their own server and connect to 127.0.0.1 should listen on
 * "127.0.0.1" explicitly and wait for "listening".
 */
type ServerAddress = (this: unknown, app: Server, path: string) => string;
const proto = supertest.Test.prototype as unknown as { serverAddress: ServerAddress };
const patched = Symbol.for("mytube.test.supertestLoopback");
const marked = proto as unknown as Record<symbol, boolean>;

if (!marked[patched]) {
  const serverAddress = proto.serverAddress;
  proto.serverAddress = function (app, path) {
    const url = serverAddress.call(this, app, path);
    const bound = app.address() as AddressInfo | null;
    return bound?.address === "::" ? url.replace("://127.0.0.1:", "://[::1]:") : url;
  };
  marked[patched] = true;
}
