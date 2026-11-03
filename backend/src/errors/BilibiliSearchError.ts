export class BilibiliSearchUnavailableError extends Error {
  constructor(readonly code: "BILIBILI_SEARCH_UNAVAILABLE" | "BILIBILI_SEARCH_RISK_CONTROLLED" = "BILIBILI_SEARCH_UNAVAILABLE") {
    super(code === "BILIBILI_SEARCH_RISK_CONTROLLED"
      ? "Bilibili requires a security check. Try updating the Bilibili cookie in Settings, then retry video search."
      : "Bilibili video search is unavailable. Please retry later.");
  }
}
