export type OutputFormat = "table" | "json";

/** 结构化负载：json 为紧凑单行；table 为缩进 JSON（人类可读） */
export function printStructured(value: unknown, format: OutputFormat, write: (s: string) => void): void {
  if (format === "json") {
    write(`${JSON.stringify(value)}\n`);
    return;
  }
  write(`${JSON.stringify(value, null, 2)}\n`);
}

export interface SessionListRow {
  id: string;
  profileId: string;
  state: string;
  createdAt: string;
}

/** 会话列表：table 为简单列对齐；json 为 { sessions: [...] } */
export function printSessionList(
  sessions: SessionListRow[],
  format: OutputFormat,
  write: (s: string) => void,
): void {
  if (format === "json") {
    printStructured({ sessions }, format, write);
    return;
  }
  if (sessions.length === 0) {
    write("(无会话)\n");
    return;
  }
  const head = "id\tprofileId\tstate\tcreatedAt";
  const lines = [head, ...sessions.map((s) => `${s.id}\t${s.profileId}\t${s.state}\t${s.createdAt}`)];
  write(`${lines.join("\n")}\n`);
}
