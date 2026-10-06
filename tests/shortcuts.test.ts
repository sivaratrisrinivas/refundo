import { describe, expect, test } from "bun:test";
import { shortcutAction } from "@/lib/ui/shortcuts";

describe("keyboard shortcuts", () => {
  test("j and k move between Checkpoints", () => {
    expect(shortcutAction({ key: "j" }, false)).toBe("next");
    expect(shortcutAction({ key: "k" }, false)).toBe("prev");
  });
  test("a approves only when the button would be enabled", () => {
    expect(shortcutAction({ key: "a" }, true)).toBe("approve");
    expect(shortcutAction({ key: "a" }, false)).toBeNull();
  });
  test("shortcuts are ignored while typing in the reply or reason fields", () => {
    for (const tagName of ["TEXTAREA", "INPUT", "SELECT"]) {
      expect(shortcutAction({ key: "j", target: { tagName } }, true)).toBeNull();
      expect(shortcutAction({ key: "a", target: { tagName } }, true)).toBeNull();
    }
    expect(shortcutAction({ key: "a", target: { tagName: "DIV", isContentEditable: true } }, true)).toBeNull();
    expect(shortcutAction({ key: "a", target: { tagName: "BODY" } }, true)).toBe("approve");
  });
  test("modifier combinations and other keys do nothing", () => {
    expect(shortcutAction({ key: "a", ctrlKey: true }, true)).toBeNull();
    expect(shortcutAction({ key: "j", metaKey: true }, true)).toBeNull();
    expect(shortcutAction({ key: "x" }, true)).toBeNull();
  });
});
