import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import dns from "node:dns/promises";
import net from "node:net";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { publicAxiosGet } from "../../utils/publicAxios";
import { getAxiosProxyConfig } from "../../utils/ytdlp/proxy";

const PUBLIC = "93.184.216.34";
let port: number, proxyPort: number, hits: string[], forwarded: string[], checked: string[];
const servers: net.Server[] = [], sockets = new Set<net.Socket>();
const listen = (server: net.Server) => new Promise<number>(resolve => {
  servers.push(server);
  server.on("connection", socket => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port));
});

beforeEach(async () => {
  hits = []; forwarded = []; checked = [];
  for (const key of ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]) vi.stubEnv(key, "");
  port = await listen(http.createServer((request, response) => {
    hits.push(request.url!);
    if (request.url!.startsWith("/literal/")) {
      response.writeHead(302, { Location: `http://${request.url!.slice(9)}:${port}/secret` }); response.end();
    } else if (request.url === "/redirect" || request.url === "/literal") {
      const host = request.url === "/redirect" ? "private.example" : "127.0.0.1";
      response.writeHead(302, { Location: `http://${host}:${port}/secret` }); response.end();
    } else response.end("public content");
  }));
  proxyPort = await listen(http.createServer((request, response) => {
    forwarded.push(request.url!);
    const outgoing = http.request({ hostname: "127.0.0.1", port, path: new URL(request.url!).pathname }, incoming => {
      response.writeHead(incoming.statusCode!, incoming.headers); incoming.pipe(response);
    });
    outgoing.on("error", () => response.destroy()); request.pipe(outgoing);
  }));
  vi.spyOn(dns, "lookup").mockImplementation(async hostname => [
    { address: hostname === "private.example" ? "127.0.0.1" : PUBLIC, family: 4 },
  ] as never);
  // Map only addresses already returned by the guard to the local fixture.
  const create = http.globalAgent.createConnection.bind(http.globalAgent);
  vi.spyOn(http.globalAgent, "createConnection").mockImplementation(((options: net.TcpNetConnectOpts, callback: any) => {
    if (!options.lookup) return create(options, callback);
    const lookup = options.lookup;
    return create({ ...options, lookup(hostname, lookupOptions, done) {
      lookup(hostname, lookupOptions, (error, address, family) => {
        if (error) return done(error, "");
        const addresses = typeof address === "string" ? [{ address, family }] : address;
        checked.push(...addresses.map(item => item.address));
        expect(addresses.every(item => item.address === PUBLIC)).toBe(true);
        done(null, lookupOptions.all ? [{ address: "127.0.0.1", family: 4 }] : "127.0.0.1", 4);
      });
    } }, callback);
  }) as typeof http.globalAgent.createConnection);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const socket of sockets) socket.destroy();
  for (const server of servers.splice(0)) {
    if (server instanceof http.Server) server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

it("pins a public DNS answer at the actual socket lookup", async () => {
  expect((await publicAxiosGet(`http://public.example:${port}/video`)).data).toBe("public content");
  expect(checked).toEqual([PUBLIC]); expect(hits).toEqual(["/video"]);
});
it.each(["private.example", "127.0.0.1", "198.18.0.1"])("blocks direct %s before reaching the server", async host => {
  await expect(Promise.resolve().then(() => publicAxiosGet(`http://${host}:${port}/secret`))).rejects.toBeDefined();
  expect(hits).toEqual([]); expect(checked).toEqual([]);
});
it.each(["redirect", "literal"])("blocks the %s hop", async path => {
  await expect(publicAxiosGet(`http://public.example:${port}/${path}`)).rejects.toBeDefined();
  expect(hits).toEqual([`/${path}`]);
});
it("checks new DNS answers after a later connection (rebinding)", async () => {
  await publicAxiosGet(`http://public.example:${port}/first`);
  http.globalAgent.destroy();
  vi.mocked(dns.lookup).mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
  await expect(publicAxiosGet(`http://public.example:${port}/secret`)).rejects.toBeDefined();
  expect(hits).toEqual(["/first"]);
});
it.each(["127.0.0.1", "localhost"])("allows only the configured storage origin at %s", async host => {
  const origin = `http://${host}:${port}`;
  expect((await publicAxiosGet(`${origin}/video`, {}, origin)).data).toBe("public content");
  expect((await publicAxiosGet(`${origin}/literal/${host}`, {}, origin)).data).toBe("public content");
  expect(checked).toEqual([]); expect(dns.lookup).not.toHaveBeenCalled();
  await expect(Promise.resolve().then(() => publicAxiosGet(`http://${host}:${proxyPort}/secret`, {}, origin))).rejects.toBeDefined();
  expect(forwarded).toEqual([]);
});
it.each(["redirect", "literal/198.18.0.1", "literal/[2001:db8::1]"])("guards a redirect leaving a trusted storage origin via %s", async path => {
  const origin = `http://127.0.0.1:${port}`;
  await expect(publicAxiosGet(`${origin}/${path}`, {}, origin)).rejects.toBeDefined();
  expect(hits).toEqual([`/${path}`]); expect(checked).toEqual([]);
});
it("pins public DNS after a redirect leaves the configured storage origin", async () => {
  const origin = `http://127.0.0.1:${port}`;
  expect((await publicAxiosGet(`${origin}/literal/public.example`, {}, origin)).data).toBe("public content");
  expect(checked).toEqual([PUBLIC]); expect(hits).toEqual(["/literal/public.example", "/secret"]);
});
it("keeps proxy DNS for a configured storage origin and its redirect", async () => {
  vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${proxyPort}`);
  vi.mocked(dns.lookup).mockRejectedValue(new Error("ENOTFOUND"));
  expect((await publicAxiosGet("http://storage.invalid/redirect", {}, "http://storage.invalid")).data).toBe("public content");
  expect(forwarded).toEqual(["http://storage.invalid/redirect", `http://private.example:${port}/secret`]);
  expect(dns.lookup).not.toHaveBeenCalled(); expect(checked).toEqual([]);
});
it("guards NO_PROXY redirects out of a configured storage origin", async () => {
  vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${proxyPort}`); vi.stubEnv("NO_PROXY", "private.example");
  await expect(publicAxiosGet("http://storage.invalid/redirect", {}, "http://storage.invalid")).rejects.toBeDefined();
  expect(forwarded).toEqual(["http://storage.invalid/redirect"]); expect(hits).toEqual(["/redirect"]);
});
it.each(["198.18.0.1", "127.0.0.1", "ENOTFOUND"])("keeps HTTP proxy DNS when local resolution gives %s", async address => {
  if (address === "ENOTFOUND") vi.mocked(dns.lookup).mockRejectedValue(new Error(address));
  else vi.mocked(dns.lookup).mockResolvedValue([{ address, family: 4 }] as never);
  vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${proxyPort}`);
  expect((await publicAxiosGet("http://remote.invalid/video")).data).toBe("public content");
  expect(forwarded).toEqual(["http://remote.invalid/video"]); expect(dns.lookup).not.toHaveBeenCalled();
});
it("guards a proxied redirect that matches NO_PROXY", async () => {
  vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${proxyPort}`); vi.stubEnv("NO_PROXY", "private.example");
  await expect(publicAxiosGet("http://remote.invalid/redirect")).rejects.toBeDefined();
  expect(forwarded).toEqual(["http://remote.invalid/redirect"]); expect(hits).toEqual(["/redirect"]);
});
it.each(["198.18.0.1", "[2001:db8::1]", "127.0.0.1"])("blocks a proxied redirect to reserved literal %s", async host => {
  vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${proxyPort}`);
  await expect(publicAxiosGet(`http://remote.invalid/literal/${host}`)).rejects.toBeDefined();
  expect(forwarded).toEqual([`http://remote.invalid/literal/${host}`]);
  expect(hits).toEqual([`/literal/${host}`]); expect(dns.lookup).not.toHaveBeenCalled();
});
it("keeps a public literal redirect on the configured proxy", async () => {
  vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${proxyPort}`);
  expect((await publicAxiosGet(`http://remote.invalid/literal/${PUBLIC}`)).data).toBe("public content");
  expect(forwarded).toEqual([`http://remote.invalid/literal/${PUBLIC}`, `http://${PUBLIC}:${port}/secret`]);
  expect(dns.lookup).not.toHaveBeenCalled(); expect(checked).toEqual([]);
});
it("keeps native stream lifetime and maxRedirects=0 behavior", async () => {
  const response = await publicAxiosGet<NodeJS.ReadableStream>(`http://public.example:${port}/video`, { responseType: "stream" });
  let body = "";
  for await (const chunk of response.data) body += chunk;
  expect(body).toBe("public content");
  const redirect = await publicAxiosGet(`http://public.example:${port}/redirect`, { maxRedirects: 0, validateStatus: () => true });
  expect(redirect.status).toBe(302);
});
it("does not fall back to direct when the proxy fails", async () => {
  await expect(publicAxiosGet(`http://public.example:${port}/secret`, { proxy: { host: "127.0.0.1", port: 1 } })).rejects.toBeDefined();
  expect(hits).toEqual([]); expect(checked).toEqual([]);
});
it.each(["socks5", "socks5h"])("preserves %s remote DNS", async scheme => {
  const names: string[] = [];
  const socksPort = await listen(net.createServer(client => {
    client.once("data", () => {
      client.write(Buffer.from([5, 0]));
      client.once("data", request => {
        names.push(request[3] === 3 ? request.subarray(5, 5 + request[4]).toString() : "LOCAL-DNS");
        const upstream = net.connect({ host: "127.0.0.1", port }); sockets.add(upstream);
        upstream.on("error", () => client.destroy());
        upstream.once("connect", () => { client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); client.pipe(upstream).pipe(client); });
        client.once("close", () => upstream.destroy());
      });
    });
  }));
  vi.mocked(dns.lookup).mockRejectedValue(new Error("ENOTFOUND"));
  expect((await publicAxiosGet("http://remote.invalid/video", getAxiosProxyConfig(`${scheme}://127.0.0.1:${socksPort}`))).data).toBe("public content");
  expect(names).toEqual(["remote.invalid"]); expect(dns.lookup).not.toHaveBeenCalled();
});

