import dns from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertPublicAddress, resolvePublicHost } from "../../utils/securityNetwork";

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
