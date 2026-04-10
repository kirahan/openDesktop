import React, { useEffect, useMemo, useState } from "react";
import { filterNetworkRows } from "./filterRows.js";
import type { NetworkRequestRow } from "./types.js";
import "./networkView.css";

type DetailTab = "overview" | "inspectors" | "timeline";

export type NetworkViewProps = {
  /** SSE `requestComplete` 累积；可为空 */
  rows: NetworkRequestRow[];
};

function fullUrl(r: NetworkRequestRow): string {
  try {
    return new URL(r.url, `https://${r.host}`).href;
  } catch {
    return `https://${r.host}${r.url.startsWith("/") ? "" : "/"}${r.url}`;
  }
}

export function NetworkView({ rows }: NetworkViewProps) {
  const [filter, setFilter] = useState("");
  const visible = useMemo(() => filterNetworkRows(rows, filter), [rows, filter]);
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [tab, setTab] = useState<DetailTab>("overview");

  useEffect(() => {
    if (visible.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((prev) =>
      prev && visible.some((r) => r.id === prev) ? prev : visible[0]!.id,
    );
  }, [visible]);

  const selected = visible.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="od-network-root od-network-root--embed" aria-label="Network 观测">
      <div className="od-network-toolbar" role="toolbar" aria-label="工具栏占位">
        <button type="button" disabled title="占位">
          Record
        </button>
        <button type="button" disabled>
          Import
        </button>
        <button type="button" disabled>
          Export
        </button>
        <button type="button" disabled>
          Clear
        </button>
        <button type="button" disabled>
          Replay
        </button>
        <button type="button" disabled>
          Edit
        </button>
        <button type="button" disabled>
          Settings
        </button>
      </div>

      <div className="od-network-main">
        <div className="od-network-list-wrap">
          <div className="od-network-table-scroll">
            <table className="od-network-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>#</th>
                  <th style={{ width: 44 }}>Result</th>
                  <th style={{ width: 52 }}>Method</th>
                  <th style={{ width: 48 }}>Src</th>
                  <th style={{ width: "18%" }}>Host</th>
                  <th style={{ width: "auto" }}>URL</th>
                  <th style={{ width: 56 }}>Type</th>
                  <th style={{ width: 52 }}>ms</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 16, color: "#64748b", textAlign: "center" }}>
                      暂无请求行；订阅建立后仅展示<strong>新完成</strong>的请求（与 Core SSE 一致）。
                    </td>
                  </tr>
                ) : (
                  visible.map((r, i) => (
                    <tr
                      key={`${r.id}-${i}`}
                      className={selectedId === r.id ? "od-network-row-selected" : undefined}
                      onClick={() => {
                        setSelectedId(r.id);
                        setTab("overview");
                      }}
                    >
                      <td>{i + 1}</td>
                      <td>{r.status || "—"}</td>
                      <td>{r.method}</td>
                      <td title={r.source === "proxy" ? "本地转发代理" : "CDP"}>
                        {r.source === "proxy" ? "proxy" : "cdp"}
                      </td>
                      <td title={r.host}>{r.host}</td>
                      <td title={r.url}>{r.url}</td>
                      <td>{r.type}</td>
                      <td>{r.durationMs !== undefined ? Math.round(r.durationMs) : "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="od-network-filter-bar">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Type filter text"
              aria-label="过滤请求"
            />
          </div>
        </div>

        <div className="od-network-detail">
          <div className="od-network-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "overview"}
              className={tab === "overview" ? "od-network-tab-active" : undefined}
              onClick={() => setTab("overview")}
            >
              Overview
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "inspectors"}
              className={tab === "inspectors" ? "od-network-tab-active" : undefined}
              onClick={() => setTab("inspectors")}
            >
              Inspectors
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "timeline"}
              className={tab === "timeline" ? "od-network-tab-active" : undefined}
              onClick={() => setTab("timeline")}
            >
              Timeline
            </button>
          </div>
          <div className="od-network-detail-body">
            {tab === "overview" && selected && (
              <table className="od-network-kv">
                <tbody>
                  <tr>
                    <th scope="row">URL</th>
                    <td>{fullUrl(selected)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Method</th>
                    <td>{selected.method}</td>
                  </tr>
                  <tr>
                    <th scope="row">Source</th>
                    <td>{selected.source ?? "—"}</td>
                  </tr>
                  <tr>
                    <th scope="row">TLS tunnel</th>
                    <td>{selected.tlsTunnel === true ? "yes (CONNECT, no MITM)" : "no"}</td>
                  </tr>
                  <tr>
                    <th scope="row">Status</th>
                    <td>{selected.status || "—"}</td>
                  </tr>
                  <tr>
                    <th scope="row">Duration</th>
                    <td>
                      {selected.durationMs !== undefined ? `${Math.round(selected.durationMs)} ms` : "—"}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Host</th>
                    <td>{selected.host}</td>
                  </tr>
                  <tr>
                    <th scope="row">Type</th>
                    <td>{selected.type}</td>
                  </tr>
                </tbody>
              </table>
            )}
            {tab === "overview" && !selected && (
              <p className="od-network-placeholder">无选中请求（可调整过滤条件）。</p>
            )}
            {tab === "inspectors" && (
              <p className="od-network-placeholder">Inspectors：即将推出（Core 当前不采集 body）。</p>
            )}
            {tab === "timeline" && (
              <p className="od-network-placeholder">Timeline：即将推出。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
