import { describe, expect, it } from "vitest";
import { filterNetworkRows } from "./filterRows.js";
import { mockNetworkRows } from "./mockNetworkRows.js";

describe("filterNetworkRows", () => {
  it("returns all rows when query empty", () => {
    expect(filterNetworkRows(mockNetworkRows, "").length).toBe(mockNetworkRows.length);
  });

  it("filters by host substring case-insensitive", () => {
    const r = filterNetworkRows(mockNetworkRows, "API.EXAMPLE");
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((x) => x.host.toLowerCase().includes("api.example"))).toBe(true);
  });

  it("returns empty when no match", () => {
    expect(filterNetworkRows(mockNetworkRows, "zzzz-no-match-zzzz")).toEqual([]);
  });
});
