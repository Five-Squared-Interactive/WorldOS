# WorldOS Server with ROS2 Bridge Plugin
#
# Build context: parent directory (WorldOS workspace root)
#   docker build -f ros2-test/Dockerfile -t worldos-ros2 .
#
# Or via docker compose:
#   cd ros2-test && docker compose up --build

FROM node:20-bookworm-slim AS build

# Match the host npm version so the lockfile is compatible
RUN npm install -g npm@11

# Native module build tools (better-sqlite3, bcrypt)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/worldos

# --- Dependency cache layer ---
# Copy workspace root manifest (skip lockfile — it references file: deps
# outside the build context; npm will generate a fresh one)
COPY package.json ./

# Copy every package's manifest so `npm install` resolves the workspace
COPY packages/wos-plugin-sdk/package.json         packages/wos-plugin-sdk/
COPY packages/wos-server/package.json              packages/wos-server/
COPY packages/wos-admin/package.json               packages/wos-admin/
COPY packages/wos-cli/package.json                 packages/wos-cli/
COPY packages/wos-protocol/package.json            packages/wos-protocol/
COPY packages/wos-world/package.json               packages/wos-world/
COPY packages/wos-plugin-identity/package.json     packages/wos-plugin-identity/
COPY packages/wos-plugin-messaging/package.json    packages/wos-plugin-messaging/
COPY packages/wos-plugin-world-manager/package.json packages/wos-plugin-world-manager/
COPY packages/wos-plugin-presence/package.json     packages/wos-plugin-presence/
COPY packages/wos-plugin-asset-manager/package.json packages/wos-plugin-asset-manager/
COPY packages/wos-plugin-container-manager/package.json packages/wos-plugin-container-manager/
COPY packages/wos-plugin-ros2-bridge/package.json  packages/wos-plugin-ros2-bridge/
# wos-plugin-sync-manager depends on file:../../WorldOS/WorldSync (outside
# build context) — skip it.  wos-plugin-sdk-python is Python-only (no
# package.json).  Create stubs for both so the workspace glob resolves
# without pulling in external file: dependencies.
RUN mkdir -p packages/wos-plugin-sdk-python \
    && echo '{"name":"@worldos/plugin-sdk-python","version":"0.0.0","private":true}' \
       > packages/wos-plugin-sdk-python/package.json \
    && mkdir -p packages/wos-plugin-sync-manager \
    && echo '{"name":"@worldos/plugin-sync-manager","version":"0.0.0","private":true}' \
       > packages/wos-plugin-sync-manager/package.json

RUN npm install

# --- Build layer ---
COPY packages/ packages/
RUN npm run build && npm run build --workspace=@worldos/plugin-ros2-bridge

# ============================================================
# Runtime image — only mosquitto, no build tools
# ============================================================
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    mosquitto \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/worldos
COPY --from=build /opt/worldos /opt/worldos

# Make the `wos` CLI available on PATH
RUN npm link --workspace=@worldos/cli 2>/dev/null || true

# --- Server directory ---
# The ros2-bridge plugin (with auto-start block) lives in the workspace at
# packages/wos-plugin-ros2-bridge.  We symlink it into the server's plugins/
# directory so the plugin loader discovers it.  The workspace's node_modules
# already satisfy its dependencies — no separate npm install needed.
RUN mkdir -p /srv/ros2-test/plugins \
    && ln -s /opt/worldos/packages/wos-plugin-ros2-bridge /srv/ros2-test/plugins/ros2-bridge

# Copy server config and plugin connection config.
# These are overwritten at runtime if you bind-mount replacements.
COPY ros2-test/wos.docker.yaml    /srv/ros2-test/wos.yaml
COPY ros2-test/ros2-bridge.docker.json \
     /opt/worldos/packages/wos-plugin-ros2-bridge/ros2-bridge.json

WORKDIR /srv/ros2-test

# MQTT broker + admin panel
EXPOSE 1883 3000

CMD ["wos", "start", ".", "--foreground"]
