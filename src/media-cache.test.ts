import { describe, expect, it } from "vitest";

import {
  CACHE_TTL_MS,
  cacheMedia,
  consumeCachedMedia,
  deferOrMergeMedia,
} from "./media-cache.js";

describe("deferOrMergeMedia", () => {
  it("defers a pure-media message and consumes it on the next text message", () => {
    const cacheKey = "account-a:chat-1";
    const mediaA = [{ path: "/tmp/a.pdf", contentType: "application/pdf" }];

    const deferred = deferOrMergeMedia({
      cacheKey,
      text: "",
      mediaList: mediaA,
      now: 1_000,
    });

    expect(deferred).toEqual({
      deferred: true,
      mediaList: [],
      mergedCachedCount: 0,
    });

    const merged = deferOrMergeMedia({
      cacheKey,
      text: "请把附件发我",
      mediaList: [{ path: "/tmp/b.pdf", contentType: "application/pdf" }],
      now: 2_000,
    });

    expect(merged).toEqual({
      deferred: false,
      mediaList: [
        { path: "/tmp/a.pdf", contentType: "application/pdf" },
        { path: "/tmp/b.pdf", contentType: "application/pdf" },
      ],
      mergedCachedCount: 1,
    });
    expect(consumeCachedMedia(cacheKey, 2_001)).toEqual([]);
  });

  it("accumulates multiple pure-media messages for the same chat", () => {
    const cacheKey = "account-a:chat-2";

    deferOrMergeMedia({
      cacheKey,
      text: "",
      mediaList: [{ path: "/tmp/a.pdf", contentType: "application/pdf" }],
      now: 1_000,
    });
    deferOrMergeMedia({
      cacheKey,
      text: "",
      mediaList: [{ path: "/tmp/b.pdf", contentType: "application/pdf" }],
      now: 2_000,
    });

    const merged = deferOrMergeMedia({
      cacheKey,
      text: "这是补充说明",
      mediaList: [],
      now: 3_000,
    });

    expect(merged).toEqual({
      deferred: false,
      mediaList: [
        { path: "/tmp/a.pdf", contentType: "application/pdf" },
        { path: "/tmp/b.pdf", contentType: "application/pdf" },
      ],
      mergedCachedCount: 2,
    });
  });

  it("expires cached media after ten minutes", () => {
    const cacheKey = "account-a:chat-3";
    cacheMedia(cacheKey, [{ path: "/tmp/a.pdf", contentType: "application/pdf" }], 1_000);

    expect(consumeCachedMedia(cacheKey, 1_000 + CACHE_TTL_MS - 1)).toEqual([
      { path: "/tmp/a.pdf", contentType: "application/pdf" },
    ]);

    cacheMedia(cacheKey, [{ path: "/tmp/b.pdf", contentType: "application/pdf" }], 2_000);
    expect(consumeCachedMedia(cacheKey, 2_000 + CACHE_TTL_MS + 1)).toEqual([]);
  });
});
