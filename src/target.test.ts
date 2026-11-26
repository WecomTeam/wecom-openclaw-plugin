import { describe, it, expect } from "vitest";
import { resolveWecomChatId, resolveWecomTarget } from "./target.js";

describe("resolveWecomChatId", () => {
  it("剥离 OpenClaw 目标类型前缀，返回裸 userid", () => {
    expect(resolveWecomChatId("user:yangtao")).toBe("yangtao");
    expect(resolveWecomChatId("channel:yangtao")).toBe("yangtao");
    expect(resolveWecomChatId("dm:yangtao")).toBe("yangtao");
    expect(resolveWecomChatId("conversation:yangtao")).toBe("yangtao");
    expect(resolveWecomChatId("room:yangtao")).toBe("yangtao");
    expect(resolveWecomChatId("thread:yangtao")).toBe("yangtao");
  });

  it("先剥离命名空间前缀，再剥离类型前缀", () => {
    expect(resolveWecomChatId("wecom:yangtao")).toBe("yangtao");
    expect(resolveWecomChatId("wecom:user:yangtao")).toBe("yangtao");
    expect(resolveWecomChatId("WECOM:USER:yangtao")).toBe("yangtao");
  });

  it("不带前缀的目标保持不变", () => {
    expect(resolveWecomChatId("yangtao")).toBe("yangtao");
  });

  it("群目标保留真实群 chatid", () => {
    expect(resolveWecomChatId("wecom:group:wrABC123")).toBe("wrABC123");
    expect(resolveWecomChatId("wrABC123")).toBe("wrABC123");
  });

  it("空值与守卫：剩余值为空时不剥离", () => {
    expect(resolveWecomChatId("")).toBe("");
    expect(resolveWecomChatId("   ")).toBe("");
    expect(resolveWecomChatId("user:")).toBe("user:");
  });
});

describe("resolveWecomTarget", () => {
  it("保留企微语义前缀", () => {
    expect(resolveWecomTarget("user:yangtao")).toEqual({ touser: "yangtao" });
    expect(resolveWecomTarget("group:wrABC")).toEqual({ chatid: "wrABC" });
    expect(resolveWecomTarget("party:1")).toEqual({ toparty: "1" });
    expect(resolveWecomTarget("tag:7")).toEqual({ totag: "7" });
  });

  it("纯数字 userid 保持 user 语义，不会被当成部门", () => {
    expect(resolveWecomTarget("user:1001")).toEqual({ touser: "1001" });
  });

  it("剥离 OpenClaw 路由前缀", () => {
    expect(resolveWecomTarget("channel:yangtao")).toEqual({ touser: "yangtao" });
    expect(resolveWecomTarget("dm:yangtao")).toEqual({ touser: "yangtao" });
  });
});
