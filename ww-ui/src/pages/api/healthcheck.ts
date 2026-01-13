import type { NextApiRequest, NextApiResponse } from "next";

type HealthcheckResponse = "ok";

type ErrorResponse = {
  error: string;
};

const RATE_LIMIT = 4;
const RATE_WINDOW_MS = 60_000;

const rateLimitStore = (() => {
  const globalWithStore = globalThis as typeof globalThis & {
    __healthcheckRateLimit?: Map<string, number[]>;
  };
  if (!globalWithStore.__healthcheckRateLimit) {
    globalWithStore.__healthcheckRateLimit = new Map<string, number[]>();
  }
  return globalWithStore.__healthcheckRateLimit;
})();

const getClientIp = (req: NextApiRequest) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor;
  return (
    forwardedIp?.split(",")[0].trim() ?? req.socket.remoteAddress ?? "unknown"
  );
};

const isLocalhost = (ip: string) =>
  ip === "127.0.0.1" ||
  ip === "::1" ||
  ip === "::ffff:127.0.0.1" ||
  ip === "::ffff:7f00:1" ||
  ip === "172.17.0.1";

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthcheckResponse | ErrorResponse>
) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", ["GET", "HEAD"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const clientIp = getClientIp(req);
  console.log(clientIp);
  if (!isLocalhost(clientIp)) {
    const now = Date.now();
    const recentRequests = (rateLimitStore.get(clientIp) ?? []).filter(
      (timestamp) => now - timestamp < RATE_WINDOW_MS
    );

    if (recentRequests.length >= RATE_LIMIT) {
      const retryAfterSeconds = Math.ceil(
        (RATE_WINDOW_MS - (now - recentRequests[0])) / 1000
      );
      res.setHeader("Retry-After", retryAfterSeconds.toString());
      return res.status(429).json({ error: "Too Many Requests" });
    }

    recentRequests.push(now);
    rateLimitStore.set(clientIp, recentRequests);
  }

  return res.status(200).send("ok");
}
