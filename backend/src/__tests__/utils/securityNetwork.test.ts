import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertPublicAddress, resolvePrivateHost, resolvePublicHost } from "../../utils/securityNetwork";

const lookup = vi.fn<(hostname: string) => Promise<LookupAddress[]>>();
beforeEach(() => {
  lookup.mockReset();
  vi.spyOn(dns, "lookup").mockImplementation(lookup as unknown as typeof dns.lookup);
});
afterEach(() => vi.restoreAllMocks());

describe("public destination validation", () => {
  it.each([
    "0.0.0.0", "0.1.2.3", "10.1.2.3", "100.64.0.1", "127.0.0.1",
    "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "192.0.2.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::", "::1", "fe80::1", "fd00::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::1",
  ])("rejects non-public destination %s", (address) => {
    expect(() => assertPublicAddress(address)).toThrow("SSRF protection");
  });

  it.each(["8.8.8.8", "93.184.216.34", "100.63.0.1", "100.128.0.1", "2606:4700:4700::1111"])(
    "allows public destination %s", (address) => expect(() => assertPublicAddress(address)).not.toThrow(),
  );

  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fd00::1"])(
    "rejects DNS names pointing to %s", async (address) => {
      lookup.mockResolvedValue([{ address, family: address.includes(":") ? 6 : 4 }]);
      await expect(resolvePublicHost("attacker.example")).rejects.toThrow("SSRF protection");
    },
  );

  it("rejects mixed public and private answers in either order", async () => {

    const addresses = [{ address: "8.8.8.8", family: 4 }, { address: "::1", family: 6 }];
    for (const answer of [addresses, [...addresses].reverse()]) {
      lookup.mockResolvedValue(answer);
      await expect(resolvePublicHost("mixed.example")).rejects.toThrow("SSRF protection");
    }
  });

  it("fails closed on lookup errors and empty answers", async () => {
    lookup.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(resolvePublicHost("missing.example")).rejects.toThrow("ENOTFOUND");
    lookup.mockResolvedValue([]);
    await expect(resolvePublicHost("missing.example")).rejects.toThrow("no addresses");
  });

  it("does not resolve literal IPs", async () => {

    await expect(resolvePublicHost("127.0.0.1")).rejects.toThrow("SSRF protection");
    await expect(resolvePublicHost("8.8.8.8")).resolves.toEqual([{ address: "8.8.8.8", family: 4 }]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("times out DNS instead of leaving an API request pending", async () => {
    vi.useFakeTimers();
    try {
      lookup.mockReturnValue(new Promise(() => {}));
      const result = expect(resolvePublicHost("slow.example")).rejects.toThrow("DNS lookup timed out");
      await vi.advanceTimersByTimeAsync(10000);
      await result;
    } finally { vi.useRealTimers(); }
  });
});

describe("LAN destination validation", () => {
  it("returns private, shared, loopback and link-local answers", async () => {
    const answers = [
      { address: "192.168.1.20", family: 4 }, { address: "100.101.102.103", family: 4 },
      { address: "127.0.0.1", family: 4 }, { address: "169.254.1.1", family: 4 },
      { address: "fd00::20", family: 6 }, { address: "fe80::1", family: 6 },
      { address: "::1", family: 6 }, { address: "::ffff:10.0.0.2", family: 6 },
    ];
    lookup.mockResolvedValue(answers);
    await expect(resolvePrivateHost("nas.example")).resolves.toEqual(answers);
  });

  it.each([
    [["8.8.8.8"]], [["192.168.1.20", "8.8.8.8"]], [["8.8.8.8", "10.0.0.2"]],
    // Not public, but able to reach a public host: NAT64, 6to4, Teredo,
    // IPv4-mapped public, and ranges that are simply not a LAN.
    [["64:ff9b::808:808"]], [["2002:808:808::1"]], [["2001::1"]], [["::ffff:8.8.8.8"]],
    [["198.18.0.1"]], [["0.0.0.0"]], [["224.0.0.1"]], [["::"]],
  ])(
    "rejects answers outside the private ranges: %j", async (addresses) => {
      lookup.mockResolvedValue(addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })));
      await expect(resolvePrivateHost("nas.example")).rejects.toThrow("SSRF protection");
    },
  );

  it("fails closed on empty answers and checks literals without DNS", async () => {
    lookup.mockResolvedValue([]);
    await expect(resolvePrivateHost("nas.example")).rejects.toThrow("no addresses");
    lookup.mockClear();
    await expect(resolvePrivateHost("192.168.1.20")).resolves.toEqual([{ address: "192.168.1.20", family: 4 }]);
    await expect(resolvePrivateHost("8.8.8.8")).rejects.toThrow("SSRF protection");
    expect(lookup).not.toHaveBeenCalled();
  });
});
