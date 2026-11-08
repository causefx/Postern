#!/bin/sh
set -eu

mkdir -p /data

# Named/bind volumes are often root-owned. Fix ownership when we start as root,
# then drop to the unprivileged postern user for the rest of the process lifetime.
if [ "$(id -u)" = "0" ]; then
  chown -R postern:postern /data
  exec su-exec postern:postern /postern "$@"
fi

exec /postern "$@"
