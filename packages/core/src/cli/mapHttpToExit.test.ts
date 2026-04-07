import { describe, expect, it } from "vitest";
import { EX_CONFIG, EX_NOINPUT, EX_NOPERM, EX_UNAVAILABLE } from "./exitCodes.js";
import { exitCodeForFetchError, exitCodeForHttpStatus } from "./mapHttpToExit.js";

describe("exitCodeForHttpStatus", () => {
  it("maps 401/403 to EX_NOPERM", () => {
    expect(exitCodeForHttpStatus(401)).toBe(EX_NOPERM);
    expect(exitCodeForHttpStatus(403)).toBe(EX_NOPERM);
  });

  it("maps 404 to EX_NOINPUT", () => {
    expect(exitCodeForHttpStatus(404)).toBe(EX_NOINPUT);
  });

  it("maps 503 to EX_UNAVAILABLE", () => {
    expect(exitCodeForHttpStatus(503)).toBe(EX_UNAVAILABLE);
  });
});

describe("exitCodeForFetchError", () => {
  it("maps ENOENT to EX_CONFIG", () => {
    expect(exitCodeForFetchError(Object.assign(new Error("e"), { code: "ENOENT" }))).toBe(EX_CONFIG);
  });
});
