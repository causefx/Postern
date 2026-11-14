# syntax=docker/dockerfile:1

FROM --platform=$BUILDPLATFORM node:23-alpine AS css
WORKDIR /src
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY web ./web
RUN npm run build:css

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS build
ARG TARGETOS
ARG TARGETARCH
ARG VERSION=dev
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY web ./web
COPY --from=css /src/web/app.css ./web/app.css
RUN test -f web/js/components/drawer/OpenPathsEditor.js \
 && test -f web/js/components/drawer/ServiceDrawer.js \
 && ! test -f web/js/components/form/ServiceFormModal.js
RUN --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath \
      -ldflags="-s -w -X main.Version=${VERSION}" \
      -o /out/postern ./cmd/postern

FROM alpine:3.24
RUN apk add --no-cache ca-certificates tzdata su-exec \
 && adduser -D -H -u 65532 postern \
 && mkdir -p /data \
 && chown postern:postern /data

COPY --from=build /out/postern /postern
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

LABEL org.opencontainers.image.licenses="PolyForm-Shield-1.0.0" \
      org.opencontainers.image.source="https://github.com/causefx/Postern"

ENV LISTEN=:8080 \
    POSTERN_DATA=/data/postern-data.json \
    POSTERN_CONTAINER=1

EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O - http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/docker-entrypoint.sh"]
