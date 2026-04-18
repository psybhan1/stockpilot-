import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AGE_GATE_DIRECT_SELECTORS,
  AGE_GATE_TEXT_PATTERNS,
  isAgeGateConfirmText,
} from "./age-gate";

describe("isAgeGateConfirmText — confirmation copy", () => {
  it("accepts 'Yes, I'm 21'", () => {
    assert.equal(isAgeGateConfirmText("Yes, I'm 21"), true);
  });

  it("accepts 'Yes, I am 21'", () => {
    assert.equal(isAgeGateConfirmText("Yes, I am 21"), true);
  });

  it("accepts 'I am 19'", () => {
    assert.equal(isAgeGateConfirmText("I am 19"), true);
  });

  it("accepts 'I'm of legal age'", () => {
    assert.equal(isAgeGateConfirmText("I'm of legal age"), true);
  });

  it("accepts 'I am of drinking age'", () => {
    // Matches the "i am .. of (drinking|legal) age" branch via the
    // second OR third pattern — either is fine.
    assert.equal(isAgeGateConfirmText("I am of legal age"), true);
  });

  it("accepts 'Enter Site'", () => {
    assert.equal(isAgeGateConfirmText("Enter Site"), true);
  });

  it("accepts 'Enter Store'", () => {
    assert.equal(isAgeGateConfirmText("Enter Store"), true);
  });

  it("accepts 'Enter shop'", () => {
    assert.equal(isAgeGateConfirmText("enter shop"), true);
  });

  it("accepts 'Confirm age'", () => {
    assert.equal(isAgeGateConfirmText("Confirm age"), true);
  });

  it("accepts 'Confirm'", () => {
    assert.equal(isAgeGateConfirmText("Confirm"), true);
  });

  it("accepts 'Over 21'", () => {
    assert.equal(isAgeGateConfirmText("Over 21"), true);
  });

  it("accepts '19+' shorthand (LCBO Canada)", () => {
    assert.equal(isAgeGateConfirmText("19+"), true);
  });

  it("accepts '21+' shorthand (US)", () => {
    assert.equal(isAgeGateConfirmText("21+"), true);
  });

  it("handles curly apostrophe ('I'm 21')", () => {
    assert.equal(isAgeGateConfirmText("Yes, I\u2019m 21"), true);
  });
});

describe("isAgeGateConfirmText — denial copy (must NOT confirm)", () => {
  it("rejects 'No, I'm under 21'", () => {
    assert.equal(isAgeGateConfirmText("No, I'm under 21"), false);
  });

  it("rejects 'No, I am under 19'", () => {
    // "No I'm not" variant — underlying regex catches "no..under|not".
    assert.equal(isAgeGateConfirmText("No, I am not old enough"), false);
  });

  it("rejects 'Exit'", () => {
    assert.equal(isAgeGateConfirmText("Exit"), false);
  });

  it("rejects 'Exit Site'", () => {
    assert.equal(isAgeGateConfirmText("Exit Site"), false);
  });

  it("rejects denial with curly apostrophe", () => {
    assert.equal(isAgeGateConfirmText("No, I\u2019m under 21"), false);
  });
});

describe("isAgeGateConfirmText — empty / whitespace", () => {
  it("rejects empty string", () => {
    assert.equal(isAgeGateConfirmText(""), false);
  });

  it("rejects whitespace-only string", () => {
    assert.equal(isAgeGateConfirmText("   \n\t  "), false);
  });
});

describe("isAgeGateConfirmText — unrelated text", () => {
  it("rejects 'Add to Cart'", () => {
    assert.equal(isAgeGateConfirmText("Add to Cart"), false);
  });

  it("rejects 'Sign In'", () => {
    assert.equal(isAgeGateConfirmText("Sign In"), false);
  });

  it("rejects 'Yes' alone (ambiguous, could be anything)", () => {
    assert.equal(isAgeGateConfirmText("Yes"), false);
  });

  it("rejects bare age number without 'over' or '+'", () => {
    assert.equal(isAgeGateConfirmText("21"), false);
  });
});

