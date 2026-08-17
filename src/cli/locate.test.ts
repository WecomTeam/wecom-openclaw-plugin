import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { binCandidatesFromPackageManifest } from "./locate.js";

const tempDirs: string[] = [];

function packageRoot(manifest: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wecom-cli-locate-"));
  tempDirs.push(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("binCandidatesFromPackageManifest", () => {
  it("解析对象形式的 wecom-cli bin", () => {
    const root = packageRoot({ bin: { "wecom-cli": "./bin/wecom.js" } });

    expect(binCandidatesFromPackageManifest(root)).toEqual([path.join(root, "bin", "wecom.js")]);
  });

  it("解析字符串形式的 bin", () => {
    const root = packageRoot({ bin: "./bin/wecom.js" });

    expect(binCandidatesFromPackageManifest(root)).toEqual([path.join(root, "bin", "wecom.js")]);
  });

  it("拒绝逃逸包目录的 bin 路径", () => {
    const root = packageRoot({ bin: { "wecom-cli": "../outside" } });

    expect(binCandidatesFromPackageManifest(root)).toEqual([]);
  });
});
