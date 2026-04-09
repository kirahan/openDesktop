import { describe, expect, it } from "vitest";
import { buildCssSelectorForElement, extractButtonCandidatesFromHtml } from "./domExplore.js";
import * as cheerio from "cheerio";

describe("extractButtonCandidatesFromHtml", () => {
  it("includes button with text and excludes disabled", () => {
    const html = `<!DOCTYPE html><html><body>
      <button id="go">Submit</button>
      <button disabled>Gone</button>
    </body></html>`;
    const { candidates } = extractButtonCandidatesFromHtml(html);
    expect(candidates.some((c) => c.label === "Submit" && c.selector === "#go")).toBe(true);
    expect(candidates.some((c) => c.label === "Gone")).toBe(false);
  });

  it("includes role=button and input submit", () => {
    const html = `<html><body>
      <div role="button" tabindex="0">DivBtn</div>
      <input type="submit" value="Send" />
    </body></html>`;
    const { candidates } = extractButtonCandidatesFromHtml(html);
    expect(candidates.some((c) => c.label === "DivBtn")).toBe(true);
    expect(candidates.some((c) => c.label === "Send")).toBe(true);
  });

  it("excludes aria-hidden=true", () => {
    const html = `<html><body><button aria-hidden="true">X</button><button>Y</button></body></html>`;
    const { candidates } = extractButtonCandidatesFromHtml(html);
    expect(candidates.some((c) => c.label === "X")).toBe(false);
    expect(candidates.some((c) => c.label === "Y")).toBe(true);
  });

  it("returns empty when no controls", () => {
    const { candidates } = extractButtonCandidatesFromHtml("<html><body><p>hi</p></body></html>");
    expect(candidates).toEqual([]);
  });

  it("truncates to maxCandidates with stable ordering by score then document order", () => {
    const html = `<html><body>
      ${Array.from({ length: 10 })
        .map((_, i) => `<button>b${i}</button>`)
        .join("")}
    </body></html>`;
    const a = extractButtonCandidatesFromHtml(html, { maxCandidates: 3 });
    expect(a.candidates.length).toBe(3);
    const b = extractButtonCandidatesFromHtml(html, { maxCandidates: 3 });
    expect(b.candidates.map((c) => c.selector)).toEqual(a.candidates.map((c) => c.selector));
  });

  it("respects minScore", () => {
    const html = `<html><body><span role="button"></span><button>ok</button></body></html>`;
    const low = extractButtonCandidatesFromHtml(html, { minScore: 0 });
    const mid = extractButtonCandidatesFromHtml(html, { minScore: 0.85 });
    expect(low.candidates.length).toBeGreaterThanOrEqual(2);
    expect(mid.candidates.length).toBeGreaterThan(0);
    expect(mid.candidates.every((c) => c.score >= 0.85)).toBe(true);
    expect(mid.candidates.every((c) => c.label === "ok")).toBe(true);
  });

  it("optionally includes anchor buttons when includeAnchorButtons", () => {
    const html = `<html><body>
      <a href="/x" class="btn-primary">Go</a>
    </body></html>`;
    expect(extractButtonCandidatesFromHtml(html).candidates.some((c) => c.label === "Go")).toBe(false);
    expect(
      extractButtonCandidatesFromHtml(html, { includeAnchorButtons: true }).candidates.some((c) => c.label === "Go"),
    ).toBe(true);
  });
});

describe("buildCssSelectorForElement", () => {
  it("uses id when present", () => {
    const $ = cheerio.load(`<html><body><button id="x">a</button></body></html>`);
    const el = $("button").get(0)!;
    expect(buildCssSelectorForElement($, el)).toBe("#x");
  });
});
