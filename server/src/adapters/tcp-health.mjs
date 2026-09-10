import net from "node:net";

export function probeTcp({ host, port, timeoutMs = 1500 }) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok, error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        ok,
        host,
        port,
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false, new Error("connection timed out")));
    socket.once("error", (error) => finish(false, error));
  });
}
