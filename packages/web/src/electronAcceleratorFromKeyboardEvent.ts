/**
 * 将页面上的 `keydown` 转为 Electron `globalShortcut.register` 可用的 accelerator 字符串。
 * 依赖物理键 `code`，减少输入法/大写状态对组合键的干扰。
 *
 * @see https://www.electronjs.org/docs/latest/api/accelerator
 */

/**
 * 在浏览器中判断是否为 macOS（Electron 与 Safari 均可用）。
 * 用于组合键中 `metaKey` → `Command`、非 Mac 上 `metaKey` → `Super`。
 */
export function isElectronRendererMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPod|iPhone|iPad/i.test(navigator.userAgent);
}

/**
 * @returns accelerator 字符串；无法识别或不允许的按键返回 `null`。
 */
export function electronAcceleratorFromKeyboardEvent(e: KeyboardEvent): string | null {
  if (e.type !== "keydown") return null;
  if (e.repeat) return null;

  const code = e.code;
  if (!code) return null;

  const keyToken = domCodeToElectronKey(code);
  if (keyToken === null) return null;

  const isMac = isElectronRendererMac();
  const modifierOnlyKeys = new Set(["MetaLeft", "MetaRight", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "OSLeft", "OSRight"]);
  if (modifierOnlyKeys.has(code)) return null;

  const hasMetaOrCtrlOrAlt = e.metaKey || e.ctrlKey || e.altKey;
  const isFnKey = /^F([1-9]|1[0-9]|2[0-4])$/i.test(keyToken);
  if (!hasMetaOrCtrlOrAlt && !isFnKey) {
    return null;
  }

  const parts: string[] = [];
  if (isMac) {
    if (e.metaKey) parts.push("Command");
    if (e.ctrlKey) parts.push("Control");
  } else {
    if (e.metaKey) parts.push("Super");
    if (e.ctrlKey) parts.push("Control");
  }
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(keyToken);
  return parts.join("+");
}

/**
 * 将 `KeyboardEvent.code`（物理键）映射为 Electron accelerator 的**主键**段（不含 Command/Shift 等修饰键）。
 * 无法映射时返回 `null`。
 */
export function domCodeToElectronKey(code: string): string | null {
  if (code.startsWith("Digit")) {
    const d = code.slice(5);
    if (/^[0-9]$/.test(d)) return d;
    return null;
  }
  if (code.startsWith("Key")) {
    const k = code.slice(3);
    if (/^[A-Z]$/i.test(k)) return k.toUpperCase();
    return null;
  }
  if (code.startsWith("Numpad")) {
    const rest = code.slice(6);
    if (/^[0-9]$/.test(rest)) return `num${rest}`;
    const numpadMap: Record<string, string> = {
      Add: "numadd",
      Subtract: "numsub",
      Multiply: "nummult",
      Divide: "numdiv",
      Decimal: "numdec",
      Enter: "Return",
    };
    return numpadMap[rest] ?? null;
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(code)) {
    return code.toUpperCase();
  }

  const map: Record<string, string> = {
    Space: "Space",
    Tab: "Tab",
    Enter: "Return",
    Escape: "Escape",
    Backspace: "Backspace",
    Delete: "Delete",
    Insert: "Insert",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Minus: "Minus",
    Equal: "Equal",
    BracketLeft: "BracketLeft",
    BracketRight: "BracketRight",
    Backslash: "Backslash",
    Semicolon: "Semicolon",
    Quote: "Quote",
    Backquote: "Backquote",
    Comma: "Comma",
    Period: "Period",
    Slash: "Slash",
    IntlBackslash: "Backslash",
  };
  return map[code] ?? null;
}