// Disposable test certificate for public.example; not a deployment credential.
const tlsFixture = {
  key: `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDEN7cJEy5UdTJ1
ZHA7ZesEAwrM5pbFkZ5jki26CHp6dE3hGz4WurHA6VD1jwcJzQC3BdWjNrploMH7
DD0uovXcEohaxhfMMrQNLzlrM/rK4W/irE/VGcMlu8NTNbfA9p+1VMdxWh0XCs65
x7jBLL85TnEPiaZWFXoEcgT0lqwsA+MmCURXN2rXKc+WiFFXGUJxMJ0gxSVDOqRr
74JJOPKSurmv+M3xv6S9CY+8nkRmUxNaGc8RBtAOP6L6EZ9tSJxJ3u4Zvj5D2ep3
InuVh+Wrc8EVg6oD2QftjjzxNc5WP4A7lRSWTAbIn8v3X/qK0P7KZA1hrgN4twZk
Bsb32tePAgMBAAECggEAIztbzrHWfkzC4ChGLKwqrEA9lrgKt3PjrD5Jnp86GrW6
bCJ/ngYst5ZNNqJVYbGhILvX9eP0SR455nF2pOKW4cqkGCR8jmpGQR3LIhAlxnr/
I4TMGtfy3doegtjg4zGFUMJlw1kqYwJKRzpw1qLJvSj0DRWqu8dEbvroH+DUDlzd
m3a+ecBDTlXioL/c5Ouer6lHsMiLul8LoMhNlrXm6yDwBLlwcaF15S8vyToeVz7c
SluoYYrBbhPToGOHCtuhgG8VEmcvd+UZo9qNZfYmS617eYFP400jqgjiSWON6w3U
87OFvH+KQVi+PgSLG886OXIUlLn6Pacth1sjLtAj4QKBgQDxuZCzXZLz6cW9srYw
iANTctRsNSQZrWqgqIdurDekRTL2KLbat77wkYKWYAbHzh2+tGn5guVUAuC3/qI9
oVHKgUn7tfeDI0sHHb/JIlvydlbCd7p2VUsJ/jJ77uFgkLKwYyJR07k+kveLBPv8
NfoTzH6USeLtUomMUBQt/l8G4QKBgQDPzioN7150zdecUCCgmf4hp4xWd8eKSYMt
OIwEtgBpPtwdbTqX4yugIXP2A2juDIm0u8p3wUBucL4iZd4EiUgkX9SZ8h+aLYAz
61ARx34ME7aq3ErPAkcM2Bn4oVmndpBNrLuFa/52hc1VN3eEBJ9Esa68vmmMp97w
HnDUQe5cbwKBgGUlb84OBrK3jD2vbRrrnvCpKQfKSLvR2780Jc+CkpnTNtrX+IOW
xXfme00vC0dKERo+ZeW5BvrbZWq4Su0c9puU8/82ikY+W2Oz6A9iqDTRncYr0UM4
t3iL/FXthDMi+RJjuPWicW4kkx6BzGshru3f8MteC22gztt+mqMQQHUhAoGAKJya
C28kfp9b6+ic98YgrGMaQivWi2gigsvyUVlgazElw3p9YQG8nObsyr+P2jYJE5E/
2HekJ/FQt1hBM5HAz5sK6aswEemijIMIevEJ6UJRCMNUu3AugowZR0YBR4EcYpHH
dCPO70rm/iiA6wQcPEidZbWw2xRTtYm9cz4PX3ECgYA4bcy6xstsjY1LRn0GH34f
rcLuU9aA1KqSlApdH3pPcFRkXz83Rw+zxjddJhj2AnZL5N42+3ZBY6JEYGHxCIe2
XLAjiedPDDkcRRQfBCQeJ02WijhpLt1vhwQk590fwaU+XOzdJuRGwlXFzf+8a8Ec
bee29IG2vdnDgH8+4V3kIg==
-----END PRIVATE KEY-----
`,
  cert: `-----BEGIN CERTIFICATE-----
MIIDLjCCAhagAwIBAgIULGZscCpXr3HDRxHqTENAujrmvAgwDQYJKoZIhvcNAQEL
BQAwGTEXMBUGA1UEAwwOcHVibGljLmV4YW1wbGUwHhcNMjYxMTA3MTcwMTQ3WhcN
MzYxMTA0MTcwMTQ3WjAZMRcwFQYDVQQDDA5wdWJsaWMuZXhhbXBsZTCCASIwDQYJ
KoZIhvcNAQEBBQADggEPADCCAQoCggEBAMQ3twkTLlR1MnVkcDtl6wQDCszmlsWR
nmOSLboIenp0TeEbPha6scDpUPWPBwnNALcF1aM2umWgwfsMPS6i9dwSiFrGF8wy
tA0vOWsz+srhb+KsT9UZwyW7w1M1t8D2n7VUx3FaHRcKzrnHuMEsvzlOcQ+JplYV
egRyBPSWrCwD4yYJRFc3atcpz5aIUVcZQnEwnSDFJUM6pGvvgkk48pK6ua/4zfG/
pL0Jj7yeRGZTE1oZzxEG0A4/ovoRn21InEne7hm+PkPZ6ncie5WH5atzwRWDqgPZ
B+2OPPE1zlY/gDuVFJZMBsify/df+orQ/spkDWGuA3i3BmQGxvfa148CAwEAAaNu
MGwwHQYDVR0OBBYEFFBy8jcxn5eICx7uYGC2vYOSDIesMB8GA1UdIwQYMBaAFFBy
8jcxn5eICx7uYGC2vYOSDIesMA8GA1UdEwEB/wQFMAMBAf8wGQYDVR0RBBIwEIIO
cHVibGljLmV4YW1wbGUwDQYJKoZIhvcNAQELBQADggEBAAx9alaL4qhgml4xnC37
AsYThvYAzB9xMzbxXj6DaFxjDYFMT9UOkgGXLzUXvx9yQbLVom/DLoB9bJ22t/eZ
81XpLzbOgYFvveK+HBSwjM3QYfAhLJD55gETCn4xY6qVUmlboBhJ079MJjqcmb4J
TSyGDEEovZkiqo9Mmk02eq8lFvxTVLQU2U9fCos42sydTdwlIlejbCYUn66OaFaX
2Qu7uaKDW2hKtyoQjhVnM1k2vUAZ0bwdzW5XsB9MwqpW7ReRQNMXUe9u+u8tWMsq
uJaJbYIyCcqrOBDd96h/8wvvIGcKkJWhH6yQ1Aoou6z8IvPPsGWl1i1fhZVbuRE/
zd8=
-----END CERTIFICATE-----
`,
};


