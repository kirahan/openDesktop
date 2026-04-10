import { describe, expect, it } from "vitest";
import { parseUserScriptSource } from "./parseUserScriptMetadata.js";

const SAMPLE = `// ==UserScript==
// @name         Demo
// @namespace    http://example.com/
// @version      1.0
// @description  test
// @author       a
// @match        https://a.example.com/*
// @match        https://b.example.com/*
// @grant        none
// ==/UserScript==
console.log(1);
`;

describe("parseUserScriptSource", () => {
  it("parses metadata, matches, body", () => {
    const r = parseUserScriptSource(SAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metadata.name).toBe("Demo");
    expect(r.metadata.namespace).toBe("http://example.com/");
    expect(r.metadata.version).toBe("1.0");
    expect(r.metadata.description).toBe("test");
    expect(r.metadata.author).toBe("a");
    expect(r.metadata.matches).toEqual(["https://a.example.com/*", "https://b.example.com/*"]);
    expect(r.metadata.grant).toBe("none");
    expect(r.body.trim()).toBe("console.log(1);");
  });

  it("rejects non-none grant", () => {
    const r = parseUserScriptSource(
      `// ==UserScript==
// @name x
// @grant GM_xmlhttpRequest
// ==/UserScript==
`,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("USER_SCRIPT_GRANT_NOT_SUPPORTED");
  });

  it("allows omitted @grant as none", () => {
    const r = parseUserScriptSource(
      `// ==UserScript==
// @name x
// ==/UserScript==
`,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.metadata.grant).toBe("none");
  });

  it("rejects missing @name", () => {
    const r = parseUserScriptSource(
      `// ==UserScript==
// @version 1
// ==/UserScript==
`,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("USER_SCRIPT_VALIDATION_ERROR");
  });

  it("rejects missing header", () => {
    const r = parseUserScriptSource("console.log(0)");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("USER_SCRIPT_PARSE_ERROR");
  });
});
