import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

/** 单条候选，供 Agent 后续用 `click` 的 `selector` 字段 */
export type DomExploreCandidate = {
  label: string;
  /** 与 `click` 动作一致：`document.querySelector(selector)` */
  selector: string;
  /** 0～1，越高越可能为「有意义」主操作 */
  score: number;
  /** 调试/测试用短码，如 `tag:button`、`has-text-or-aria` */
  reasons: string[];
};

export type DomExploreOptions = {
  /** 默认 32，上限 128 */
  maxCandidates?: number;
  /** 默认 0，过滤 score < minScore */
  minScore?: number;
  /** 默认 false：是否纳入类按钮 `<a href>`（启发式） */
  includeAnchorButtons?: boolean;
  /** 默认 false：是否纳入 `[role="tab"]`（用于 Tab 导航等场景） */
  includeRoleTabs?: boolean;
  /**
   * 默认 false：是否纳入常见 Tab 文案节点（如 `.tab-label`、`.tab-item-name`）。
   * 部分 Electron/Web 应用顶部 Tab 为普通 div/span，无 `role="tab"`。
   */
  includeTabSurfaceHints?: boolean;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function normalizeText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function labelForElement($: cheerio.CheerioAPI, el: Element): string {
  const $el = $(el);
  const text = normalizeText($el.text());
  if (text.length > 0) return text.slice(0, 200);
  const aria = ($el.attr("aria-label") ?? "").trim();
  if (aria.length > 0) return aria.slice(0, 200);
  const title = ($el.attr("title") ?? "").trim();
  if (title.length > 0) return title.slice(0, 200);
  const ph = ($el.attr("placeholder") ?? "").trim();
  if (ph.length > 0) return ph.slice(0, 200);
  const val = ($el.attr("value") ?? "").trim();
  if (val.length > 0) return val.slice(0, 200);
  return "";
}

function isExcluded($: cheerio.CheerioAPI, el: Element): boolean {
  const $el = $(el);
  const ah = ($el.attr("aria-hidden") ?? "").toLowerCase();
  if (ah === "true") return true;
  if ($el.attr("disabled") !== undefined) return true;
  if (el.name === "input" && ($el.attr("type") ?? "").toLowerCase() === "hidden") return true;
  return false;
}

/** 生成尽量稳定的 CSS selector，供 `querySelector` 使用 */
export function buildCssSelectorForElement($: cheerio.CheerioAPI, el: Element): string {
  const id = $(el).attr("id")?.trim();
  if (id && id.length > 0) {
    if (/^[A-Za-z][\w-:.]*$/.test(id)) return `#${id}`;
    return `[id="${id.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
  }

  const segments: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.type === "tag") {
    const name = (cur.name ?? "div").toLowerCase();
    if (name === "html") break;
    const parNode: AnyNode | null = cur.parent ?? null;
    if (!parNode || parNode.type !== "tag" || !("children" in parNode) || !parNode.children) break;
    const parentEl = parNode as Element;
    const siblings = parentEl.children.filter(
      (c: AnyNode): c is Element => c.type === "tag" && (c as Element).name === name,
    );
    const idx = siblings.findIndex((s) => s === cur);
    const nth = idx >= 0 ? idx + 1 : 1;
    segments.unshift(`${name}:nth-of-type(${nth})`);
    cur = parentEl;
  }
  return segments.length > 0 ? `html > ${segments.join(" > ")}` : "html";
}

function scoreFor($: cheerio.CheerioAPI, el: Element, label: string, reasons: string[]): number {
  let s = 0.55;
  const tag = (el.name ?? "").toLowerCase();
  if (tag === "button") {
    s += 0.25;
    reasons.push("tag:button");
  } else if (tag === "input") {
    s += 0.2;
    reasons.push("tag:input");
  } else if (tag === "a") {
    s += 0.15;
    reasons.push("tag:a");
  } else {
    s += 0.15;
    reasons.push(`tag:${tag}`);
  }
  if (label.length > 0) {
    s += 0.12;
    reasons.push("has-text-or-aria");
  } else {
    s -= 0.15;
    reasons.push("no-visible-label");
  }
  if ($(el).attr("role") === "button") {
    s += 0.05;
    reasons.push("role:button");
  }
  if ($(el).attr("role") === "tab") {
    s += 0.08;
    reasons.push("role:tab");
  }
  const cls = ($(el).attr("class") ?? "").toLowerCase();
  if (/\btab-label\b/.test(cls) || /\btab-item-name\b/.test(cls)) {
    s += 0.06;
    reasons.push("class:tab-surface");
  }
  return clamp(Number(s.toFixed(3)), 0, 1);
}

function anchorLooksLikeButton($: cheerio.CheerioAPI, el: Element): boolean {
  const $el = $(el);
  const cls = ($el.attr("class") ?? "").toLowerCase();
  if (/\b(btn|button|cta)\b/.test(cls)) return true;
  const t = normalizeText($el.text());
  return t.length > 0 && t.length <= 48;
}

/**
 * 仅解析 HTML 字符串，不执行页面脚本。用于 `explore` Agent 动作。
 */
export function extractButtonCandidatesFromHtml(
  html: string,
  opts: DomExploreOptions = {},
): { candidates: DomExploreCandidate[] } {
  const maxCandidates = clamp(Math.floor(opts.maxCandidates ?? 32), 1, 128);
  const minScore = clamp(opts.minScore ?? 0, 0, 1);
  const includeAnchorButtons = opts.includeAnchorButtons ?? false;
  const includeRoleTabs = opts.includeRoleTabs ?? false;
  const includeTabSurfaceHints = opts.includeTabSurfaceHints ?? false;

  const $ = cheerio.load(html);
  const seen = new WeakSet<Element>();
  const rows: { el: Element; docOrder: number }[] = [];
  let docOrder = 0;

  const consider = (el: Element) => {
    if (seen.has(el)) return;
    if (isExcluded($, el)) return;
    seen.add(el);
    rows.push({ el, docOrder: docOrder++ });
  };

  $("button, input[type=\"submit\"], input[type=\"button\"], input[type=\"reset\"]").each((_, el) => {
    consider(el as Element);
  });

  $("[role=\"button\"]").each((_, el) => {
    const e = el as Element;
    if (seen.has(e)) return;
    if (!includeAnchorButtons && e.name === "a") return;
    consider(e);
  });

  if (includeAnchorButtons) {
    $("a[href]").each((_, el) => {
      const e = el as Element;
      if (seen.has(e)) return;
      if (isExcluded($, e)) return;
      if (!anchorLooksLikeButton($, e)) return;
      consider(e);
    });
  }

  if (includeRoleTabs) {
    $("[role=\"tab\"]").each((_, el) => {
      const e = el as Element;
      if (seen.has(e)) return;
      if (isExcluded($, e)) return;
      consider(e);
    });
  }

  if (includeTabSurfaceHints) {
    $(".tab-label, .tab-item-name").each((_, el) => {
      const e = el as Element;
      if (seen.has(e)) return;
      if (isExcluded($, e)) return;
      consider(e);
    });
  }

  const scored: Array<DomExploreCandidate & { docOrder: number }> = [];
  for (const { el, docOrder } of rows) {
    const reasons: string[] = [];
    const label = labelForElement($, el);
    const selector = buildCssSelectorForElement($, el);
    const score = scoreFor($, el, label, reasons);
    scored.push({ label, selector, score, reasons, docOrder });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.docOrder - b.docOrder;
  });

  const filtered = scored.filter((c) => c.score >= minScore).slice(0, maxCandidates);
  return {
    candidates: filtered.map(({ label, selector, score, reasons }) => ({ label, selector, score, reasons })),
  };
}
