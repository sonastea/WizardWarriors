FROM oven/bun:1 AS deps
WORKDIR /opt/ww-ui

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-$NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL:-$NEXT_PUBLIC_WS_URL}

COPY ./ww-ui/package.json ./ww-ui/bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1 AS builder
WORKDIR /opt/ww-ui

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-$NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL:-$NEXT_PUBLIC_WS_URL}

COPY --from=deps /opt/ww-ui/node_modules ./node_modules
COPY ./common /opt/common
RUN ln -s /opt/ww-ui/node_modules /opt/common/node_modules
COPY ./ww-ui .
RUN bun run build

FROM oven/bun:1 AS runner
WORKDIR /opt/ww-ui

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-$NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL:-$NEXT_PUBLIC_WS_URL}
ENV NODE_ENV=production

COPY --from=builder /opt/ww-ui/.next/standalone/ standalone
COPY --from=builder /opt/ww-ui/.next/static standalone/ww-ui/.next/static
COPY --from=builder /opt/ww-ui/public standalone/ww-ui/public

USER bun

EXPOSE 3000
ENV PORT=3000

CMD ["bun", "standalone/ww-ui/server.js"]
