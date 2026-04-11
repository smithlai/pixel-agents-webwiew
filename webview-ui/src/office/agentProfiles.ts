/**
 * AgentProfile — 靜態配置對照表
 *
 * 定義每個 Goose Agent 的身份、所屬房間、工位/休息位。
 * agent 建立時查表自動分配座位和名稱。
 */

// ── Interface ────────────────────────────────────────────────────────────────

export interface AgentProfile {
  /** 顯示名稱 */
  name: string;
  /** LLM 模型標籤（顯示用） */
  model?: string;
  /** 所屬房間 ID */
  room: string;
  /** 工位座椅 UID（layout 中的 furniture uid） */
  workSeat: string;
  /** 休息位座椅 UID（閒置時回到的位置） */
  restSeat?: string;
  /** 上司 agent profile key（用於匯報動線） */
  reportTo?: string;
  /** 偏好膚色 (0-5) */
  palette?: number;
}

// ── Room IDs ─────────────────────────────────────────────────────────────────

export const RoomId = {
  EXECUTIVE_OFFICE: 'executive-office',
  TEST_LAB_1: 'test-lab-1',
  TEST_LAB_2: 'test-lab-2',
  ANALYSIS_ROOM: 'analysis-room',
  LOBBY_BAR: 'lobby-bar',
} as const;
export type RoomId = (typeof RoomId)[keyof typeof RoomId];

// ── Room display names ───────────────────────────────────────────────────────

export const ROOM_NAMES: Record<RoomId, string> = {
  [RoomId.EXECUTIVE_OFFICE]: '主管辦公室',
  [RoomId.TEST_LAB_1]: '測試實驗室 1',
  [RoomId.TEST_LAB_2]: '測試實驗室 2',
  [RoomId.ANALYSIS_ROOM]: '分析室',
  [RoomId.LOBBY_BAR]: '休息吧',
};

// ── Default profiles ─────────────────────────────────────────────────────────
// Key = profile identifier, used by browserMock and eventTranslator to match agents.
// Seat UIDs must match default-layout-999.json furniture UIDs.

export const DEFAULT_PROFILES: Record<string, AgentProfile> = {
  boss: {
    name: 'Boss',
    room: RoomId.EXECUTIVE_OFFICE,
    workSeat: 'exec-chair',
    restSeat: 'exec-chair',
    palette: 0,
  },
  pm: {
    name: 'ST PM',
    model: 'gpt-4.1',
    room: RoomId.EXECUTIVE_OFFICE,
    workSeat: 'exec-chair-pm',
    restSeat: 'lobby-sofa1',
    reportTo: 'boss',
    palette: 1,
  },
  analyst: {
    name: 'ST Analyst',
    model: 'gpt-4.1',
    room: RoomId.ANALYSIS_ROOM,
    workSeat: 'analysis-chair1',
    restSeat: 'lobby-sofa2',
    reportTo: 'pm',
    palette: 2,
  },
  tester: {
    name: 'ST Tester',
    model: 'gpt-4.1',
    room: RoomId.TEST_LAB_1,
    workSeat: 'lab1-chair1',
    restSeat: 'lobby-sofa3',
    reportTo: 'pm',
    palette: 3,
  },
  tester2: {
    name: 'ST Tester 2',
    model: 'gpt-4.1',
    room: RoomId.TEST_LAB_2,
    workSeat: 'lab2-chair1',
    restSeat: 'lobby-sofa4',
    reportTo: 'pm',
    palette: 4,
  },
  tester3: {
    name: 'ST Tester 3',
    model: 'gpt-4.1',
    room: RoomId.ANALYSIS_ROOM,
    workSeat: 'analysis-chair2',
    restSeat: 'lobby-bench3',
    reportTo: 'pm',
    palette: 3,
  },
};

// ── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * 根據 folderName / agent 名稱模糊匹配 profile。
 * 支援 browserMock 的 'PM'/'Analyst'/'Tester' 以及 Goose 事件的各種命名。
 */
export function matchProfile(hint: string): AgentProfile | null {
  const lower = hint.toLowerCase();
  // Exact key match
  if (DEFAULT_PROFILES[lower]) return DEFAULT_PROFILES[lower];
  // Fuzzy match by name or keyword
  for (const [key, profile] of Object.entries(DEFAULT_PROFILES)) {
    if (lower.includes(key) || profile.name.toLowerCase().includes(lower)) {
      return profile;
    }
  }
  return null;
}

/**
 * 取得 profile 的房間顯示名稱。
 */
export function getRoomDisplayName(profile: AgentProfile): string {
  return ROOM_NAMES[profile.room as RoomId] ?? profile.room;
}

// ── Dynamic Tester profiles (ADB devices) ────────────────────────────────────

/** Seat pool for dynamically spawned device Testers (must match default-layout-999.json) */
const DEVICE_TESTER_SEATS = [
  { workSeat: 'lab1-chair1', restSeat: 'lobby-sofa3', room: RoomId.TEST_LAB_1 },
  { workSeat: 'lab2-chair1', restSeat: 'lobby-sofa4', room: RoomId.TEST_LAB_2 },
  { workSeat: 'analysis-chair2', restSeat: 'lobby-bench3', room: RoomId.ANALYSIS_ROOM },
  { workSeat: 'analysis-chair1', restSeat: 'lobby-sofa2', room: RoomId.ANALYSIS_ROOM },
];

/** Track allocated seat indices so multiple devices don't overlap */
const allocatedSeatIndices = new Set<number>();

/**
 * Generate a Tester profile for an ADB device.
 * Auto-assigns a free seat from the pool, round-robin cycles if exhausted.
 */
export function generateTesterProfile(
  serial: string,
  model: string,
  agentId: number,
): AgentProfile {
  // Find first unallocated seat, or wrap around
  let seatIdx = 0;
  for (let i = 0; i < DEVICE_TESTER_SEATS.length; i++) {
    if (!allocatedSeatIndices.has(i)) {
      seatIdx = i;
      break;
    }
    seatIdx = i;
  }
  allocatedSeatIndices.add(seatIdx);
  const seat = DEVICE_TESTER_SEATS[seatIdx % DEVICE_TESTER_SEATS.length];

  return {
    name: model || serial,
    model: `device:${serial}`,
    room: seat.room,
    workSeat: seat.workSeat,
    restSeat: seat.restSeat,
    reportTo: 'boss',
    palette: (agentId - 200) % 6,
  };
}

/**
 * Release a seat when a device disconnects.
 */
export function releaseTesterSeat(agentId: number): void {
  const idx = (agentId - 200) % DEVICE_TESTER_SEATS.length;
  allocatedSeatIndices.delete(idx);
}
