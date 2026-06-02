# ROS2 Bridge — Docker Setup Guide

Run both WorldOS and ROS2/rosbridge in Docker containers. No local Node.js, Mosquitto, or ROS2 installation required — just Docker.

## Prerequisites

- **Docker** (with Docker Compose v2)

## Architecture

```
Docker network: ros2-test_default
┌──────────────────────────┐     ┌──────────────────────────────────────┐
│  ros2 container          │     │  worldos container                   │
│                          │     │                                      │
│  ROS Humble              │     │  Embedded Mosquitto (port 1883)      │
│  rosbridge_server  ◄─────┼─ WS─┼── wos-plugin-ros2-bridge            │
│  (port 9090)             │     │          │                           │
│                          │     │          ▼ MQTT                      │
│  ROS2 topics:            │     │  wos/ros2/arm-1/joint_states         │
│   /joint_states          │     │  wos/ros2/arm-1/cmd_vel              │
│   /cmd_vel               │     │                                      │
│                          │     │  Admin panel (port 3000)             │
└──────────────────────────┘     └──────────────────────────────────────┘
      ▲ :9090 (optional)              ▲ :1883         ▲ :3000
      │                               │               │
      └───────── Host ─────────────────┘───────────────┘
```

## Quick Start

From the `ros2-test/` directory:

```bash
cd WorldHub/MyWorldsServer/src/WorldOS/ros2-test
docker compose up --build
```

First run takes several minutes:
1. The `ros2` container installs `ros-humble-rosbridge-server` via apt (~500 MB)
2. The `worldos` container installs npm dependencies and builds all WorldOS packages

The `worldos` container waits for rosbridge to be healthy before starting. You'll see output like:

```
ros2-1     | [INFO] [rosbridge_websocket]: Rosbridge WebSocket server started on port 9090
worldos-1  | [server] Starting WorldOS server in foreground mode...
worldos-1  | [ros2-bridge] Started (PID: ...)
worldos-1  | [server] Server started successfully.
```

Press **Ctrl+C** to stop both containers.

## Verify the Pipeline

### ROS2 → MQTT

Subscribe to all bridged messages from the host:

```bash
mosquitto_sub -h localhost -p 1883 -t "wos/ros2/#" -v
```

In another terminal, publish a JointState from inside the ROS2 container:

```bash
docker compose exec ros2 bash -c "
  source /opt/ros/humble/setup.bash &&
  ros2 topic pub /joint_states sensor_msgs/msg/JointState '{
    header: {stamp: {sec: 0, nanosec: 0}, frame_id: \"base\"},
    name: [\"joint1\", \"joint2\", \"joint3\"],
    position: [0.1, 0.2, 0.3],
    velocity: [],
    effort: []
  }' --once
"
```

You should see:

```
wos/ros2/arm-1/joint_states {"header":{"stamp":{"sec":0,"nanosec":0},...}
```

### MQTT → ROS2

Listen on the ROS2 side:

```bash
docker compose exec ros2 bash -c "
  source /opt/ros/humble/setup.bash &&
  ros2 topic echo /cmd_vel
"
```

In another terminal, publish a Twist command via MQTT:

```bash
mosquitto_pub -h localhost -p 1883 \
  -t "wos/ros2/arm-1/publish/cmd_vel" \
  -m '{"linear":{"x":1.0,"y":0.0,"z":0.0},"angular":{"x":0.0,"y":0.0,"z":0.5}}'
```

The message should appear in the `ros2 topic echo` output.

### Admin Panel

Open **http://localhost:3000** in a browser. The ROS2 Bridge panel shows connected robots, topic flow, and service call stats.

## Working Inside the ROS2 Container

Open an interactive shell:

```bash
docker compose exec ros2 bash
source /opt/ros/humble/setup.bash
```

Then use standard ROS2 commands:

```bash
ros2 topic list
ros2 topic echo /joint_states
ros2 topic pub /cmd_vel geometry_msgs/msg/Twist '...' --once
```

## Configuration

### Adding Topics

Edit `ros2-bridge.docker.json` to add topics or robots:

```json
{
  "connections": {
    "arm-1": {
      "url": "ws://ros2:9090",
      "topics": [
        { "name": "/joint_states", "type": "sensor_msgs/JointState" },
        { "name": "/cmd_vel", "type": "geometry_msgs/Twist" },
        { "name": "/odom", "type": "nav_msgs/Odometry" }
      ],
      "services": ["/get_parameters"]
    }
  }
}
```

