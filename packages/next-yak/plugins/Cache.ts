/** @import * as self from "./Cacher.js" */

import * as fs from "node:fs";
import * as crypto from "node:crypto";

export class Cache {
  #root: RootCache;

  constructor() {
    this.#root = new RootCache();
  }

  namespace<STORED>(namespace: string[]) {
    return new NamespaceCache<STORED>(this.#root, namespace);
  }
}

class RootCache {
  #cache: {
    data: Map<string, { value: unknown; dependencies: Set<string> }>;
    dependencies: Map<string, { mtime: number; dependents: Set<string> }>;
  };

  constructor() {
    this.#cache = { data: new Map(), dependencies: new Map() };
  }

  get(key: string) {
    const cached = this.#cache.data.get(key);

    // data in cache
    if (cached !== undefined) {
      if (!this.#isKeyStale(key)) {
        return cached.value;
      }
    }

    // no data found
    return undefined;
  }

  set(key: string, data: unknown) {
    const cached = this.#cache.data.get(key);
    if (cached === undefined) {
      this.#cache.data.set(key, { value: data, dependencies: new Set() });
    }
  }

  addDependency(key: string, filePath: string) {
    const cached = this.#cache.data.get(key);

    if (cached !== undefined) {
      cached.dependencies.add(filePath);
      const dependencyData = this.#cache.dependencies.get(filePath);
      if (dependencyData === undefined) {
        this.#cache.dependencies.set(filePath, {
          mtime: getMtime(filePath),
          dependents: new Set([key]),
        });
      } else {
        dependencyData.dependents.add(key);
      }
    }
  }

  #isKeyStale(key: string) {
    const cached = this.#cache.data.get(key);

    let isStale = false;

    if (cached === undefined) {
      return isStale;
    }

    for (const dependency of cached.dependencies) {
      const dependencyData = this.#cache.dependencies.get(dependency);
      if (dependencyData === undefined) {
        isStale = true;
      } else if (dependencyData.mtime < getMtime(dependency)) {
        isStale = true;
        if (dependencyData !== undefined) {
          for (const key of dependencyData.dependents) {
            this.#cache.data.delete(key);
          }
          this.#cache.dependencies.delete(dependency);
        }
      }
    }

    return isStale;
  }
}

class NamespaceCache<STORED> {
  #root: RootCache;
  #namespace: string[];

  constructor(root: RootCache, namespace: string[]) {
    this.#root = root;
    this.#namespace = namespace;
  }

  get(key: string) {
    const dataKey = getDataKey(this.#namespace, key);
    return this.#root.get(dataKey) as STORED;
  }

  set(key: string, data: STORED) {
    const dataKey = getDataKey(this.#namespace, key);
    this.#root.set(dataKey, data);
  }

  addDependency(key: string, filePath: string) {
    const dataKey = getDataKey(this.#namespace, key);
    this.#root.addDependency(dataKey, filePath);
  }
}

function getDataKey(namespace: string[], key: string) {
  return namespace
    .reduce(
      (hasher, segment) => hasher.update(segment),
      crypto.createHash("md5"),
    )
    .update(key)
    .digest("hex");
}
function getMtime(filePath: string): number {
  return fs.statSync(filePath).mtimeMs;
}
