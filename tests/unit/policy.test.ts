import { describe, expect, it } from "vitest";
import { parseCommit, parseTag } from "../../src/git/collect.js";
import { matches } from "../../src/policy/config.js";
import { redact, report, sanitize } from "../../src/reporters/report.js";

describe("policy and output boundaries", () => {
  it("matches only whole strings, with literal regex metacharacters", () => {
    expect(
      matches(
        "x@users.noreply.github.com",
        ["*@users.noreply.github.com"],
        true,
      ),
    ).toBe(true);
    expect(
      matches(
        "X@USERS.NOREPLY.GITHUB.COM",
        ["*@users.noreply.github.com"],
        true,
      ),
    ).toBe(true);
    expect(
      matches(
        "x@usersXnoreply.github.com",
        ["*@users.noreply.github.com"],
        true,
      ),
    ).toBe(false);
    expect(matches("Collaborator", ["collaborator"])).toBe(false);
    expect(matches("a+b", ["a+b"])).toBe(true);
    expect(matches("Alias\n", ["Alias"])).toBe(false);
    expect(matches("abXXcdYYef", ["ab*cd*ef"])).toBe(true);
    expect(matches("abXXcdYYef!", ["ab*cd*ef"])).toBe(false);
    expect(matches("", ["*"])).toBe(true);
  });
  it("redacts emails in any field and sanitizes terminal and bidi controls", () => {
    expect(redact("person@example.invalid")).toBe("p***@example.invalid");
    expect(sanitize("\x1b[2J\r\u009b\u202e")).toBe(
      "\\u001b[2J\\u000d\\u009b\\u202e",
    );
    expect(sanitize("\u061c\u200e\u200f")).toBe("\\u061c\\u200e\\u200f");
    const output = report(
      1,
      [
        {
          ruleId: "CV001",
          source: "author",
          field: "name",
          value: "person@example.invalid\x1b[2J",
        },
      ],
      false,
      false,
    );
    expect(output).not.toContain("person@");
    expect(output).not.toContain("\x1b");
  });
  it("hides entire credential URL, including query strings", () => {
    const output = report(
      0,
      [
        {
          ruleId: "CV005",
          source: "remote.origin.url",
          field: "url",
          value:
            "https://user:synthetic-password@example.invalid/path?token=synthetic-token",
        },
      ],
      true,
      false,
    );
    expect(output).not.toContain("synthetic");
    for (const json of [true, false]) {
      const revealed = report(
        0,
        [
          {
            ruleId: "CV005",
            source: "remote.url",
            field: "url",
            value:
              "https://example.invalid/repo?token=synthetic-sensitive-value",
          },
        ],
        json,
        true,
      );
      expect(revealed).not.toContain("synthetic-sensitive-value");
    }
  });
  it("fails closed on malformed commit objects", () => {
    expect(() => parseCommit("abc", "broken")).toThrow();
  });
  it("rejects ambiguous duplicate commit identity headers", () => {
    const identity = "Alias <alias@users.noreply.github.com> 1577836800 +0000";
    expect(() =>
      parseCommit(
        "abc",
        `author ${identity}\nauthor ${identity}\ncommitter ${identity}\n\nmessage`,
      ),
    ).toThrow();
    expect(() =>
      parseCommit(
        "abc",
        `author ${identity}\ncommitter ${identity}\ncommitter ${identity}\n\nmessage`,
      ),
    ).toThrow();
  });
  it.each([
    "garbage",
    "object bad\ntype tag\ntag bad\ntagger broken\n\nmessage",
  ])("rejects malformed annotated tag metadata: %s", (raw) => {
    expect(() => parseTag("abc", raw)).toThrow();
  });
});
