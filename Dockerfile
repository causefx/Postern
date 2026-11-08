# syntax=docker/dockerfile:1

# --- CSS (Tailwind + daisyUI) ---
FROM node:22-alpine AS css
WORKDIR /src
COPY package.json ./
# Drop Windows-only native deps so npm installs the Linux packages instead.
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));\
for (const k of Object.keys(p.devDependencies||{})) if (/win32|darwin|linux-arm/.test(k)) delete p.devDependencies[k];\
fs.writeFileSync('package.json', JSON.stringify(p,null,2));" \
 && npm install
COPY static ./static
RUN npm run build:css

# --- Go binary ---
FROM golang:1.22-alpine AS build
ARG VERSION=0.1.0
WORKDIR /src
COPY go.mod ./
COPY *.go ./
# Take JS/HTML/fonts from this build's context (not a possibly-stale css-stage cache),
# then overlay only the freshly built stylesheet.
COPY static ./static
COPY --from=css /src/static/app.css ./static/app.css
# Fail the build if open-paths UI is missing from the embed tree.
RUN test -f static/js/components/form/OpenPathsEditor.js \
 && grep -q "Open paths (optional)" static/js/components/form/ServiceFormModal.js
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath \
      -ldflags="-s -w -X main.Version=${VERSION}" \
      -o /out/postern .

# --- Runtime ---
# Alpine (not distroless) so an entrypoint can chown mounted /data, then drop privileges.
FROM alpine:3.21
RUN apk add --no-cache ca-certificates tzdata su-exec \
 && adduser -D -H -u 65532 postern \
 && mkdir -p /data \
 && chown postern:postern /data

COPY --from=build /out/postern /postern
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENV LISTEN=:8080 \
    POSTERN_DATA=/data/postern-data.json

EXPOSE 8080
VOLUME ["/data"]
# Start as root so the entrypoint can fix volume ownership, then su-exec to postern.
ENTRYPOINT ["/docker-entrypoint.sh"]
