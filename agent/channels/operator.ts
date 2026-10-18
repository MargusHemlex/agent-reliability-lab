import { defineChannel, GET, POST } from "eve/channels";
import { config } from "../lib/lab/runtime.ts";
import { createOperatorHandler } from "../lib/lab/operator-ui.ts";

const origin = () =>
  `http://127.0.0.1:${process.env.NITRO_PORT ?? process.env.PORT ?? "4318"}`;
const handler = createOperatorHandler({
  mode: () => config().mode,
  secret: () => config().operatorSecret,
  origin,
  proxy: (path, method, body) =>
    fetch(origin() + path, {
      method,
      headers: {
        authorization: `Bearer ${config().operatorSecret}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    }),
});
export default defineChannel({
  routes: [
    GET("/operator", handler),
    GET("/operator/session", handler),
    POST("/operator/login", handler),
    POST("/operator/logout", handler),
    GET("/operator/api/runs", handler),
    GET("/operator/api/runs/:runId", handler),
    POST("/operator/api/runs", handler),
    POST("/operator/api/runs/:runId/approve", handler),
    POST("/operator/api/runs/:runId/reject", handler),
    POST("/operator/api/runs/:runId/cancel", handler),
    POST("/operator/api/runs/:runId/resume", handler),
    POST("/operator/api/namespaces/reset", handler),
  ],
});
