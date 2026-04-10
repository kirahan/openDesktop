import type { NetworkRequestRow } from "./types.js";

/** 开发与 UI 验收用 mock，不依赖 Core。 */
export const mockNetworkRows: NetworkRequestRow[] = [
  {
    id: "m1",
    status: 200,
    method: "GET",
    host: "api.example.com",
    url: "/v1/users/me",
    type: "fetch",
  },
  {
    id: "m2",
    status: 304,
    method: "GET",
    host: "cdn.example.com",
    url: "/assets/app.js",
    type: "script",
  },
  {
    id: "m3",
    status: 201,
    method: "POST",
    host: "api.example.com",
    url: "/v1/items",
    type: "xhr",
  },
  {
    id: "m4",
    status: 404,
    method: "GET",
    host: "legacy.internal",
    url: "/old/ping",
    type: "document",
  },
  {
    id: "m5",
    status: 500,
    method: "PUT",
    host: "api.example.com",
    url: "/v1/settings",
    type: "fetch",
  },
  {
    id: "m6",
    status: 204,
    method: "DELETE",
    host: "api.example.com",
    url: "/v1/items/42",
    type: "xhr",
  },
];
