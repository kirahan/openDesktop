import { attachToTargetSession, withBrowserCdp, type BrowserCdp } from "./browserClient.js";

/** 与注入脚本、`Runtime.evaluate` 读取约定一致（页面 `window` 上） */
export const OD_DOM_PICK_STASH = "__odDomPickLast";

const MAX_ATTR_ENTRIES = 40;

/** 拾取确认后实线描边 class（与 arm 注入、resolve 注入共用） */
const OD_PICK_HL_CLASS = "od-dom-pick-hl";
const OD_PICK_HL_STYLE_ID = "od-dom-pick-hl-style";
/** 悬停预览（虚线） */
const OD_PICK_HOVER_CLASS = "od-dom-pick-hover";
/** 浮动标签（典型 class · tag），DevTools/Cursor 风格 */
const OD_PICK_LABEL_ID = "od-dom-pick-label";

/** 页面内拾取高亮：半透明填充 + 边框 + 标签样式（与 arm / resolve 注入共用） */
const PAGE_INJECT_STYLE_TEXT = [
  `#${OD_PICK_LABEL_ID}{position:fixed;z-index:2147483647;display:none;pointer-events:none;font:11px/1.35 ui-sans-serif,system-ui,-apple-system,sans-serif;padding:3px 8px;border-radius:6px;background:#2563eb;color:#fff;box-shadow:0 2px 8px rgba(15,23,42,0.22);white-space:nowrap;max-width:min(320px,70vw);overflow:hidden;text-overflow:ellipsis}`,
  `.${OD_PICK_HL_CLASS}{outline:2px solid #2563eb!important;outline-offset:0!important;background:rgba(37,99,235,0.15)!important;box-sizing:border-box!important}`,
  `.${OD_PICK_HOVER_CLASS}{outline:2px dashed rgba(37,99,235,0.9)!important;outline-offset:0!important;background:rgba(37,99,235,0.1)!important;box-sizing:border-box!important}`,
].join("");

/**
 * arm：注入 pointermove（实时悬停）+ pointerdown（立即确认描边并写入 stash）。
 * 样式参考 DevTools/Cursor：半透明填充、边框、右下角浮动标签（首个非内部 class · tag）。
 */
