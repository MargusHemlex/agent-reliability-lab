import { eveChannel } from "eve/channels/eve";
import { verifyHttpBasic } from "eve/channels/auth";

export default eveChannel({
  auth: (request) => {
    const secret = process.env.ARL_SPIKE_SECRET;
    if (process.env.ARL_SPIKE_TEST !== "1" || !secret) return null;
    const url = new URL(request.url);
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return null;
    if (request.headers.has("origin")) return null; // CLI-only spike: no browser mutation surface.
    const verified = verifyHttpBasic(request.headers.get("authorization"), {
      username: "spike",
      password: secret,
    });
    return verified.ok ? verified.sessionAuth : null;
  },
});
