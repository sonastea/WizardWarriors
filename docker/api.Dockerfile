# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS builder

ARG DATABASE_URL
ARG REDIS_URL
ENV DATABASE_URL=$DATABASE_URL
ENV REDIS_URL=$REDIS_URL

RUN mkdir /opt/ww
WORKDIR /opt/ww

RUN apk add --no-cache git=2.52.0-r0 build-base=0.5-r3 && \
  go install github.com/pressly/goose/v3/cmd/goose@v3.26.0

COPY go.mod .
COPY go.sum .
RUN go mod download

COPY . .

WORKDIR /opt/ww/cmd/ww-srv

RUN go build -o ww-srv

FROM alpine:3.23

ARG DATABASE_URL
ARG REDIS_URL
ENV DATABASE_URL=$DATABASE_URL
ENV REDIS_URL=$REDIS_URL

RUN mkdir /opt/ww && apk add --no-cache curl=8.17.0-r1
WORKDIR /opt/ww

COPY --from=builder /go/bin/goose /usr/local/bin/goose
COPY --from=builder /opt/ww/cmd/ww-srv/ww-srv /opt/ww/ww-srv
COPY --from=builder /opt/ww/migrations /opt/ww/migrations

EXPOSE 8081

ENTRYPOINT ["sh", "-c", "goose postgres $DATABASE_URL up -dir migrations && ./ww-srv -DATABASE_URL=$DATABASE_URL -REDIS_URL=$REDIS_URL"]