const ARM_EXPRESSION = `(function(){
  var w = window;
  var key = ${JSON.stringify(OD_DOM_PICK_STASH)};
  var CLS_PICK = ${JSON.stringify(OD_PICK_HL_CLASS)};
  var CLS_HOVER = ${JSON.stringify(OD_PICK_HOVER_CLASS)};
  var SID = ${JSON.stringify(OD_PICK_HL_STYLE_ID)};
  var LID = ${JSON.stringify(OD_PICK_LABEL_ID)};
  var STY = ${JSON.stringify(PAGE_INJECT_STYLE_TEXT)};
  var raf = null;

  function ensureStyle() {
    if (document.getElementById(SID)) return;
    var s = document.createElement("style");
    s.id = SID;
    s.textContent = STY;
    (document.head || document.documentElement).appendChild(s);
  }

  function pickLabelText(el) {
    var tag = (el.tagName || "?").toLowerCase();
    var cn = el.className && typeof el.className === "string" ? el.className.trim() : "";
    var parts = cn ? cn.split(/\\s+/).filter(Boolean) : [];
    var token = "";
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf("od-dom-pick-") === 0) continue;
      token = parts[i];
      break;
    }
    if (token.length > 40) token = token.slice(0, 37) + "...";
    if (token) return token + " · " + tag;
    if (el.id) return "#" + el.id + " · " + tag;
    return tag;
  }

  function hideLabel() {
    var lb = document.getElementById(LID);
    if (lb) lb.style.display = "none";
  }

  function syncLabel(el) {
    if (!el || el.nodeType !== 1) {
      hideLabel();
      return;
    }
    ensureStyle();
    var lb = document.getElementById(LID);
    if (!lb) {
      lb = document.createElement("div");
      lb.id = LID;
      document.documentElement.appendChild(lb);
    }
    lb.textContent = pickLabelText(el);
    lb.style.display = "block";
    var r = el.getBoundingClientRect();
    requestAnimationFrame(function () {
      var lw = lb.offsetWidth || 120;
      var lh = lb.offsetHeight || 20;
      var left = Math.max(4, Math.min(window.innerWidth - lw - 4, r.right - lw + 2));
      var top = Math.max(4, Math.min(window.innerHeight - lh - 4, r.bottom - lh + 2));
      lb.style.left = left + "px";
      lb.style.top = top + "px";
    });
  }

  function clearHoverEl() {
    if (w.__odPickHoverEl) {
      try {
        w.__odPickHoverEl.classList.remove(CLS_HOVER);
      } catch (e) {}
      w.__odPickHoverEl = null;
    }
  }

  function onMove(ev) {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = null;
      ensureStyle();
      var el = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!el || el.nodeType !== 1) {
        clearHoverEl();
        if (w.__odPickHPrev) syncLabel(w.__odPickHPrev);
        else hideLabel();
        return;
      }
      if (el === w.__odPickHPrev) {
        clearHoverEl();
        syncLabel(el);
        return;
      }
      if (el === w.__odPickHoverEl) return;
      clearHoverEl();
      try {
        el.classList.add(CLS_HOVER);
        w.__odPickHoverEl = el;
        syncLabel(el);
      } catch (e) {}
    });
  }

  function onDown(ev) {
    w[key] = { x: ev.clientX, y: ev.clientY, ts: Date.now() };
    ensureStyle();
    clearHoverEl();
    var el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || el.nodeType !== 1) return;
    if (w.__odPickHPrev && w.__odPickHPrev !== el) {
      try {
        w.__odPickHPrev.classList.remove(CLS_PICK);
      } catch (e) {}
    }
    try {
      el.classList.add(CLS_PICK);
      w.__odPickHPrev = el;
      syncLabel(el);
    } catch (e) {}
  }

  if (w.__odDomPickHandler) {
    try {
      document.removeEventListener("pointerdown", w.__odDomPickHandler, true);
    } catch (e) {}
    w.__odDomPickHandler = null;
  }
  if (w.__odDomPickMove) {
    try {
      document.removeEventListener("pointermove", w.__odDomPickMove, true);
    } catch (e) {}
    w.__odDomPickMove = null;
  }
  if (w.__odDomPickDown) {
    try {
      document.removeEventListener("pointerdown", w.__odDomPickDown, true);
    } catch (e) {}
    w.__odDomPickDown = null;
  }

  w[key] = null;
  w.__odDomPickMove = onMove;
  w.__odDomPickDown = onDown;
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerdown", onDown, true);
  return { armed: true };
})()`;

export type DomPickArmResult = { armed: true } | { error: string };

export type DomPickNodeSummary = {
  nodeId?: number;
  backendNodeId?: number;
  nodeName: string;
  localName: string;
  nodeType: number;
  attributes?: Record<string, string>;
  /**
   * 可在被测应用 **DevTools → Elements** 面板搜索框中粘贴试用的 CSS 选择器片段（由 tag/id/class/data-testid 等推断，不保证唯一）。
   * 注意：应用主窗口 **Ctrl/Cmd+F「在页面中查找」搜的是正文文字**，不能用来按标签名定位 DOM。
   */
  selectorHint?: string;
};

/**
 * 从节点 localName 与 attributes 生成 DevTools Elements 搜索可用的选择器提示。
 * @public 供单测与文档化
 */
export function buildDomPickSelectorHint(
  localName: string,
  attributes?: Record<string, string>,
): string {
  const tag = (localName || "div").toLowerCase();
  const id = attributes?.id?.trim();
  if (id) {
    if (/^[a-zA-Z_][-a-zA-Z0-9_]*$/.test(id)) {
      return `${tag}#${id}`;
    }
    const esc = id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `${tag}[id="${esc}"]`;
  }
  const testId = attributes?.["data-testid"]?.trim() || attributes?.["data-test-id"]?.trim();
  if (testId) {
    const esc = testId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `${tag}[data-testid="${esc}"]`;
  }
  const cls = attributes?.class?.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (cls?.length) {
    const safe = cls.filter((c) => /^[-a-zA-Z0-9_]+$/.test(c));
    if (safe.length > 0) {
      return `${tag}.${safe.join(".")}`;
    }
  }
  return tag;
}

/** 高亮实现方式：Electron 上 CDP Overlay 常失败，会退化为页面内注入描边 */
export type DomPickHighlightMethod = "cdp-overlay" | "page-inject";

