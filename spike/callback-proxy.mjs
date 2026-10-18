import http from "node:http";
import { createHash, randomUUID } from "node:crypto";

const LIMIT = 256 * 1024;
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function readBounded(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > LIMIT) throw new Error("Callback body exceeds 256 KiB");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** Test-only loopback transport observer; records contain sensitive headers in memory. */
export async function createCallbackProxy(targetURL) {
  const target = new URL(targetURL);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
  ) {
    throw new Error("Callback proxy target must use loopback HTTP");
  }
  const records = [];
  const sockets = new Set();
  const requests = new Set();
  let closing = false;

  function forward(path, headers, rawBody) {
    return new Promise((resolve, reject) => {
      if (closing) return reject(new Error("Callback proxy is closed"));
      const clean = {
        ...headers,
        host: target.host,
        "content-length": String(rawBody.length),
      };
      delete clean["transfer-encoding"];
      delete clean["x-arl-test"];
      const request = http.request(
        new URL(path, target),
        { method: "POST", headers: clean },
        async (response) => {
          try {
            const bytes = await readBounded(response);
            resolve({
              status: response.statusCode ?? 502,
              body: bytes.toString("utf8"),
            });
          } catch (error) {
            response.destroy();
            reject(error);
          }
        },
      );
      requests.add(request);
      request.once("close", () => requests.delete(request));
      request.once("error", reject);
      request.end(rawBody);
    });
  }

  const server = http.createServer(async (request, response) => {
    try {
      if (
        request.method !== "POST" ||
        request.url !== "/.well-known/workflow/v1/flow"
      ) {
        response.writeHead(404).end();
        return;
      }
      const rawBody = await readBounded(request);
      const headers = { ...request.headers };
      let parsed;
      try {
        parsed = JSON.parse(rawBody.toString("utf8"));
      } catch {
        parsed = null;
      }
      const record = {
        path: request.url,
        rawBody,
        headers,
        parsed,
        atNs: process.hrtime.bigint(),
        injected: false,
      };
      records.push(record);
      // Do not cancel upstream when the client disconnects: transport failure may
      // leave a live handler, which is precisely the overlap under examination.
      const result = await forward(record.path, headers, rawBody);
      record.response = result;
      if (!response.destroyed)
        response
          .writeHead(result.status, { "content-type": "application/json" })
          .end(result.body);
    } catch (error) {
      if (!response.destroyed)
        response
          .writeHead(502, { "content-type": "application/json" })
          .end(JSON.stringify({ error: String(error) }));
    }
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;

  return {
    url,
    records,
    duplicate(record, { freshMessageId = false } = {}) {
      if (!records.includes(record))
        throw new Error("Unknown captured callback");
      if (!record.parsed?.runId)
        throw new Error("Captured callback has no runId");
      const headers = { ...record.headers };
      headers["x-vqs-message-attempt"] = String(
        Number(headers["x-vqs-message-attempt"] ?? 1) + 1,
      );
      let rawBody = record.rawBody;
      if (freshMessageId) {
        headers["x-vqs-message-id"] = `msg_${randomUUID().replaceAll("-", "")}`;
        headers["x-vqs-message-attempt"] = "1";
        rawBody = Buffer.from(JSON.stringify({ runId: record.parsed.runId }));
      }
      const injected = {
        path: record.path,
        rawBody,
        headers,
        parsed: JSON.parse(rawBody.toString("utf8")),
        atNs: process.hrtime.bigint(),
        injected: true,
      };
      records.push(injected);
      return forward(injected.path, headers, rawBody).then((result) => {
        injected.response = result;
        return result;
      });
    },
    summary() {
      return records.map((record) => ({
        path: record.path,
        bodySha256: digest(record.rawBody),
        queueIdSha256: digest(String(record.headers["x-vqs-queue-name"] ?? "")),
        messageIdSha256: digest(
          String(record.headers["x-vqs-message-id"] ?? ""),
        ),
        attempt: Number(record.headers["x-vqs-message-attempt"] ?? 0),
        injected: record.injected,
        ...(record.response ? { status: record.response.status } : {}),
      }));
    },
    async close() {
      closing = true;
      const closed = new Promise((resolve) => server.close(resolve));
      for (const request of requests)
        request.destroy(new Error("Test callback proxy closed"));
      for (const socket of sockets) socket.destroy();
      await closed;
    },
  };
}
