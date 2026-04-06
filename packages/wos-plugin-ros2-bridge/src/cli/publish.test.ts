// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { buildPublishTopic, parsePublishMessage, formatPublishResult } from './publish.js';

describe('CLI publish', () => {
  it('builds correct publish topic', () => {
    expect(buildPublishTopic('arm-1', '/cmd_vel')).toBe('wos/ros2/arm-1/publish/cmd_vel');
    expect(buildPublishTopic('arm-1', 'cmd_vel')).toBe('wos/ros2/arm-1/publish/cmd_vel');
  });

  it('handles multi-segment topics', () => {
    expect(buildPublishTopic('arm-1', '/arm_controller/command'))
      .toBe('wos/ros2/arm-1/publish/arm_controller/command');
  });

  it('parses valid JSON message', () => {
    const result = parsePublishMessage('{"data": [1.0, 2.0]}');
    expect(result).toEqual({ data: [1.0, 2.0] });
  });

  it('throws on invalid JSON', () => {
    expect(() => parsePublishMessage('not json')).toThrow('Invalid JSON');
  });

  it('formats success result', () => {
    expect(formatPublishResult('wos/ros2/arm-1/publish/cmd_vel', true))
      .toContain('Published');
  });

  it('formats failure result', () => {
    expect(formatPublishResult('wos/ros2/arm-1/publish/cmd_vel', false))
      .toContain('Failed');
  });
});
