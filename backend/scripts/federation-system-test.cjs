#!/usr/bin/env node
/**
 * Two-instance federation system test (design §11, layer 3).
 *
 * Starts two real backends from throwaway deployment roots (a peer and a
 * prime, each with its own database, uploads and federation key), seeds the
 * peer, and drives the whole loop over HTTP:
 *   issue a token -> register the peer -> sync -> read and stream through the
 *   prime's gateway -> edit/delete on the peer and resync -> revoke mid-stream
 *   -> replace the credential.
 *
 * Nothing touches backend/data. Usage (from backend/):
 *   npm run test:federation-system            # cleans up afterwards
 *   KEEP=1 npm run test:federation-system     # keeps roots and logs
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");

const BACKEND = path.resolve(__dirname, "..");
const TS_NODE = path.join(BACKEND, "node_modules", ".bin", "ts-node");
const Database = require(path.join(BACKEND, "node_modules", "better-sqlite3"));

const MEDIA_BYTES = 48 * 1024 * 1024;
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeRoot(base, name) {
  const root = path.join(base, name);
  fs.mkdirSync(path.join(root, "uploads", "videos"), { recursive: true });
  fs.cpSync(path.join(BACKEND, "drizzle"), path.join(root, "drizzle"), { recursive: true });
  return root;
}

function startBackend(root, port) {
  const log = fs.openSync(path.join(root, "server.log"), "a");
  const child = spawn(TS_NODE, ["--project", path.join(BACKEND, "tsconfig.json"), path.join(BACKEND, "src", "server.ts")], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", NO_PROXY: "127.0.0.1,localhost" },
    stdio: ["ignore", log, log],
  });
  return child;
}

/** A tiny client that carries the CSRF cookie and header like the browser does. */
function client(port) {
  const base = `http://127.0.0.1:${port}`;
  let cookie = "";
  let csrf = "";
  const remember = (response) => {
    const token = response.headers.get("x-csrf-token");
    if (token) csrf = token;
    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const entry of setCookie) {
      const pair = entry.split(";")[0];
      if (pair.startsWith("mytube_csrf=")) cookie = pair;
    }
  };
  const call = async (method, url, body, headers = {}) => {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf && method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    remember(response);
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    return { status: response.status, json, text, headers: response.headers };
  };
  return {
    base,
    ready: async (timeoutMs = 180_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const response = await call("GET", "/api/settings/password-enabled");
          if (response.status === 200) return;
        } catch {
          /* not listening yet */
        }
        await sleep(500);
      }
      throw new Error(`backend on ${port} did not become ready`);
    },
    get: (url, headers) => call("GET", url, undefined, headers),
    post: (url, body = {}) => call("POST", url, body),
    put: (url, body) => call("PUT", url, body),
    delete: (url) => call("DELETE", url),
  };
}

const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

