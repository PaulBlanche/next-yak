import {
  ParsedModule,
  parseModule,
} from "../cross-file-resolver/parseModule.js";
import {
  resolveCrossFileConstant,
  ResolvedModule,
} from "../cross-file-resolver/resolveCrossFileConstant.js";
import { Cache } from "../cross-file-resolver/types.js";
import * as swc from "@swc/core";
import * as path from "node:path";
import { walk } from "./walk.js";
import * as swcAssert from "./swcAssert.js";
import {
  ModuleExports,
  ModuleExport,
} from "../cross-file-resolver/parseModule.js";

export function transformer(config: TransformConfig): Transform {
  const parse = (filePath: string) => {
    return parseModule(
      {
        cache: config.cache,
        transpilationMode: config.transpilationMode,
        evaluateYakModule: config.evaluateYakModule,
        extractExports: (modulePath: string) => {
          return extract(modulePath);
        },
        getTransformed: (modulePath: string) => {
          return transform(modulePath);
        },
      },
      filePath,
    );
  };

  const resolve = (filePath: string, css: string) => {
    return resolveCrossFileConstant(
      {
        exportAllLimit: config.exportAllLimit,
        cache: config.cache,
        resolve: config.resolve,
        parse,
      },
      filePath,
      css,
    );
  };

  return async (filePath) => {
    const parsedModule = await parse(filePath);
    if (parsedModule.type !== "regular" || parsedModule.js === undefined) {
      return undefined;
    }
    const extractedCss = extractCss(
      parsedModule.js.code,
      config.transpilationMode,
    );

    const { resolved, dependencies } = await resolve(filePath, extractedCss);

    return {
      js: parsedModule.js,
      css: resolved,
      dependencies,
    };
  };
}

function transform(filePath: string) {
  return swc.transformFile(filePath, {
    module: {
      type: "es6",
    },
    sourceMaps: true,
    filename: path.basename(filePath),
    jsc: {
      experimental: {
        plugins: [
          [
            "yak-swc",
            {
              basePath: ".",
              prefix: undefined, //'prefix',
              displayNames: true,
              transpilationMode: "Css",
            },
          ],
        ],
      },
      target: "esnext",
      loose: true,
      externalHelpers: true,
      parser: {
        syntax: "typescript",
        tsx: true,
      },
      transform: {
        react: {
          runtime: "classic",
          throwIfNamespace: true,
          development: false,
          useBuiltins: true,
        },
      },
    },
  });
}

async function extract(filePath: string) {
  const module = await swc.parseFile(filePath, {
    syntax: "typescript",
    tsx: true,
  });

  const exports: ModuleExports = {
    importYak: false,
    all: [],
    named: {},
  };

  const variableDeclarators: Record<string, swc.Expression> = {};

  let defaultIdentifier: string | null = null;

  await walk(module, {
    enter: async (node) => {
      if (swcAssert.isVariableDeclarator(node)) {
        if (node.id.type === "Identifier" && node.init) {
          variableDeclarators[node.id.value] = node.init;
        }
      }
      if (swcAssert.isExportDefaultExpression(node)) {
        if (node.expression.type === "Identifier") {
          defaultIdentifier = node.expression.value;
        } else {
          exports.named["default"] = parseExpression(node.expression);
        }
      }
      if (swcAssert.isExportDefaultDeclaration(node)) {
        exports.named["default"] = /** @type {ModuleExport} */ {
          type: "unsupported",
          hint: node.decl.type,
        };
      }
      if (swcAssert.isExportDeclaration(node)) {
        if (node.declaration.type === "VariableDeclaration") {
          for (const declaration of node.declaration.declarations) {
            if (!declaration.init || declaration.id.type !== "Identifier") {
              continue;
            }

            const name = declaration.id.value;

            exports.named[name] = parseExpression(declaration.init);
          }
        }
      }
      if (swcAssert.isImportDeclaration(node)) {
        if (node.source.value === "next-yak") {
          exports.importYak = true;
        }
      }
      if (swcAssert.isExportAllDeclaration(node)) {
        exports.all.push(node.source.value);
      }
      if (swcAssert.isExportNamedDeclaration(node)) {
        if (node.source) {
          for (const specifier of node.specifiers) {
            if (specifier.type === "ExportDefaultSpecifier") {
              continue;
            }
            if (specifier.type === "ExportSpecifier") {
              exports.named[specifier.exported?.value ?? specifier.orig.value] =
                {
                  type: "re-export",
                  name: specifier.orig.value,
                  from: node.source.value,
                };
            }
            if (specifier.type === "ExportNamespaceSpecifier") {
              exports.named[specifier.name.value] = {
                type: "namespace-re-export",
                from: node.source.value,
              };
            }
          }
        }
      }
    },
  });

  if (defaultIdentifier && variableDeclarators[defaultIdentifier]) {
    exports.named["default"] = parseExpression(
      variableDeclarators[defaultIdentifier],
    );
  }

  return exports;
}

function parseExpression(expression: swc.Expression): ModuleExport {
  switch (expression.type) {
    case "TaggedTemplateExpression":
    case "CallExpression": {
      return { type: "tag-template" };
    }
    case "StringLiteral":
    case "NumericLiteral": {
      return { type: "constant", value: expression.value };
    }
    case "UnaryExpression": {
      if (
        expression.operator === "-" &&
        expression.argument.type === "NumericLiteral"
      ) {
        return { type: "constant", value: -expression.argument.value };
      }
      break;
    }
    case "TemplateLiteral": {
      if (expression.quasis.length === 1) {
        return { type: "constant", value: expression.quasis[0].raw };
      }
      break;
    }
    case "ObjectExpression": {
      return { type: "record", value: parseObjectExpression(expression) };
    }
    case "TsSatisfiesExpression": {
      return parseExpression(expression.expression);
    }
    case "TsAsExpression": {
      return parseExpression(expression.expression);
    }
  }

  return { type: "unsupported", hint: expression.type };
}

function parseObjectExpression(expression: swc.ObjectExpression) {
  /** @type {Record<string|number, ModuleExport>} */
  const parsed = {};

  for (const property of expression.properties) {
    if (property.type === "KeyValueProperty") {
      if (
        property.key.type === "Identifier" ||
        property.key.type === "NumericLiteral" ||
        property.key.type === "StringLiteral"
      ) {
        parsed[property.key.value] = parseExpression(property.value);
      }
    }
  }

  return parsed;
}

function extractCss(
  code: string,
  transpilationMode?: "Css" | "CssModule",
): string {
  const codeParts = code.split("/*YAK Extracted CSS:\n");
  let result = "";
  for (let i = 1; i < codeParts.length; i++) {
    const codeUntilEnd = codeParts[i].split("*/")[0];
    result += codeUntilEnd;
  }
  if (result && transpilationMode !== "Css") {
    result = "/* cssmodules-pure-no-check */\n" + result;
  }

  return result;
}

type Transform = (filePath: string) => Promise<TransformResult | undefined>;

type TransformConfig = {
  cache?: {
    parse?: Cache<ParsedModule>;
    resolve?: Cache<
      Promise<{ resolved: ResolvedModule; dependencies: string[] }>
    >;
    resolveCrossFileConstant?: Cache<
      Promise<{ resolved: string; dependencies: string[] }>
    >;
  };
  transpilationMode?: "Css" | "CssModule";
  exportAllLimit?: number;
  evaluateYakModule?: (
    modulePath: string,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  resolve: (specifier: string, importer: string) => Promise<string> | string;
};

type TransformResult = {
  js: { code: string; map?: string };
  css: string;
  dependencies: string[];
};
