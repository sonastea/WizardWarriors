# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS builder

RUN mkdir /opt/ww
WORKDIR /opt/ww

RUN apk add --no-cache git=2.52.0-r0 build-base=0.5-r3

COPY go.mod .
COPY go.sum .
RUN go mod download

COPY . .

WORKDIR /opt/ww/cmd/ww-game

RUN go build -o ww-game

FROM alpine:3.23

RUN mkdir /opt/ww && apk add --no-cache curl=8.17.0-r1
WORKDIR /opt/ww

COPY --from=builder /opt/ww/cmd/ww-game/ww-game /opt/ww/ww-game
COPY --from=builder /opt/ww/pkg/hub/assets /opt/ww/pkg/hub/assets

EXPOSE 8085

ENTRYPOINT ["./ww-game", "-ADDR=:8085"]
