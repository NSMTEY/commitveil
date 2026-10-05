import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import type { Policy } from "../core/types.js";
export const defaultPolicy: Policy = {
  allowedNames: [],
  allowedEmails: ["*@users.noreply.github.com"],
};
export function loadPolicy(root: string): Policy {
  let text: string;
  const path = join(root, ".commitveil.json");
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        lstatSync(path);
      } catch (missing) {
        if ((missing as NodeJS.ErrnoException).code === "ENOENT")
          return defaultPolicy;
      }
    }
    throw new Error("Cannot read .commitveil.json.");
  }
  try {
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (!count) break;
      bytes += count;
    }
    if (bytes === buffer.length) throw new Error();
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, bytes),
    );
  } catch {
    throw new Error(
      "Cannot read .commitveil.json: expected UTF-8 JSON no larger than 1 MiB.",
    );
  } finally {
    closeSync(fd);
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    const object = value as Record<string, unknown>;
    if (
      Object.keys(object).some(
        (key) => key !== "allowedNames" && key !== "allowedEmails",
      )
    )
      throw new Error();
    for (const key of ["allowedNames", "allowedEmails"]) {
      const list = object[key];
      if (
        list !== undefined &&
        (!Array.isArray(list) ||
          list.some(
            (item: unknown) =>
              typeof item !== "string" ||
              !item.length ||
              Array.from(item).some(
                (char) =>
                  char.charCodeAt(0) < 32 ||
                  (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
              ),
          ))
      )
        throw new Error();
    }
    return {
      allowedNames: (object.allowedNames as string[] | undefined) ?? [],
      allowedEmails: (object.allowedEmails as string[] | undefined) ?? [],
    };
  } catch {
    throw new Error(
      "Invalid .commitveil.json: expected allowedNames and allowedEmails arrays of nonempty strings only.",
    );
  }
}
export function matches(
  value: string,
  patterns: string[],
  insensitive = false,
): boolean {
  return patterns.some((pattern) => {
    const text = insensitive ? value.toLowerCase() : value;
    const glob = insensitive ? pattern.toLowerCase() : pattern;
    let i = 0;
    let j = 0;
    let star = -1;
    let retry = 0;
    while (i < text.length) {
      if (glob[j] === "*") {
        star = j++;
        retry = i;
      } else if (glob[j] === text[i]) {
        i++;
        j++;
      } else if (star >= 0) {
        j = star + 1;
        i = ++retry;
      } else return false;
    }
    while (glob[j] === "*") j++;
    return j === glob.length;
  });
}
