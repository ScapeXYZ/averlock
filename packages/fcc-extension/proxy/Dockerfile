# Self-contained build of tee-proxy. Clones tee-proxy from GitHub at build time
# so no local sibling repos are needed.
#
# TEE_PROXY_VERSION MUST stay aligned with the extension's Go-module pins.
# This immutable pseudo-version resolves to the current develop head supplied
# for the July 2026 Coston2 FCC stack. tee-proxy's own go.mod transitively pins
# the matching tee-node and go-flare-common line, so building it with
# `go mod download` pulls the exact governance-aware node code the extension-tee
# image uses — no separate tee-node clone or replace directive is needed.
# Override via build arg when bumping both sides together.

ARG TEE_PROXY_VERSION=v0.0.21-0.20260729123751-0c6d016b0994

# NOTE: not pinned by digest (unlike the main Dockerfile) — this is a dev convenience build.
# For full reproducibility, pin by digest: golang:1.25.1-alpine@sha256:...
FROM golang:1.25.8-alpine AS builder

RUN apk add --no-cache git patch

ARG TEE_PROXY_VERSION

WORKDIR /app
RUN git clone --filter=blob:none https://github.com/flare-foundation/tee-proxy.git && \
    cd tee-proxy && \
    TEE_PROXY_REF="${TEE_PROXY_VERSION##*-}" && \
    git checkout "${TEE_PROXY_REF}"

WORKDIR /app/tee-proxy
COPY patches/keystore.patch /tmp/keystore.patch
COPY keystore/keystore.go keystore/keystore_test.go ./pkg/config/
RUN patch -p1 < /tmp/keystore.patch && go mod tidy
RUN go mod download
RUN go test ./pkg/config
RUN CGO_ENABLED=0 GOOS=linux go build -a -o main ./cmd/proxy

# Final stage
FROM alpine:3.21

WORKDIR /app

COPY --from=builder /app/tee-proxy/main .
RUN mkdir -p ./config
COPY entrypoint.sh /app/entrypoint.sh

RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 6661
EXPOSE 6662

ENTRYPOINT ["/app/entrypoint.sh"]