Then rebuild:

```bash
docker compose up --build
```

### Multiple Robots

Add more entries to the `connections` object, each pointing to a different rosbridge URL. You can add additional ROS2 containers in `docker-compose.yml`:

```yaml
services:
  robot-a:
    image: ros:humble-ros-base
    command: ...
  robot-b:
    image: ros:humble-ros-base
    command: ...
  worldos:
    build: ...
```

And reference them by service name in `ros2-bridge.docker.json`:

```json
{
  "connections": {
    "robot-a": { "url": "ws://robot-a:9090", ... },
    "robot-b": { "url": "ws://robot-b:9090", ... }
  }
}
```

## Running Detached

```bash
docker compose up --build -d
docker compose logs -f            # stream logs
docker compose logs -f worldos    # just the WorldOS container
docker compose down               # stop and remove containers
```

## Exposed Ports

| Port | Service | Purpose |
|------|---------|---------|
| 1883 | worldos | MQTT broker — subscribe from the host with `mosquitto_sub` or any MQTT client |
| 3000 | worldos | Admin panel web UI |
| 9090 | ros2 | rosbridge WebSocket — for direct debugging (not required for normal operation) |

## Build Notes

The Dockerfile handles two workspace quirks automatically:

1. **npm version mismatch.** The host lockfile is generated with npm 11, but the Node 20 Docker image ships with npm 10. The Dockerfile upgrades npm to v11 in the build stage to avoid `Cannot read properties of undefined (reading 'extraneous')` errors.

2. **External `file:` dependencies.** `wos-plugin-sync-manager` depends on `@fivesquaredinteractive/worldsync` via a `file:` path outside the build context, and `wos-plugin-sdk-python` is a Python package with no `package.json`. The Dockerfile creates stub `package.json` files for both so the workspace glob resolves cleanly. The host `package-lock.json` is intentionally excluded — npm generates a fresh lockfile during the Docker build.

3. **ros2-bridge not in default build script.** The root `npm run build` only builds core packages and standard plugins. The Dockerfile adds an explicit `npm run build --workspace=@worldos/plugin-ros2-bridge` step.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `worldos` exits immediately | Check logs: `docker compose logs worldos`. The most common cause is rosbridge not being ready — the healthcheck should prevent this, but if the apt install takes very long, increase `start_period` in `docker-compose.yml`. |
| `mosquitto_sub` shows nothing | Verify the plugin is connected: check the WorldOS logs for `Robot arm-1 connected`. Also verify `mosquitto_sub` is using `-h localhost -p 1883`. |
| First build is slow | The `ros2` container installs rosbridge via apt on every fresh start. To avoid this, commit the container after the first run: `docker commit ros2-test-ros2-1 ros2-rosbridge:cached` and update the `image:` in `docker-compose.yml`. |
| Port conflict on 1883 | A local Mosquitto may be running. Stop it (`net stop mosquitto` on Windows, `sudo systemctl stop mosquitto` on Linux) or change the host port in `docker-compose.yml`: `"11883:1883"`. |
| Port conflict on 9090 | Another rosbridge or service is using the port. Change the host mapping: `"9091:9090"`. The internal container networking is unaffected. |
| `Cannot connect to rosbridge` in WorldOS logs | The `ros2` container's rosbridge isn't ready. Check `docker compose logs ros2`. The `worldos` container depends on the healthcheck, but the plugin also retries with exponential backoff (up to 20 attempts). |
| Changes to `ros2-bridge.docker.json` not applied | The config is baked into the image at build time. Run `docker compose up --build` to rebuild. |
| Need to inspect MQTT traffic | From the host: `mosquitto_sub -h localhost -p 1883 -t "#" -v` to see all topics. Or exec into the worldos container: `docker compose exec worldos mosquitto_sub -h localhost -t "#" -v`. |
| `npm error Cannot read properties of undefined (reading 'extraneous')` | npm version mismatch between host and Docker image. The Dockerfile already handles this — if you see this error, ensure the `RUN npm install -g npm@11` line is present in the build stage. |
| `npm error Missing target in lock file` | A workspace package has a `file:` dependency outside the build context. The Dockerfile stubs these out — ensure the stub `RUN mkdir -p ...` block is present and covers all affected packages. |
