import { describe, expect, it } from "vitest";
import { pickLatestActiveSessionForApp } from "./sessionResolve.js";

describe("pickLatestActiveSessionForApp", () => {
  const profiles = [
    { id: "p1", appId: "app-a" },
    { id: "p2", appId: "app-b" },
  ];

  it("returns null when no profile for app", () => {
    expect(pickLatestActiveSessionForApp([], [{ id: "p1", appId: "other" }], "app-a")).toBeNull();
  });

  it("returns null when only stopped sessions", () => {
    const sessions = [
      {
        id: "s1",
        profileId: "p1",
        state: "killed" as const,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    expect(pickLatestActiveSessionForApp(sessions, profiles, "app-a")).toBeNull();
  });

  it("picks latest createdAt among active sessions", () => {
    const sessions = [
      {
        id: "old",
        profileId: "p1",
        state: "running" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "new",
        profileId: "p1",
        state: "running" as const,
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    ];
    expect(pickLatestActiveSessionForApp(sessions, profiles, "app-a")?.id).toBe("new");
  });

  it("ignores sessions for other apps", () => {
    const sessions = [
      {
        id: "b1",
        profileId: "p2",
        state: "running" as const,
        createdAt: "2026-01-09T00:00:00.000Z",
      },
      {
        id: "a1",
        profileId: "p1",
        state: "running" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(pickLatestActiveSessionForApp(sessions, profiles, "app-a")?.id).toBe("a1");
  });
});
