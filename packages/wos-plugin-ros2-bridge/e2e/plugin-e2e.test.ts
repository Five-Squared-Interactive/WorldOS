// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * E2E Test: ROS2 Bridge Plugin
 *
 * TODO: Implement full E2E tests that:
 * 1. Start wos-server with plugin loader
 * 2. Load ros2-bridge plugin with config pointing to a mock rosbridge
 * 3. Verify plugin status is "running"
 * 4. Publish to rosbridge /joint_states -> verify MQTT wos/ros2/test/joint_states
 * 5. Publish to MQTT wos/ros2/test/publish/cmd -> verify rosbridge receives
 * 6. Service call round-trip via MQTT request/response
 *
 * Requires infrastructure (MQTT broker, wos-server).
 * Run with: ENABLE_E2E=true npx vitest run e2e/
 *
 * Integration tests in tests/integration/ cover the message flow end-to-end
 * using mock MQTT and mock rosbridge, so core functionality is well-tested.
 */

import { describe, it } from 'vitest';

describe.skip('E2E: ROS2 Bridge Plugin (not yet implemented)', () => {
  it.todo('loads plugin via wos-server and reports running status');
  it.todo('bridges rosbridge /joint_states to MQTT end-to-end');
  it.todo('bridges MQTT publish to rosbridge end-to-end');
  it.todo('completes service call round-trip');
});
