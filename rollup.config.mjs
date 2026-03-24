import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import json from "@rollup/plugin-json";
import { dts } from "rollup-plugin-dts";

// 外部依赖，不打包进 bundle
const external = [
  /^openclaw\/plugin-sdk(?:\/.*)?$/,
  "@tencent/aibot-node-sdk",
  "@wecom/aibot-node-sdk",
  "file-type",
  "tar",
  /^node:/,
];

export default [
  // CJS & ESM 输出
  {
    input: "index.ts",
    output: [
      {
        file: "dist/index.cjs.js",
        format: "cjs",
        sourcemap: true,
        exports: "named",
      },
      {
        file: "dist/index.esm.js",
        format: "esm",
        sourcemap: true,
      },
    ],
    external,
    plugins: [
      resolve({ preferBuiltins: true }),
      commonjs(),
      json(),
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: true,
        declarationDir: "./dist",
      }),
    ],
  },
  // 类型声明文件
  {
    input: "dist/index.d.ts",
    output: [{ file: "dist/index.d.ts", format: "esm" }],
    external,
    plugins: [dts()],
  },
];