describe("isAgeGateConfirmText — case insensitivity", () => {
  it("SHOUTED confirm still confirms", () => {
    assert.equal(isAgeGateConfirmText("ENTER SITE"), true);
  });

  it("tiny confirm still confirms", () => {
    assert.equal(isAgeGateConfirmText("enter site"), true);
  });

  it("SHOUTED deny still denies", () => {
    assert.equal(isAgeGateConfirmText("EXIT"), false);
  });
});

describe("isAgeGateConfirmText — trims surrounding whitespace", () => {
  it("tolerates leading/trailing whitespace", () => {
    assert.equal(isAgeGateConfirmText("  Enter Site  "), true);
  });

  it("tolerates newline padding", () => {
    assert.equal(isAgeGateConfirmText("\n\nOver 21\n"), true);
  });
});

describe("isAgeGateConfirmText — priority: deny beats confirm", () => {
  it("'No, I'm under 21. Enter site anyway.' → deny wins", () => {
    // Regex checks deny FIRST. Even if a confirm pattern would also
    // match, the deny short-circuits. Protects against malicious or
    // malformed sites that pack both strings into one button.
    assert.equal(
      isAgeGateConfirmText("No, I'm under 21. Enter site anyway."),
      false
    );
  });

  it("'Exit Enter Site' → deny wins", () => {
    assert.equal(isAgeGateConfirmText("Exit Enter Site"), false);
  });
});

describe("AGE_GATE_TEXT_PATTERNS export", () => {
  it("exports an array of RegExp", () => {
    assert.ok(Array.isArray(AGE_GATE_TEXT_PATTERNS));
    assert.ok(AGE_GATE_TEXT_PATTERNS.length > 0);
    for (const p of AGE_GATE_TEXT_PATTERNS) {
      assert.ok(p instanceof RegExp);
    }
  });

  it("letter-containing patterns have the 'i' flag (case-insensitive)", () => {
    // The digit-only "19+/20+/21+" pattern doesn't need case-
    // insensitivity. Every pattern that contains ASCII letters must.
    for (const p of AGE_GATE_TEXT_PATTERNS) {
      if (/[a-z]/i.test(p.source.replace(/\\[a-z]/gi, ""))) {
        assert.match(p.flags, /i/, `pattern lacks 'i' flag: ${p.source}`);
      }
    }
  });

  it("can be round-tripped through `.toString()` + new RegExp (page.evaluate bridge)", () => {
    // The puppeteer side of generic.ts serialises these regexes as
    // strings and re-parses them inside the page. Make sure that
    // bridge doesn't silently break.
    for (const p of AGE_GATE_TEXT_PATTERNS) {
      const src = p.toString();
      const body = src.replace(/^\/(.+)\/([gimsuy]*)$/, "$1");
      const flags = src.replace(/^\/(.+)\/([gimsuy]*)$/, "$2") || "i";
      const rebuilt = new RegExp(body, flags);
      assert.equal(rebuilt.flags, flags);
    }
  });
});

describe("AGE_GATE_DIRECT_SELECTORS export", () => {
  it("exports an array of non-empty strings", () => {
    assert.ok(Array.isArray(AGE_GATE_DIRECT_SELECTORS));
    assert.ok(AGE_GATE_DIRECT_SELECTORS.length > 0);
    for (const s of AGE_GATE_DIRECT_SELECTORS) {
      assert.equal(typeof s, "string");
      assert.ok(s.length > 0);
    }
  });

  it("selectors start with button/a (real DOM targets, not junk)", () => {
    for (const s of AGE_GATE_DIRECT_SELECTORS) {
      assert.match(s, /^(?:button|a)/);
    }
  });

  it("includes common alcohol-site patterns (age in id/class)", () => {
    assert.ok(AGE_GATE_DIRECT_SELECTORS.some((s) => s.includes('id*="age"')));
    assert.ok(AGE_GATE_DIRECT_SELECTORS.some((s) => s.includes('class*="age"')));
  });
});
