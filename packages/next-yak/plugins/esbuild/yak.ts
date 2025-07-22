import * as path from "node:path";
import * as fs from "node:fs";
import * as process from "node:process";
import { Buffer } from "node:buffer";
import * as esbuild from "esbuild";
import { transformer } from "../transform.js";
import { Cache } from "../Cache.js";

export function yak(config: Config) {
  return {
    name: "yak",
    setup(build) {
      const cache = new Cache();

      const transform = transformer({
        cache: {
          parse: cache.namespace(["parse"]),
          resolve: cache.namespace(["resolve"]),
          resolveCrossFileConstant: cache.namespace([
            "resolveCrossFileConstant",
          ]),
        },
        transpilationMode: config.transpilationMode,
        exportAllLimit: config.exportAllLimit,
        resolve: async (specifier, importer) => {
          const resolved = await build.resolve(specifier, {
            kind: "import-statement",
            importer,
            resolveDir: path.dirname(importer),
          });

          return resolved.path;
        },
      });

      const cssCache = new Map();

      build.onResolve({ filter: /yak\.module\.css!=!/ }, (args) => {
        if (cssCache.has(args.importer)) {
          return { namespace: "yak-css-module", path: args.importer };
        }
      });

      build.onResolve({ filter: /yak\.css!=!/ }, (args) => {
        if (cssCache.has(args.importer)) {
          return { namespace: "yak-css", path: args.importer };
        }
      });

      build.onLoad({ namespace: "yak-css-module", filter: /.*/ }, (args) => {
        return { contents: cssCache.get(args.path), loader: "local-css" };
      });

      build.onLoad({ namespace: "yak-css", filter: /.*/ }, (args) => {
        return { contents: cssCache.get(args.path), loader: "css" };
      });

      build.onLoad({ filter: /\.[tj]sx?$/ }, async (args) => {
        if (args.path.includes("node_modules")) {
          return undefined;
        }

        const transformed = await transform(args.path);

        if (transformed === undefined) {
          return undefined;
        }

        cssCache.set(args.path, transformed.css);

        return {
          contents: transformed.js.map
            ? `${transformed.js.code}//# sourceMappingURL=data:application/json;base64,${Buffer.from(transformed.js.map).toString("base64")}`
            : transformed.js.code,
          loader: "tsx",
          resolveDir: path.dirname(args.path),
          watchFiles: transformed.dependencies,
        };
      });
    },
  };
}

type Config = {
  transpilationMode?: "Css" | "CssModule";
  exportAllLimit?: number;
};
