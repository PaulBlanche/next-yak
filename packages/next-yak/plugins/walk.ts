import * as swc from "@swc/core";
import * as swcAssert from "./swcAssert.js";

export async function walk(module: swc.Node, visitor: Visitor) {
  const stack: Entry[] = [{ node: module, type: "enter" }];

  let current: Entry | undefined = undefined;
  while ((current = stack.pop()) !== undefined) {
    const node = current.node;

    if (current.type === "enter") {
      const shouldVisitChildren = (await visitor.enter(node)) ?? true;

      if (!shouldVisitChildren) {
        continue;
      }

      const children: swc.Node[] = [];
      for (const key in node) {
        const value = /** @type {any} */ node[key];
        if (Array.isArray(value)) {
          for (const child of value) {
            if (swcAssert.isNode(child)) {
              children.push(child);
            } else if (
              swcAssert.isArgument(child) &&
              swcAssert.isNode(child.expression)
            ) {
              children.push(child.expression);
            }
          }
        } else if (swcAssert.isNode(value)) {
          children.push(value);
        } else if (
          swcAssert.isArgument(value) &&
          swcAssert.isNode(value.expression)
        ) {
          children.push(value.expression);
        }
      }

      stack.push({ type: "exit", node });
      for (const child of children.reverse()) {
        stack.push({ type: "enter", node: child });
      }
    } else {
      await visitor.exit?.(node);
    }
  }
}

type Entry = { node: swc.Node; type: "enter" | "exit" };

type Visitor = {
  enter: (
    node: swc.Node,
  ) => Promise<boolean | undefined | void> | boolean | undefined | void;
  exit?: (node: swc.Node) => Promise<void>;
};