it("preserves TLS verification, SNI and HTTPS CONNECT proxy routing", async () => {
  const real = tls.connect.bind(tls);
  vi.spyOn(tls, "connect").mockImplementation(((options: tls.ConnectionOptions, callback?: () => void) => {
    const originalLookup = options.lookup;
    const mapped: net.LookupFunction | undefined = originalLookup ? (host, opts, done) => originalLookup(host, opts, (error, address, family) => {
      if (error) return done(error, "");
      const addresses = typeof address === "string" ? [{ address, family }] : address;
      expect(addresses.every(item => item.address === PUBLIC)).toBe(true);
      done(null, opts.all ? [{ address: "127.0.0.1", family: 4 }] : "127.0.0.1", 4);
    }) : undefined;
    return real({ ...options, lookup: mapped, ca: tlsFixture.cert }, callback);
  }) as typeof tls.connect);
  const requested: string[] = [], names: string[] = [];
  const secure = https.createServer(tlsFixture, (request, response) => {
    requested.push(request.url!);
    if (request.url === "/redirect") response.writeHead(302, { Location: `https://private.example:${tlsPort}/secret` });
    response.end("verified TLS");
  });
  secure.on("secureConnection", socket => names.push(socket.servername as string));
  const tlsPort = await listen(secure);
  expect((await publicAxiosGet(`https://public.example:${tlsPort}/allowed`, { proxy: false })).data).toBe("verified TLS");
  await expect(publicAxiosGet(`https://public.example:${tlsPort}/redirect`, { proxy: false })).rejects.toBeDefined();
  await expect(publicAxiosGet(`https://wrong.example:${tlsPort}/bad-cert`, { proxy: false })).rejects.toBeDefined();
  expect(requested).toEqual(["/allowed", "/redirect"]); expect(names.length).toBeGreaterThan(0); expect(new Set(names)).toEqual(new Set(["public.example"]));
  (servers[1] as http.Server).on("connect", (request, client, head) => {
    forwarded.push(request.url!);
    const upstream = net.connect({ host: "127.0.0.1", port: tlsPort }); sockets.add(upstream);
    client.on("error", () => upstream.destroy()); upstream.on("error", () => client.destroy());
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    client.once("close", () => upstream.destroy());
  });
  vi.mocked(dns.lookup).mockClear();
  vi.stubEnv("HTTPS_PROXY", `http://127.0.0.1:${proxyPort}`);
  expect((await publicAxiosGet(`https://public.example:${tlsPort}/proxied`)).data).toBe("verified TLS");
  expect(forwarded).toEqual([`public.example:${tlsPort}`]); expect(dns.lookup).not.toHaveBeenCalled();
});
