import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadAndSaveFiles,
  downloadAndSaveImages,
} from "./media-handler.js";

const media = vi.hoisted(() => ({
  readRemoteMediaBuffer: vi.fn(),
  saveMediaBuffer: vi.fn(),
}));

vi.mock("./runtime.js", () => ({ getWeComRuntime: () => ({ channel: { media } }) }));

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jBqkAAAAASUVORK5CYII=",
  "base64",
);

beforeEach(() => {
  vi.clearAllMocks();
  media.readRemoteMediaBuffer.mockResolvedValue({ buffer: png, contentType: "image/png" });
  media.saveMediaBuffer.mockResolvedValue({ path: "/media/inbound/image.png", contentType: "image/png" });
});

describe.each([
  { kind: "image", download: downloadAndSaveImages, urls: { imageUrls: ["https://example.com/image.png"] } },
  { kind: "file", download: downloadAndSaveFiles, urls: { fileUrls: ["https://example.com/file.png"] } },
])("$kind downloads with the current media runtime", ({ kind, download, urls }) => {
  function params(mediaMaxMb = 1) {
    return {
      ...urls,
      config: { agents: { defaults: { mediaMaxMb } } },
      account: {},
      runtime: { log: vi.fn(), error: vi.fn() },
      wsClient: { downloadFile: vi.fn().mockRejectedValue(new Error("WeCom download unavailable")) },
    } as unknown as Parameters<typeof download>[0];
  }

  it("saves a remote fallback buffer with the configured size bound", async () => {
    const result = await download(params() as Parameters<typeof downloadAndSaveImages>[0] & Parameters<typeof downloadAndSaveFiles>[0]);
    expect(result).toEqual([{ path: "/media/inbound/image.png", contentType: "image/png" }]);
    expect(media.readRemoteMediaBuffer).toHaveBeenCalledOnce();
    expect(media.saveMediaBuffer).toHaveBeenCalledWith(png, "image/png", "inbound", 1024 * 1024, undefined);
  });

  it("preserves the operator-visible oversize error instead of saving oversized media", async () => {
    await expect(download(params(0.000001) as Parameters<typeof downloadAndSaveImages>[0] & Parameters<typeof downloadAndSaveFiles>[0]))
      .rejects.toMatchObject({ name: "MediaOversizeError", kind, sizeBytes: png.length });
    expect(media.saveMediaBuffer).not.toHaveBeenCalled();
  });

  it("does not bypass a rejected remote read with an unguarded fetch", async () => {
    media.readRemoteMediaBuffer.mockRejectedValue(new Error("blocked address"));
    const options = params();
    expect(await download(options as Parameters<typeof downloadAndSaveImages>[0] & Parameters<typeof downloadAndSaveFiles>[0])).toEqual([]);
    expect(media.saveMediaBuffer).not.toHaveBeenCalled();
    expect(options.runtime.error).toHaveBeenCalledWith(expect.stringContaining("blocked address"));
  });
});
