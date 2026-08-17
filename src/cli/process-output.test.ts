import { describe, expect, it } from "vitest";
import { BoundedOutputCollector } from "./process-output.js";

describe("BoundedOutputCollector", () => {
  it("保留头部并记录原始字节数", () => {
    const output = new BoundedOutputCollector(5, "head");
    output.append(Buffer.from("abc"));
    output.append(Buffer.from("defg"));

    expect(output.result()).toEqual({
      text: "abcde",
      originalBytes: 7,
      truncated: true,
    });
  });

  it("保留 stderr 尾部", () => {
    const output = new BoundedOutputCollector(5, "tail");
    output.append(Buffer.from("abc"));
    output.append(Buffer.from("defg"));

    expect(output.result()).toEqual({
      text: "cdefg",
      originalBytes: 7,
      truncated: true,
    });
  });

  it("不会在 UTF-8 字符中间返回替换字符", () => {
    const output = new BoundedOutputCollector(4, "head");
    output.append(Buffer.from("中文"));

    expect(output.result()).toEqual({
      text: "中",
      originalBytes: 6,
      truncated: true,
    });
  });
});
