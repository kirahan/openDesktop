import React from "react";

export type MacAxTreeParsed =
  | { ok: true; mode: "root"; truncated: boolean; root: unknown }
  | {
      ok: true;
      mode: "atPoint";
      truncated: boolean;
      screenX: number;
      screenY: number;
      ancestors: unknown[];
      at: unknown;
    }
  | { ok: false; error: string };

/** Core `GET .../native-accessibility-tree` 或 `.../native-accessibility-at-point` 的 JSON 文本 */
export function parseMacAxTreePayload(raw: string): MacAxTreeParsed {
  const t = raw.trim();
  if (!t.startsWith("{")) return { ok: false, error: "响应不是 JSON 对象" };
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    if (j && typeof j === "object" && "at" in j && j.at != null && typeof j.screenX === "number" && typeof j.screenY === "number") {
      return {
        ok: true,
        mode: "atPoint",
        truncated: Boolean(j.truncated),
        screenX: j.screenX,
        screenY: j.screenY,
        ancestors: Array.isArray(j.ancestors) ? j.ancestors : [],
        at: j.at,
      };
    }
    if (j && typeof j === "object" && "root" in j && j.root != null) {
      return { ok: true, mode: "root", truncated: Boolean(j.truncated), root: j.root };
    }
    return { ok: false, error: "缺少 root 或 at 字段" };
  } catch {
    return { ok: false, error: "JSON 解析失败" };
  }
}

function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

const PAL = {
  border: "#e2e8f0",
  muted: "#64748b",
  roleBg: "#ffedd5",
  roleFg: "#9a3412",
  text: "#0f172a",
};

function AxTreeNode({ node, depth }: { node: unknown; depth: number }) {
  if (node == null) {
    return (
      <div style={{ paddingLeft: 8 + depth * 12, fontSize: 12, color: PAL.muted }}>null</div>
    );
  }
  if (typeof node !== "object") {
    return (
      <div style={{ paddingLeft: 8 + depth * 12, fontSize: 12, color: PAL.muted }}>
        {String(node)}
      </div>
    );
  }
  if (Array.isArray(node)) {
    return (
      <div style={{ paddingLeft: 8 + depth * 12 }}>
        {node.map((item, i) => (
          <AxTreeNode key={i} node={item} depth={depth} />
        ))}
      </div>
    );
  }

  const o = node as Record<string, unknown>;
  const role = typeof o.role === "string" ? o.role : undefined;
  const title = typeof o.title === "string" ? o.title : undefined;
  let valueStr: string | undefined;
  if (o.value !== undefined && o.value !== null) {
    if (typeof o.value === "object") {
      try {
        valueStr = JSON.stringify(o.value);
      } catch {
        valueStr = String(o.value);
      }
    } else {
      valueStr = String(o.value);
    }
  }
  const children = Array.isArray(o.children) ? o.children : undefined;
  const hasChildren = Boolean(children && children.length > 0);

  const label = (
    <span
      style={{
        display: "inline-flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 6,
        maxWidth: "100%",
      }}
    >
      {role ? (
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 700,
            padding: "2px 7px",
            borderRadius: 6,
            background: PAL.roleBg,
            color: PAL.roleFg,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          }}
        >
          {role}
        </span>
      ) : (
        <span style={{ fontSize: 10, color: PAL.muted }}>（无 role）</span>
      )}
      {title !== undefined && title !== "" ? (
        <span style={{ fontSize: 12, color: PAL.text, fontWeight: 500, wordBreak: "break-word" }}>
          {title}
        </span>
      ) : null}
      {valueStr !== undefined && valueStr !== "" ? (
        <span
          style={{
            fontSize: 11,
            color: PAL.muted,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            wordBreak: "break-all",
          }}
        >
          = {valueStr}
        </span>
      ) : null}
    </span>
  );

  if (!hasChildren) {
    return (
      <div
        style={{
          padding: "3px 0",
          paddingLeft: 6 + depth * 12,
          borderLeft: depth > 0 ? `2px solid ${PAL.border}` : "none",
        }}
      >
        {label}
      </div>
    );
  }

  return (
    <details
      defaultOpen={depth < 2}
      style={{
        margin: "2px 0",
        marginLeft: depth * 12,
        borderLeft: depth > 0 ? `2px solid ${PAL.border}` : "none",
        paddingLeft: 10,
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          padding: "4px 0",
          userSelect: "none",
        }}
      >
        {label}
        <span style={{ marginLeft: 8, fontSize: 10, color: "#94a3b8" }}>
          ({children!.length} 子项)
        </span>
      </summary>
      <div style={{ marginTop: 2, marginBottom: 6 }}>
        {children!.map((child, i) => (
          <AxTreeNode key={i} node={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

/**
 * 将 macOS AX 树 JSON 渲染为可折叠层级视图，并附带原始 JSON。
 */
export function MacAxTreeVisual({ raw }: { raw: string }) {
  const parsed = parseMacAxTreePayload(raw);
  if (!parsed.ok) {
    return (
      <pre
        style={{
          margin: 0,
          padding: 14,
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          background: "#fef2f2",
          color: "#991b1b",
          borderRadius: 8,
        }}
      >
        {parsed.error}
      </pre>
    );
  }

  return (
    <div className="od-mac-ax-tree" style={{ padding: "4px 0 0" }}>
      <style>{`
        .od-mac-ax-tree details > summary { list-style: none; }
        .od-mac-ax-tree details > summary::-webkit-details-marker { display: none; }
      `}</style>
      {parsed.truncated ? (
        <div
          style={{
            marginBottom: 10,
            padding: "8px 12px",
            fontSize: 12,
            borderRadius: 8,
            background: "#fffbeb",
            color: "#92400e",
            border: "1px solid #fde68a",
          }}
        >
          树已截断（truncated: true），以下仅为部分内容。
        </div>
      ) : null}
      {parsed.mode === "atPoint" ? (
        <div style={{ marginBottom: 10, fontSize: 12, color: PAL.muted }}>
          屏幕坐标（主屏原点）: ({parsed.screenX}, {parsed.screenY})
        </div>
      ) : null}
      {parsed.mode === "atPoint" && parsed.ancestors.length > 0 ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#334155" }}>祖先链（自父向根）</div>
          <div
            style={{
              maxHeight: 160,
              overflow: "auto",
              padding: "8px 10px",
              background: "#f8fafc",
              borderRadius: 8,
              border: `1px solid ${PAL.border}`,
            }}
          >
            {parsed.ancestors.map((n, i) => (
              <AxTreeNode key={i} node={n} depth={0} />
            ))}
          </div>
        </div>
      ) : null}
      <div
        style={{
          maxHeight: "min(70vh, 720px)",
          overflow: "auto",
          padding: "8px 10px 12px",
          background: "#fafbfc",
          borderRadius: 10,
          border: "1px solid #e2e8f0",
        }}
      >
        {parsed.mode === "root" ? (
          <AxTreeNode node={parsed.root} depth={0} />
        ) : (
          <>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#334155" }}>命中子树</div>
            <AxTreeNode node={parsed.at} depth={0} />
          </>
        )}
      </div>
      <details style={{ marginTop: 12 }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 12,
            color: PAL.muted,
            userSelect: "none",
          }}
        >
          原始 JSON
        </summary>
        <pre
          style={{
            marginTop: 8,
            marginBottom: 0,
            fontSize: 11,
            lineHeight: 1.45,
            overflow: "auto",
            maxHeight: 240,
            padding: 10,
            background: "#e2e8f0",
            borderRadius: 8,
            color: "#334155",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          {tryPrettyJson(raw)}
        </pre>
      </details>
    </div>
  );
}