async function main() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-federation-system-"));
  const peerRoot = makeRoot(base, "peer");
  const primeRoot = makeRoot(base, "prime");
  const [peerPort, primePort] = [await freePort(), await freePort()];
  console.log(`roots: ${base}\npeer :${peerPort}  prime :${primePort}`);

  const children = [startBackend(peerRoot, peerPort), startBackend(primeRoot, primePort)];
  const peer = client(peerPort);
  const prime = client(primePort);
  try {
    await Promise.all([peer.ready(), prime.ready()]);
    check("both backends start from isolated roots", true);

    // --- Seed the peer: a managed file, a mounted file, and a hidden video ---
    const media = crypto.randomBytes(MEDIA_BYTES);
    fs.writeFileSync(path.join(peerRoot, "uploads", "videos", "clip.mp4"), media);
    const mountDir = path.join(base, "peer-mount");
    fs.mkdirSync(mountDir);
    const mounted = crypto.randomBytes(256 * 1024);
    fs.writeFileSync(path.join(mountDir, "movie.mp4"), mounted);
    const peerDb = new Database(path.join(peerRoot, "data", "mytube.db"));
    peerDb.pragma("busy_timeout = 10000");
    const insert = peerDb.prepare(
      "INSERT INTO videos (id, title, author, created_at, video_path, visibility, media_type) VALUES (?, ?, ?, ?, ?, ?, 'video')"
    );
    insert.run("local-1", "Local clip", "Alice", "2026-01-03T00:00:00.000Z", "/videos/clip.mp4", 1);
    insert.run("mount-1", "Mounted movie", "Bob", "2026-01-02T00:00:00.000Z", `mount:${path.join(mountDir, "movie.mp4")}`, 1);
    insert.run("hidden-1", "Hidden clip", "Alice", "2026-01-01T00:00:00.000Z", "/videos/clip.mp4", 0);
    peerDb.close();

    // --- Peer issues a public-ceiling credential ---------------------------
    await peer.get("/api/settings/password-enabled");
    const minted = await peer.post("/api/federation/tokens", { label: "prime", scopes: ["library:read", "media:read"] });
    check("peer mints a credential", minted.status === 201, `HTTP ${minted.status}`);

    // --- Prime registers and syncs ----------------------------------------
    await prime.get("/api/settings/password-enabled");
    const registered = await prime.post("/api/federation/peers", {
      name: "Peer",
      baseUrl: peer.base,
      credential: minted.json.credential,
    });
    check("prime registers the peer as a LAN exception", registered.status === 201 && registered.json.peer.lanException, `HTTP ${registered.status}`);
    const peerId = registered.json.peer.id;
    const synced = await prime.post(`/api/federation/peers/${peerId}/sync`);
    check("first sync succeeds", synced.json?.result?.status === "ok", JSON.stringify(synced.json?.result));

    let library = (await prime.get("/api/federation/library")).json;
    const titles = library.items.map((item) => item.title).sort();
    check("public library excludes the hidden video", JSON.stringify(titles) === JSON.stringify(["Local clip", "Mounted movie"]), titles.join(", "));
    check("remote items get prime ids", library.items.every((item) => /^fed_/.test(item.id)));
    const local = library.items.find((item) => item.title === "Local clip");
    const mount = library.items.find((item) => item.title === "Mounted movie");

    // --- Detail and streaming through the gateway ---------------------------
    const detail = await prime.get(`/api/federation/library/${local.id}`);
    check("detail is read fresh from the peer", detail.status === 200 && detail.json.id === local.id);

    const range = await fetch(`${prime.base}/api/federation/media/${local.id}/media`, { headers: { Range: "bytes=1000000-1000099" } });
    const rangeBody = Buffer.from(await range.arrayBuffer());
    check(
      "a Range seek through the gateway returns the exact bytes",
      range.status === 206 && rangeBody.equals(media.subarray(1000000, 1000100)),
      `HTTP ${range.status}, ${range.headers.get("content-range")}`
    );
    const whole = await fetch(`${prime.base}/api/federation/media/${mount.id}/media`);
    check("mounted media streams whole and intact", whole.status === 200 && sha256(Buffer.from(await whole.arrayBuffer())) === sha256(mounted));

    // --- Changes on the peer reach the prime -------------------------------
    await peer.put("/api/videos/local-1", { title: "Renamed clip" });
    const afterEdit = await prime.post(`/api/federation/peers/${peerId}/sync`);
    library = (await prime.get("/api/federation/library")).json;
    check(
      "an edit on the peer syncs, keeping the item id",
      afterEdit.json.result.changed && library.items.some((item) => item.id === local.id && item.title === "Renamed clip")
    );

    const deleted = await peer.delete("/api/videos/mount-1");
    const afterDelete = await prime.post(`/api/federation/peers/${peerId}/sync`);
    library = (await prime.get("/api/federation/library")).json;
    check(
      "a deletion on the peer tombstones the item",
      deleted.status < 300 && afterDelete.json.result.tombstoned === 1 && library.total === 1,
      JSON.stringify(afterDelete.json.result)
    );

    // --- Revocation ends an in-flight stream --------------------------------
    const received = await new Promise((resolve) => {
      let bytes = 0;
      const req = http.get(`${prime.base}/api/federation/media/${local.id}/media`, (res) => {
        res.once("data", async (chunk) => {
          bytes += chunk.length;
          res.pause();
          await peer.post(`/api/federation/tokens/${minted.json.token.id}/revoke`);
          res.on("data", (more) => (bytes += more.length));
          res.resume();
        });
        res.on("close", () => resolve(bytes));
      });
      req.on("error", () => resolve(bytes));
    });
    check("revoking the token on the peer cuts the prime's stream", received < MEDIA_BYTES, `${received} of ${MEDIA_BYTES} bytes`);

    const afterRevoke = await prime.post(`/api/federation/peers/${peerId}/sync`);
    library = (await prime.get("/api/federation/library")).json;
    check(
      "the revoked peer is quarantined",
      afterRevoke.json.result.status === "credential_rejected" && library.total === 0,
      afterRevoke.json.result.status
    );

    // --- A new credential restores the same items ---------------------------
    const reissued = await peer.post("/api/federation/tokens", { label: "prime-2", scopes: ["library:read", "media:read"] });
    const replaced = await prime.put(`/api/federation/peers/${peerId}/credential`, { credential: reissued.json.credential });
    const afterReplace = await prime.post(`/api/federation/peers/${peerId}/sync`);
    library = (await prime.get("/api/federation/library")).json;
    check(
      "a replacement credential resumes with the same item id",
      replaced.status === 200 && afterReplace.json.result.status === "ok" && library.items[0]?.id === local.id,
      afterReplace.json.result.status
    );

    // --- The prime is not a federation peer for its own visitors -------------
    const selfUse = await peer.post("/api/federation/tokens", { label: "self", scopes: ["library:read"] });
    const selfRegister = await peer.post("/api/federation/peers", {
      name: "Myself",
      baseUrl: peer.base,
      credential: selfUse.json.credential,
    });
    check("an instance refuses to register itself", selfRegister.status === 409, selfRegister.json?.code);
  } catch (error) {
    check("system test ran to completion", false, error instanceof Error ? error.message : String(error));
  } finally {
    for (const child of children) child.kill("SIGTERM");
    await sleep(500);
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    const failed = results.filter((result) => !result.ok);
    if (process.env.KEEP || failed.length > 0) {
      console.log(`roots and server logs kept in ${base}`);
    } else {
      fs.rmSync(base, { recursive: true, force: true });
    }
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exitCode = failed.length > 0 ? 1 : 0;
  }
}

void main();
