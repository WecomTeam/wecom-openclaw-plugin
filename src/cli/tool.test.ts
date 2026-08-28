import { describe, expect, it, vi } from "vitest";
import { createWeComCliTool, prepareCliArguments } from "./tool.js";

describe("wecom-cli tool arguments", () => {
  it("对模型仅暴露字符串数组 schema", () => {
    const tool = createWeComCliTool();

    expect(tool.parameters).toMatchObject({
      type: "object",
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["args"],
      additionalProperties: false,
    });
  });

  it("在 schema 校验前将历史字符串参数转换为数组", () => {
    expect(
      prepareCliArguments({
        args: `sheet create --json '{"title":"测试表格"}'`,
      }),
    ).toEqual({
      args: ["sheet", "create", "--json", '{"title":"测试表格"}'],
    });
  });

  it("保持数组参数不变", () => {
    const params = { args: ["sheet", "create", "--json", '{"title":"测试表格"}'] };

    expect(prepareCliArguments(params)).toBe(params);
  });

  it("保留非法类型供 schema 返回标准校验错误", () => {
    const params = { args: { command: "sheet create" } };

    expect(prepareCliArguments(params)).toBe(params);
  });
});


describe("wecom-cli runtime config", () => {
  it("reads refreshed config on every execution before resolving credentials", async () => {
    const getRuntimeConfig = vi.fn()
      .mockReturnValueOnce({})
      .mockReturnValueOnce({ channels: { wecom: { accounts: { work: {}, personal: {} } } } });
    const tool = createWeComCliTool({ getRuntimeConfig });

    const missingCredentials = await tool.execute("first", { args: ["contact", "list"] });
    expect(missingCredentials.content[0].text).toContain("未配置 botId / secret");
    const missingAccount = await tool.execute("second", { args: ["contact", "list"] });
    expect(missingAccount.content[0].text).toContain("缺少账号上下文");
    expect(getRuntimeConfig).toHaveBeenCalledTimes(2);
  });
});
