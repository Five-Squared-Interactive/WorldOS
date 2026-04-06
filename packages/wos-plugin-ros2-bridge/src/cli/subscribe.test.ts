// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

import { describe, it, expect } from 'vitest';
import { buildSubscribeTopic, formatMessage } from './subscribe.js';

describe('CLI subscribe', () => {
  it('builds correct subscribe topic', () => {
    expect(buildSubscribeTopic('arm-1', '/joint_states')).toBe('wos/ros2/arm-1/joint_states');
    expect(buildSubscribeTopic('arm-1', 'joint_states')).toBe('wos/ros2/arm-1/joint_states');
  });

  it('handles multi-segment topics', () => {
    expect(buildSubscribeTopic('arm-1', '/arm_controller/state'))
      .toBe('wos/ros2/arm-1/arm_controller/state');
  });

  it('formats message as pretty JSON by default', () => {
    const output = formatMessage({ name: ['j1'], position: [1.0] }, false);
    expect(output).toContain('"name"');
    expect(output).toContain('\n'); // Pretty printed
  });

  it('formats message as compact JSON with --json', () => {
    const output = formatMessage({ name: ['j1'] }, true);
    expect(output).not.toContain('\n');
    expect(output).toBe('{"name":["j1"]}');
  });

  it('formats string payload', () => {
    expect(formatMessage('hello', false)).toBe('hello');
  });
});
