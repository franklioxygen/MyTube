import { describe, expect, it } from "vitest";
import { MAX_DANMAKU_BYTES, MAX_DANMAKU_EVENTS, parseDanmakuXml } from "../../services/danmaku/parser";

const comment = (time = "1.5", mode = "1", text = "Hello &amp; world") => `<d p="${time},${mode},25,16777215,0,0,hash,9223372036854775807">${text}</d>`;
describe("Bilibili XML ingestion", () => {
  it("normalizes scrolling and fixed comments without numeric coercion of IDs or HTML execution", () => {
    const result = parseDanmakuXml(`<i><chatid>123</chatid>${comment("3", "4", "&lt;img src=x onerror=alert(1)&gt;")}${comment()}${comment("2", "5")}</i>`, "123");
    expect(result.events.map(event => event.mode)).toEqual(["scroll", "top", "bottom"]);
    expect(result.events[0]).toMatchObject({ time: 1.5, text: "Hello & world", color: "#ffffff", fontSize: 25 });
    expect(result.events[2].text).toBe("<img src=x onerror=alert(1)>");
  });
  it.each(["", "<html>blocked</html>", "{}", "<i><d></i>", "<i/><i/>", '<!DOCTYPE i [<!ENTITY x SYSTEM "file:///etc/passwd">]><i>&x;</i>', "<i>&unknown;</i>"])("rejects invalid XML and declarations: %s", xml => {
    expect(() => parseDanmakuXml(xml)).toThrow();
  });
  it("validates an exact CID, accepts an empty pool, and rejects mismatched or missing identity", () => {
    expect(parseDanmakuXml("<i><chatid>123</chatid></i>", "123").events).toEqual([]);
    expect(() => parseDanmakuXml("<i><chatid>124</chatid></i>", "123")).toThrow();
    expect(() => parseDanmakuXml("<i/>", "123")).toThrow();
  });
  it("skips script, reverse, invalid-time and oversized-text entries", () => {
    const result = parseDanmakuXml(`<i>${comment("1", "7", "script")}${comment("1", "8")}${comment("1", "6")}${comment("NaN")}${comment("-1")}${comment("2", "1", "a".repeat(501))}${comment()}</i>`);
    expect(result.ignoredCount).toBe(6);
    expect(result.events).toHaveLength(1);
  });
  it("bounds decompressed input and the number of comments", () => {
    expect(() => parseDanmakuXml(" ".repeat(MAX_DANMAKU_BYTES + 1))).toThrow();
    expect(() => parseDanmakuXml(`<i>${'<d p="0,7,1,1">x</d>'.repeat(MAX_DANMAKU_EVENTS + 1)}</i>`)).toThrow("danmakuTooLarge");
  });
});
