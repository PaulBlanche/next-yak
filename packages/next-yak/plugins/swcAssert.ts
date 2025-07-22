import * as scw from "@swc/core";

export function isNode(value: unknown): value is scw.Node {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string"
  );
}

export function isArgument(value: unknown): value is scw.Argument {
  return (
    value !== null &&
    typeof value === "object" &&
    "expression" in value &&
    isNode(value.expression)
  );
}

/**
 * code like :
 *  - `import foo from "bar"`
 *  - `import { foo } from "bar"`
 *  - `import * as foo from "bar"`
 */
export function isImportDeclaration(
  node: scw.Node,
): node is scw.ImportDeclaration {
  return node.type === "ImportDeclaration";
}

/**
 * code like :
 *  - `export const/var/let = ...`
 *  - `export class Foo { ... }`
 *  - `export function foo() { ... }`
 */
export function isExportDeclaration(
  node: scw.Node,
): node is scw.ExportDeclaration {
  return node.type === "ExportDeclaration";
}

/**
 * code like :
 *  - `export { foo } from "xxx"`
 *  - `export * as foo from "xxx"`
 *  - `export { foo }`
 */
export function isExportNamedDeclaration(
  node: scw.Node,
): node is scw.ExportNamedDeclaration {
  return node.type === "ExportNamedDeclaration";
}

/**
 * code like :
 *  - `export default class Foo { ... }`
 *  - `export default function foo() { ... }`
 */
export function isExportDefaultDeclaration(
  node: scw.Node,
): node is scw.ExportDefaultDeclaration {
  return node.type === "ExportDefaultDeclaration";
}

/**
 * code like :
 *  - `var foo = ...; export default foo`
 *  - `export default 1 + 1`
 */
export function isExportDefaultExpression(
  node: scw.Node,
): node is scw.ExportDefaultExpression {
  return node.type === "ExportDefaultExpression";
}

/**
 * code like :
 *  - `export * from "..."`
 */
export function isExportAllDeclaration(
  node: scw.Node,
): node is scw.ExportAllDeclaration {
  return node.type === "ExportAllDeclaration";
}

export function isVariableDeclarator(
  node: scw.Node,
): node is scw.VariableDeclarator {
  return node.type === "VariableDeclarator";
}
