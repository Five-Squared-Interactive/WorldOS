// Copyright (c) 2019-2025 Five Squared Interactive. All rights reserved.

/**
 * rosbridge v2.0 Protocol Type Definitions
 * Based on rosbridge_suite WebSocket JSON API
 *
 * IMPORTANT: Keep ROS message field names in snake_case
 * Do NOT transform to camelCase - matches rosbridge JSON format
 */

/**
 * Base rosbridge message structure
 */
export interface RosbridgeMessage {
  op: string;
  id?: string;
  topic?: string;
  type?: string;
  msg?: unknown;
  service?: string;
  args?: unknown;
  values?: unknown;
  result?: boolean;
}

/**
 * Subscribe operation
 */
export interface SubscribeOp {
  op: 'subscribe';
  topic: string;
  type: string;
  throttle_rate?: number;
  queue_length?: number;
  id?: string;
}

/**
 * Unsubscribe operation
 */
export interface UnsubscribeOp {
  op: 'unsubscribe';
  topic: string;
  id?: string;
}

/**
 * Advertise operation (required before publish)
 */
export interface AdvertiseOp {
  op: 'advertise';
  topic: string;
  type: string;
  id?: string;
}

/**
 * Unadvertise operation
 */
export interface UnadvertiseOp {
  op: 'unadvertise';
  topic: string;
  id?: string;
}

/**
 * Publish operation
 */
export interface PublishOp {
  op: 'publish';
  topic: string;
  msg: unknown;
  id?: string;
}

/**
 * Call service operation
 */
export interface CallServiceOp {
  op: 'call_service';
  service: string;
  args?: unknown;
  id?: string;
}

/**
 * Service response from rosbridge
 */
export interface ServiceResponseOp {
  op: 'service_response';
  service: string;
  values?: unknown;
  result: boolean;
  id?: string;
}

/**
 * Per-topic configuration
 */
export interface TopicConfig {
  /** ROS topic name (e.g., "/joint_states") */
  name: string;
  /** ROS message type (e.g., "sensor_msgs/JointState") - required by rosbridge subscribe */
  type: string;
  /** Optional throttle rate in ms for rosbridge-side throttling */
  throttle_rate?: number;
}

/**
 * Per-robot connection configuration
 */
export interface ConnectionConfig {
  /** WebSocket URL to rosbridge (e.g., "ws://192.168.1.10:9090") */
  url: string;
  /** Topics to subscribe and bridge */
  topics: TopicConfig[];
  /** ROS services to expose via MQTT */
  services: string[];
}

/**
 * Full plugin configuration (loaded from JSON file)
 */
export interface ROS2BridgeConfig {
  /** Map of robot name to connection config */
  connections: Record<string, ConnectionConfig>;
  /** Reconnection settings */
  reconnect?: {
    maxAttempts?: number;
    maxDelayMs?: number;
  };
}

/**
 * Topic statistics for status reporting
 */
export interface TopicStats {
  name: string;
  direction: 'ros-to-mqtt' | 'mqtt-to-ros';
  messageCount: number;
  lastMessageAt: number | null;
}

/**
 * Robot connection status
 */
export interface RobotStatus {
  robotName: string;
  url: string;
  state: ConnectionState;
  latencyMs: number | null;
  topics: TopicStats[];
  serviceCallCount: number;
  serviceErrorCount: number;
  connectedSince: number | null;
}

/** Connection state */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * sensor_msgs/JointState message
 */
export interface JointStateMessage {
  header: {
    stamp: { sec: number; nanosec: number };
    frame_id: string;
  };
  name: string[];
  position: number[];
  velocity: number[];
  effort: number[];
}

/**
 * std_msgs/Float64MultiArray
 */
export interface Float64MultiArrayMessage {
  layout: {
    dim: Array<{ label: string; size: number; stride: number }>;
    data_offset: number;
  };
  data: number[];
}

/**
 * trajectory_msgs/JointTrajectory
 */
export interface JointTrajectoryMessage {
  header: {
    stamp: { sec: number; nanosec: number };
    frame_id: string;
  };
  joint_names: string[];
  points: Array<{
    positions: number[];
    velocities?: number[];
    accelerations?: number[];
    effort?: number[];
    time_from_start: { sec: number; nanosec: number };
  }>;
}
