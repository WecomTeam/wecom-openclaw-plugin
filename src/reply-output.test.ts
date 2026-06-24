import { describe, expect, it } from "vitest";

import {
  extractMediaDirectivePayload,
  mergeDeliveredText,
} from "./reply-output.js";

describe("extractMediaDirectivePayload", () => {
  it("removes MEDIA lines from visible text and keeps media paths separately", () => {
    expect(
      extractMediaDirectivePayload(
        "PDF已转换为4张图片，正在发送给你：\n\nMEDIA: /workspace/.openclaw/workspace/pdf_images_2/page_1.png\nMEDIA: /workspace/.openclaw/workspace/pdf_images_2/page_2.png",
      ),
    ).toEqual({
      text: "PDF已转换为4张图片，正在发送给你：",
      mediaUrls: [
        "/workspace/.openclaw/workspace/pdf_images_2/page_1.png",
        "/workspace/.openclaw/workspace/pdf_images_2/page_2.png",
      ],
    });
  });
});

describe("mergeDeliveredText", () => {
  it("does not duplicate cumulative final text after a streamed block", () => {
    const blockText = "PDF已转换为4张图片，正在发送给你：";
    const mergedBlock = mergeDeliveredText("", blockText, "block");

    expect(mergeDeliveredText(mergedBlock, blockText, "block")).toBe(blockText);
    expect(mergeDeliveredText(mergedBlock, blockText, "final")).toBe(blockText);
  });

  it("appends truly incremental text", () => {
    expect(mergeDeliveredText("第一句", "，第二句", "block")).toBe("第一句，第二句");
  });
});