export type DomPickResolveOk = {
  pick: { x: number; y: number; ts: number };
  node: DomPickNodeSummary;
  /** 是否在目标窗口内对拾取节点做了可见高亮 */
  highlightApplied: boolean;
  /** 实际生效的方式；未高亮时为 undefined */
  highlightMethod?: DomPickHighlightMethod;
  /**
   * CDP Overlay 各步失败原因摘要（便于确认「是否连上 Overlay」）。
   * 若最终为 `page-inject` 成功，此处通常非空，说明 Overlay 不可用但注入回退成功。
   */
  highlightOverlayError?: string;
  /**
   * 说明：CDP Overlay 依赖调试器 WebSocket；`dom-pick/resolve` 返回后连接即关闭，**Overlay 高亮会随会话结束消失**。
   * 持久可见的描边来自页面注入（`page-inject`），与 Overlay 是否曾成功无关。
   */
  highlightPersistNote?: string;
};

export type DomPickResolveResult =
  | ({ ok: true } & DomPickResolveOk)
  | { ok: false; code: "DOM_PICK_EMPTY" | "DOM_PICK_NO_NODE" | "CDP_ERROR"; message: string };

/**
 * 在目标 page 注入拾取监听：`pointermove` 实时虚线预览，`pointerdown` 写入 `window[OD_DOM_PICK_STASH]` 并立即实线描边。
 *
 * @param cdpPort 会话子进程 remote debugging 端口
 * @param targetId CDP `page` 类型 target id
 */
export async function domPickArm(cdpPort: number, targetId: string): Promise<DomPickArmResult> {
  const r = await withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await clearPageInjectPickHighlight(cdp, sessionId);
    await tryOverlayHideHighlight(cdp, sessionId);
    const ev = (await cdp.send(
      "Runtime.evaluate",
      { expression: ARM_EXPRESSION, returnByValue: true, awaitPromise: false },
      sessionId,
    )) as { exceptionDetails?: unknown; result?: { value?: unknown } };
    if (ev.exceptionDetails) throw new Error("arm_evaluate_failed");
    void ev.result?.value;
    return { armed: true as const };
  });
  if (r !== null && typeof r === "object" && "error" in r && (r as { error?: string }).error) {
    return { error: (r as { error: string }).error };
  }
  return { armed: true };
}

export type DomPickCancelResult = { cleared: true } | { error: string };

/**
 * 结束拾取：移除 pointer 监听、清除页面描边/浮动标签、清 stash、隐藏 CDP Overlay。
 */
