/**
 * Poll until CDP HTTP endpoint responds on /json/version or timeout.
 */
export async function waitForCdpReady(port: number, timeoutMs = 15000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`CDP_READY_TIMEOUT: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
