/**
 * Manages the lifecycle of DeviceAgents bound to physical ADB devices.
 *
 * Responsibilities:
 * - Create/remove DeviceAgents when ADB devices appear/disappear
 * - Allocate unique agent IDs starting from DEVICE_AGENT_ID_START
 * - Track idle-since timestamps for task assignment strategy
 * - Assign tasks to idle Testers (longest-idle-first)
 */

import * as crypto from 'crypto';

import type {
  AdbDevice,
  ActiveTask,
  DeviceAgent,
} from './deviceTypes.ts';
import { DEVICE_AGENT_ID_START, TESTRUN_PREFIX } from './deviceTypes.ts';
import { EventTranslator } from './eventTranslator.ts';

export type DeviceChangeCallback = (agents: DeviceAgent[], models: Map<string, string>) => void;

export class DeviceManager {
  private agents = new Map<string, DeviceAgent>();
  private models = new Map<string, string>();
  private translators = new Map<string, EventTranslator>();
  private nextId = DEVICE_AGENT_ID_START;
  private onChange: DeviceChangeCallback | null = null;

  /** Register callback for device list changes */
  onDeviceChange(cb: DeviceChangeCallback): void {
    this.onChange = cb;
  }

  /** Called by AdbPoller when device list changes */
  updateDevices(devices: AdbDevice[]): void {
    const currentSerials = new Set(devices.map(d => d.serial));
    let changed = false;

    // Remove agents for disconnected devices
    for (const [serial, agent] of this.agents) {
      if (!currentSerials.has(serial)) {
        if (agent.state === 'active') {
          // Active task on disconnected device → error state, defer removal
          agent.state = 'error';
          changed = true;
          setTimeout(() => {
            this.agents.delete(serial);
            this.models.delete(serial);
            this.translators.delete(serial);
            this.notifyChange();
          }, 3000);
        } else {
          this.agents.delete(serial);
          this.models.delete(serial);
          this.translators.delete(serial);
          changed = true;
        }
      }
    }

    // Add agents for new devices
    for (const device of devices) {
      if (device.status === 'unauthorized') {
        console.warn(`[DeviceManager] Device ${device.serial} is unauthorized — skipping`);
        continue;
      }
      if (device.status === 'offline') continue;

      if (!this.agents.has(device.serial)) {
        const agentId = this.nextId++;
        this.agents.set(device.serial, {
          serial: device.serial,
          agentId,
          state: 'idle',
          idleSince: Date.now(),
          task: null,
        });
        this.models.set(device.serial, device.model);
        this.translators.set(device.serial, new EventTranslator(agentId));
        changed = true;
      }
    }

    if (changed) this.notifyChange();
  }

  /** Get all current agents */
  getAgents(): DeviceAgent[] {
    return [...this.agents.values()];
  }

  /** Get model name for a serial */
  getModel(serial: string): string {
    return this.models.get(serial) ?? serial;
  }

  /** Get EventTranslator for a serial */
  getTranslator(serial: string): EventTranslator | undefined {
    return this.translators.get(serial);
  }

  /** Get agent by serial */
  getAgent(serial: string): DeviceAgent | undefined {
    return this.agents.get(serial);
  }

  /** Find agent by agentId */
  getAgentById(agentId: number): DeviceAgent | undefined {
    for (const agent of this.agents.values()) {
      if (agent.agentId === agentId) return agent;
    }
    return undefined;
  }

  /**
   * Assign a task to an idle Tester.
   * Returns assignment info or null if no idle Tester available.
   *
   * @param command - The Boss command to execute
   * @param serial - Optional: target specific device
   */
  assignTask(
    command: string,
    serial?: string,
  ): { agent: DeviceAgent; testrun: string } | null {
    let target: DeviceAgent | undefined;

    if (serial) {
      target = this.agents.get(serial);
      if (!target || target.state !== 'idle') return null;
    } else {
      // Pick the idle Tester with the longest idle time
      let oldest: DeviceAgent | undefined;
      for (const agent of this.agents.values()) {
        if (agent.state !== 'idle') continue;
        if (!oldest || agent.idleSince < oldest.idleSince) {
          oldest = agent;
        }
      }
      target = oldest;
    }

    if (!target) return null;

    const uuid8 = crypto.randomUUID().slice(0, 8);
    const testrun = `${TESTRUN_PREFIX}-${target.serial}-${uuid8}`;

    const task: ActiveTask = {
      command,
      serial: target.serial,
      testrun,
      pid: null,
      startedAt: Date.now(),
      jsonlFile: null,
    };

    target.state = 'active';
    target.task = task;
    this.notifyChange();

    return { agent: target, testrun };
  }

  /** Mark a task as complete and reset agent to idle */
  completeTask(serial: string, _reason: 'completed' | 'user-stop' | 'error' | 'spawn-timeout'): DeviceAgent | null {
    const agent = this.agents.get(serial);
    if (!agent || agent.state === 'idle') return null;

    agent.state = 'idle';
    agent.idleSince = Date.now();
    agent.task = null;
    this.notifyChange();

    return agent;
  }

  /** Set PID on the active task (after spawn) */
  setTaskPid(serial: string, pid: number): void {
    const agent = this.agents.get(serial);
    if (agent?.task) {
      agent.task.pid = pid;
    }
  }

  /** Set JSONL file path on the active task (after GooseWatcher detects it) */
  setTaskJsonlFile(serial: string, jsonlFile: string): void {
    const agent = this.agents.get(serial);
    if (agent?.task) {
      agent.task.jsonlFile = jsonlFile;
    }
  }

  private notifyChange(): void {
    this.onChange?.(this.getAgents(), this.models);
  }
}