export async function domPickCancel(cdpPort: number, targetId: string): Promise<DomPickCancelResult> {
  const r = await withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await clearPageInjectPickHighlight(cdp, sessionId);
    await tryOverlayHideHighlight(cdp, sessionId);
    await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(function(){ try { window[${JSON.stringify(OD_DOM_PICK_STASH)}] = null; } catch (e) {} })()`,
        returnByValue: true,
        awaitPromise: false,
      },
      sessionId,
    );
    return { cleared: true as const };
  });
  if (r !== null && typeof r === "object" && "error" in r && (r as { error?: string }).error) {
    return { error: (r as { error: string }).error };
  }
  return { cleared: true };
}

/** 与 DevTools 元素高亮类似的半透明描边（Chromium / Electron CDP Overlay） */
const DOM_PICK_HIGHLIGHT_CONFIG = {
  showInfo: true,
  contentColor: { r: 120, g: 170, b: 255, a: 0.35 },
  borderColor: { r: 37, g: 99, b: 235, a: 0.95 },
};

/** 清除页面注入式高亮（与 Runtime.evaluate 注入的 class/style / 监听 对应） */
const CLEAR_PAGE_INJECT_HIGHLIGHT_EXPR = `(function(){
  try {
    var w = window;
    if (w.__odDomPickHandler) {
      try { document.removeEventListener("pointerdown", w.__odDomPickHandler, true); } catch (e) {}
      w.__odDomPickHandler = null;
    }
    if (w.__odDomPickMove) {
      try { document.removeEventListener("pointermove", w.__odDomPickMove, true); } catch (e) {}
      w.__odDomPickMove = null;
    }
    if (w.__odDomPickDown) {
      try { document.removeEventListener("pointerdown", w.__odDomPickDown, true); } catch (e) {}
      w.__odDomPickDown = null;
    }
    if (w.__odPickHoverEl) {
      try { w.__odPickHoverEl.classList.remove(${JSON.stringify(OD_PICK_HOVER_CLASS)}); } catch (e) {}
      w.__odPickHoverEl = null;
    }
    if (w.__odPickHPrev) {
      try { w.__odPickHPrev.classList.remove(${JSON.stringify(OD_PICK_HL_CLASS)}); } catch (e) {}
      w.__odPickHPrev = null;
    }
    var lb = document.getElementById(${JSON.stringify(OD_PICK_LABEL_ID)});
    if (lb && lb.parentNode) lb.parentNode.removeChild(lb);
    var st = document.getElementById(${JSON.stringify(OD_PICK_HL_STYLE_ID)});
    if (st) st.remove();
  } catch (e) {}
})()`;

async function clearPageInjectPickHighlight(cdp: BrowserCdp, sessionId: string): Promise<void> {
  try {
    await cdp.send(
      "Runtime.evaluate",
      { expression: CLEAR_PAGE_INJECT_HIGHLIGHT_EXPR, returnByValue: true, awaitPromise: false },
      sessionId,
    );
  } catch {
    /* 忽略 */
  }
}

function formatCdpErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function tryOverlayHideHighlight(cdp: BrowserCdp, sessionId: string): Promise<void> {
  try {
    await cdp.send("Overlay.enable", {}, sessionId);
    await cdp.send("Overlay.hideHighlight", {}, sessionId);
  } catch {
    /* Overlay 不可用时忽略，不影响 arm */
  }
}

/**
 * 依次尝试 CDP Overlay（Electron 上仅 backendId 常静默失败）：
 * pushNodes → highlightNode(nodeId) → highlightNode(backendId) → getBoxModel + highlightQuad
 */
async function tryCdpOverlayHighlight(
  cdp: BrowserCdp,
  sessionId: string,
  backendNodeId: number,
): Promise<{ ok: true } | { ok: false; errors: string[] }> {
  const errors: string[] = [];
  try {
    await cdp.send("Overlay.enable", {}, sessionId);
  } catch (e) {
    errors.push(`Overlay.enable: ${formatCdpErr(e)}`);
    return { ok: false, errors };
  }

  try {
    const pushed = (await cdp.send(
      "DOM.pushNodesByBackendIdsToFrontend",
      { backendNodeIds: [backendNodeId] },
      sessionId,
    )) as { nodeIds?: number[] };
    const nid = pushed.nodeIds?.[0];
    if (typeof nid === "number" && nid > 0) {
      await cdp.send(
        "Overlay.highlightNode",
        { highlightConfig: DOM_PICK_HIGHLIGHT_CONFIG, nodeId: nid },
        sessionId,
      );
      return { ok: true };
    }
    errors.push("pushNodesByBackendIdsToFrontend: empty nodeIds");
  } catch (e) {
    errors.push(`highlightNode(nodeId): ${formatCdpErr(e)}`);
  }

  try {
    await cdp.send(
      "Overlay.highlightNode",
      {
        highlightConfig: DOM_PICK_HIGHLIGHT_CONFIG,
        backendNodeId,
      },
      sessionId,
    );
    return { ok: true };
  } catch (e) {
    errors.push(`highlightNode(backendNodeId): ${formatCdpErr(e)}`);
  }

  try {
    const bm = (await cdp.send("DOM.getBoxModel", { backendNodeId }, sessionId)) as {
      model?: { content?: number[]; border?: number[] };
    };
    const quad = bm.model?.content ?? bm.model?.border;
    if (quad && quad.length >= 8) {
      await cdp.send(
        "Overlay.highlightQuad",
        {
          quad,
          color: { r: 120, g: 170, b: 255, a: 0.25 },
          outlineColor: { r: 37, g: 99, b: 235, a: 0.9 },
        },
        sessionId,
      );
      return { ok: true };
    }
    errors.push("DOM.getBoxModel: no quad");
  } catch (e) {
    errors.push(`getBoxModel/highlightQuad: ${formatCdpErr(e)}`);
  }

  return { ok: false, errors };
}

/** Electron 上 Overlay 不可靠时，在页面内用 elementFromPoint + outline 做可见回退 */
async function tryPageInjectHighlight(
  cdp: BrowserCdp,
  sessionId: string,
  x: number,
  y: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const xr = Math.round(x);
  const yr = Math.round(y);
  const expr = `(function(){
  var x = ${xr}, y = ${yr};
  var CLS = ${JSON.stringify(OD_PICK_HL_CLASS)};
  var SID = ${JSON.stringify(OD_PICK_HL_STYLE_ID)};
  var LID = ${JSON.stringify(OD_PICK_LABEL_ID)};
  var STY = ${JSON.stringify(PAGE_INJECT_STYLE_TEXT)};
  function pickLabelText(el) {
    var tag = (el.tagName || "?").toLowerCase();
    var cn = el.className && typeof el.className === "string" ? el.className.trim() : "";
    var parts = cn ? cn.split(/\\s+/).filter(Boolean) : [];
    var token = "";
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].indexOf("od-dom-pick-") === 0) continue;
      token = parts[i];
      break;
    }
    if (token.length > 40) token = token.slice(0, 37) + "...";
    if (token) return token + " · " + tag;
    if (el.id) return "#" + el.id + " · " + tag;
    return tag;
  }
  function syncLabel(el) {
    if (!el || el.nodeType !== 1) return;
    var lb = document.getElementById(LID);
    if (!lb) {
      lb = document.createElement("div");
      lb.id = LID;
      document.documentElement.appendChild(lb);
    }
    lb.textContent = pickLabelText(el);
    lb.style.display = "block";
    var r = el.getBoundingClientRect();
    requestAnimationFrame(function () {
      var lw = lb.offsetWidth || 120;
      var lh = lb.offsetHeight || 20;
      var left = Math.max(4, Math.min(window.innerWidth - lw - 4, r.right - lw + 2));
      var top = Math.max(4, Math.min(window.innerHeight - lh - 4, r.bottom - lh + 2));
      lb.style.left = left + "px";
      lb.style.top = top + "px";
    });
  }
  var el = document.elementFromPoint(x, y);
  if (!el || el.nodeType !== 1) return "no_element";
  if (window.__odPickHPrev && window.__odPickHPrev !== el) {
    try { window.__odPickHPrev.classList.remove(CLS); } catch (e) {}
  }
  el.classList.add(CLS);
  if (!document.getElementById(SID)) {
    var s = document.createElement("style");
    s.id = SID;
    s.textContent = STY;
    (document.head || document.documentElement).appendChild(s);
  }
  try { el.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) {}
  syncLabel(el);
  window.__odPickHPrev = el;
  return "ok";
})()`;
  try {
    const ev = (await cdp.send(
      "Runtime.evaluate",
      { expression: expr, returnByValue: true, awaitPromise: false },
      sessionId,
    )) as { exceptionDetails?: unknown; result?: { value?: unknown } };
    if (ev.exceptionDetails) {
      return { ok: false, error: "page_inject_eval_exception" };
    }
    const v = ev.result?.value;
    if (v === "ok") return { ok: true };
    return { ok: false, error: String(v) };
  } catch (e) {
    return { ok: false, error: formatCdpErr(e) };
  }
}

function parseStashJson(raw: string | null | undefined): { x: number; y: number; ts: number } | null {
  if (!raw || raw === "null") return null;
  try {
    const o = JSON.parse(raw) as { x?: unknown; y?: unknown; ts?: unknown };
    if (typeof o.x !== "number" || typeof o.y !== "number") return null;
    return {
      x: o.x,
      y: o.y,
      ts: typeof o.ts === "number" ? o.ts : 0,
    };
  } catch {
    return null;
  }
}

function attributesArrayToRecord(pairs: string[] | undefined): Record<string, string> | undefined {
  if (!pairs || pairs.length === 0) return undefined;
  const out: Record<string, string> = {};
  const limit = Math.min(pairs.length, MAX_ATTR_ENTRIES * 2);
  for (let i = 0; i + 1 < limit; i += 2) {
    const k = pairs[i];
    const v = pairs[i + 1];
    if (typeof k === "string" && typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** 读取并清空 stash（一次 resolve 消费一次点击）。 */
async function takeStash(
  cdp: BrowserCdp,
  sessionId: string,
): Promise<{ x: number; y: number; ts: number } | null> {
  const ev = (await cdp.send(
    "Runtime.evaluate",
    {
      expression: `(function(){
        var k = ${JSON.stringify(OD_DOM_PICK_STASH)};
        var s = window[k];
        window[k] = null;
        if (!s || typeof s.x !== "number" || typeof s.y !== "number") return "";
        return JSON.stringify(s);
      })()`,
      returnByValue: true,
      awaitPromise: false,
    },
    sessionId,
  )) as { result?: { value?: string } };
  const raw = ev.result?.value;
  if (typeof raw !== "string" || raw === "") return null;
  return parseStashJson(raw);
}

/**
 * 读取最近一次指针坐标（并清空 stash），再调用 `DOM.getNodeForLocation` + `DOM.describeNode`。
 *
 * @param cdpPort 会话子进程 remote debugging 端口
 * @param targetId CDP `page` 类型 target id
 */
export async function domPickResolve(cdpPort: number, targetId: string): Promise<DomPickResolveResult> {
  const r = await withBrowserCdp(cdpPort, async (cdp) => {
    const sessionId = await attachToTargetSession(cdp, targetId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("DOM.enable", {}, sessionId);

    const pick = await takeStash(cdp, sessionId);
    if (!pick) {
      return { ok: false, code: "DOM_PICK_EMPTY" as const, message: "No pointer pick recorded; arm first and click in the target window" };
    }

    const xr = Math.round(pick.x);
    const yr = Math.round(pick.y);

    let loc: { backendNodeId?: number; nodeId?: number };
    try {
      loc = (await cdp.send(
        "DOM.getNodeForLocation",
        { x: xr, y: yr },
        sessionId,
      )) as { backendNodeId?: number; nodeId?: number };
    } catch (e) {
      return {
        ok: false,
        code: "CDP_ERROR" as const,
        message: e instanceof Error ? e.message : String(e),
      };
    }

    const backendNodeId = loc.backendNodeId;
    if (backendNodeId === undefined || backendNodeId === 0) {
      return {
        ok: false,
        code: "DOM_PICK_NO_NODE" as const,
        message: "No DOM node at pick location",
      };
    }

    const desc = (await cdp.send(
      "DOM.describeNode",
      { backendNodeId },
      sessionId,
    )) as {
      node?: {
        nodeId?: number;
        backendNodeId?: number;
        nodeName?: string;
        localName?: string;
        nodeType?: number;
        attributes?: string[];
      };
    };

    const n = desc.node;
    if (!n) {
      return {
        ok: false,
        code: "CDP_ERROR" as const,
        message: "describeNode returned no node",
      };
    }

    const attrs = attributesArrayToRecord(n.attributes);
    const node: DomPickNodeSummary = {
      nodeId: n.nodeId,
      backendNodeId: n.backendNodeId ?? backendNodeId,
      nodeName: n.nodeName ?? "",
      localName: n.localName ?? "",
      nodeType: typeof n.nodeType === "number" ? n.nodeType : 0,
      attributes: attrs,
      selectorHint: buildDomPickSelectorHint(n.localName ?? "", attrs),
    };

    const bid = node.backendNodeId ?? backendNodeId;

    let overlayResult: { ok: true } | { ok: false; errors: string[] } = { ok: false, errors: [] };
    if (typeof bid === "number" && bid > 0) {
      overlayResult = await tryCdpOverlayHighlight(cdp, sessionId, bid);
    }

    /** 与 resolve 共用同一 CDP 会话；HTTP 返回后 `withBrowserCdp` 会断开连接，CDP Overlay 随之消失，只有 DOM 注入可持久可见 */
    const inj = await tryPageInjectHighlight(cdp, sessionId, pick.x, pick.y);

    let highlightApplied = inj.ok;
    let highlightMethod: DomPickHighlightMethod | undefined;
    let highlightOverlayError: string | undefined;
    let highlightPersistNote: string | undefined;

    if (inj.ok) {
      highlightMethod = "page-inject";
      if (!overlayResult.ok) {
        highlightOverlayError = overlayResult.errors.join(" | ");
      }
      highlightPersistNote =
        "可见描边由页面 class 注入，关闭调试连接后仍保留；CDP Overlay 若曾成功也会在断连后消失。";
    } else {
      if (!overlayResult.ok) {
        highlightOverlayError = `${overlayResult.errors.join(" | ")} | page-inject: ${inj.error}`;
      } else {
        highlightMethod = "cdp-overlay";
        highlightOverlayError = `page-inject: ${inj.error}`;
        highlightPersistNote =
          "CDP Overlay 在请求返回前曾成功，但 HTTP 结束后调试连接关闭，高亮会立即消失；持久描边需页面注入成功。";
      }
    }

    return {
      ok: true,
      pick,
      node,
      highlightApplied,
      highlightMethod,
      highlightOverlayError,
      highlightPersistNote,
    };
  });

  if ("error" in r && r.error) {
    return { ok: false, code: "CDP_ERROR", message: r.error };
  }
  return r as DomPickResolveResult;
}
