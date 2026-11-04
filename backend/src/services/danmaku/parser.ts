import sax from "sax";

export const MAX_DANMAKU_BYTES = 8 * 1024 * 1024;
export const MAX_DANMAKU_EVENTS = 100_000;
export interface DanmakuEvent {
  time: number;
  text: string;
  mode: "scroll" | "top" | "bottom";
  color: string;
  fontSize: number;
}
export interface ParsedDanmaku {
  events: DanmakuEvent[];
  ignoredCount: number;
  cid?: string;
}

/** Strict, bounded XML ingestion. Never resolve DTDs, entities, HTML, or script modes. */
export function parseDanmakuXml(xml: string, expectedCid?: string): ParsedDanmaku {
  if (!xml.trim() || Buffer.byteLength(xml) > MAX_DANMAKU_BYTES) throw new Error("danmakuInvalidFile");
  const options = { trim: false, strictEntities: true };
  const parser = sax.parser(true, options);
  const result: ParsedDanmaku = { events: [], ignoredCount: 0 };
  let depth = 0;
  let root = false;
  let current: { name: string; p: string; text: string } | undefined;
  let count = 0;
  parser.onerror = () => { throw new Error("danmakuInvalidFile"); };
  parser.ondoctype = parser.onsgmldeclaration = () => { throw new Error("danmakuInvalidFile"); };
  parser.onopentag = tag => {
    depth++;
    if (depth === 1) {
      if (root || tag.name !== "i") throw new Error("danmakuInvalidFile");
      root = true;
    }
    if (depth > 2) throw new Error("danmakuInvalidFile");
    if (depth === 2) current = { name: tag.name, p: String(tag.attributes.p ?? ""), text: "" };
  };
  const append = (text: string) => {
    if (current) {
      current.text += text;
      if (current.text.length > 2000) throw new Error("danmakuInvalidFile");
    }
  };
  parser.ontext = append;
  parser.oncdata = append;
  parser.onclosetag = () => {
    if (depth === 2 && current) {
      if (current.name === "chatid") {
        const cid = current.text.trim();
        if (!/^\d+$/.test(cid) || (result.cid && result.cid !== cid)) throw new Error("danmakuInvalidFile");
        result.cid = cid;
      } else if (current.name === "d") {
        if (++count > MAX_DANMAKU_EVENTS) throw new Error("danmakuTooLarge");
        const [seconds, modeRaw, sizeRaw, colorRaw] = current.p.split(",");
        const time = Number(seconds), mode = Number(modeRaw), size = Number(sizeRaw), color = Number(colorRaw);
        const text = current.text.trim();
        if (![seconds, modeRaw, sizeRaw, colorRaw].every(value => value?.trim()) || !Number.isFinite(time) || time < 0 || time > 604800 ||
            ![1, 4, 5].includes(mode) || !Number.isFinite(size) || size <= 0 ||
            !Number.isInteger(color) || color < 0 || color > 0xffffff || !text || text.length > 500) {
          result.ignoredCount++;
        } else {
          result.events.push({ time, text, mode: mode === 4 ? "bottom" : mode === 5 ? "top" : "scroll",
            fontSize: Math.min(40, Math.max(12, size)), color: `#${color.toString(16).padStart(6, "0")}` });
        }
      }
      current = undefined;
    }
    depth--;
  };
  parser.write(xml).close();
  if (!root || depth !== 0 || (expectedCid && result.cid !== expectedCid)) throw new Error("danmakuInvalidFile");
  result.events.sort((a, b) => a.time - b.time);
  return result;
}
