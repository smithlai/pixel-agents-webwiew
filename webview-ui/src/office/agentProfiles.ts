/**
 * AgentProfile — 靜態配置對照表
 *
 * 定義每個 Goose Agent / NPC 的身份、所屬房間、工位/休息位。
 * agent 建立時查表自動分配座位和名稱。
 */

// ── Role ────────────────────────────────────────────────────────────────────

export const AgentRole = {
  BOSS: 'boss',
  NPC: 'npc',
  DUT: 'dut',
  DROIDRUN: 'droidrun',
} as const;
export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

// ── Interface ────────────────────────────────────────────────────────────────

export interface AgentProfile {
  /** 顯示名稱 */
  name: string;
  /** LLM 模型標籤（顯示用） */
  model?: string;
  /** 角色分類（決定行為模式） */
  role: AgentRole;
  /** 所屬房間 ID */
  room: string;
  /** 工位座椅 UID（layout 中的 furniture uid） */
  workSeat: string;
  /** 休息位座椅 UID（閒置時回到的位置） */
  restSeat?: string;
  /** 上司 agent profile key（用於匯報動線） */
  reportTo?: string;
  /** 固定 sprite index（對應 char_N.png），NPC 專用，不進 rotation pool */
  sprite?: number;
  /** 偏好膚色 (0-based index into loadedCharacters)，DUT 等走 rotation pool */
  palette?: number;
  /** 限制 wander 的房間（undefined = 全地圖） */
  wanderArea?: string;
  /** NPC 子類型（用於行為分流） */
  npcType?: 'secretary' | 'pm' | 'bunny';
  /** 固定 spawn 位置（不使用座位），用於兔女郎等無座位 NPC */
  spawnTile?: { col: number; row: number };
}

// ── Room IDs ─────────────────────────────────────────────────────────────────
// 對應 layout 的五個區域（32×28 grid）

export const RoomId = {
  ROBOT_WORKSHOP: 'robot-workshop',
  COMPUTER_ROOM: 'computer-room',
  BOSS_OFFICE: 'boss-office',
  LOBBY: 'lobby',
  WAR_ROOM: 'war-room',
} as const;
export type RoomId = (typeof RoomId)[keyof typeof RoomId];

// ── Room display names ───────────────────────────────────────────────────────

export const ROOM_NAMES: Record<RoomId, string> = {
  [RoomId.ROBOT_WORKSHOP]: '機械手臂工房',
  [RoomId.COMPUTER_ROOM]: '電腦室',
  [RoomId.BOSS_OFFICE]: '主管辦公室',
  [RoomId.LOBBY]: '休息大廳',
  [RoomId.WAR_ROOM]: '戰情室',
};

// ── Room bounding boxes (col/row ranges, inclusive) ──────────────────────────
// Used by area-restricted wander to keep characters inside their room.

export interface RoomBounds {
  colMin: number;
  colMax: number;
  rowMin: number;
  rowMax: number;
}

export const ROOM_BOUNDS: Record<string, RoomBounds> = {
  [RoomId.ROBOT_WORKSHOP]: { colMin: 0, colMax: 8, rowMin: 0, rowMax: 10 },
  [RoomId.COMPUTER_ROOM]: { colMin: 9, colMax: 19, rowMin: 0, rowMax: 10 },
  [RoomId.BOSS_OFFICE]: { colMin: 20, colMax: 31, rowMin: 0, rowMax: 13 },
  [RoomId.LOBBY]: { colMin: 0, colMax: 20, rowMin: 14, rowMax: 27 },
  [RoomId.WAR_ROOM]: { colMin: 21, colMax: 31, rowMin: 14, rowMax: 27 },
  'lobby-bar': { colMin: 1, colMax: 2, rowMin: 15, rowMax: 20 },
  ['lobby-seat']: { colMin: 3, colMax: 20, rowMin: 15, rowMax: 17 }
};

// ── Default profiles ─────────────────────────────────────────────────────────
// Key = profile identifier.
// NPC keys use 'npc_' prefix — matchProfile() skips them for fuzzy matching.
// Seat UIDs must match default-layout-999.json furniture UIDs.

export const DEFAULT_PROFILES: Record<string, AgentProfile> = {
  boss: {
    name: 'Boss',
    role: AgentRole.BOSS,
    room: RoomId.BOSS_OFFICE,
    workSeat: 'exec-chair-pm',
    restSeat: 'exec-chair-pm',
    wanderArea: RoomId.BOSS_OFFICE,
    palette: 0,
  },
  npc_secretary: {
    name: '秘書',
    role: AgentRole.NPC,
    npcType: 'secretary',
    room: RoomId.BOSS_OFFICE,
    workSeat: 'exec-sofa',
    restSeat: 'exec-sofa',
    wanderArea: RoomId.BOSS_OFFICE,
    sprite: 6,
  },
  npc_pm: {
    name: 'PM',
    role: AgentRole.NPC,
    npcType: 'pm',
    room: RoomId.WAR_ROOM,
    workSeat: 'analysis-chair1',
    restSeat: 'analysis-chair1',
    sprite: 12,
  },
  npc_bunny1: {
    name: '兔女郎（內場）',
    role: AgentRole.NPC,
    npcType: 'bunny',
    room: RoomId.LOBBY,
    workSeat: '',
    wanderArea: 'lobby-bar',
    sprite: 8,
    spawnTile: { col: 1, row: 15 },
  },
  npc_bunny2: {
    name: '兔女郎（外場）',
    role: AgentRole.NPC,
    npcType: 'bunny',
    room: RoomId.LOBBY,
    workSeat: '',
    wanderArea: 'lobby-seat',
    sprite: 11,
    spawnTile: { col: 3, row: 17 },
  },
  npc_bunny3: {
    name: '兔女郎（外場）',
    role: AgentRole.NPC,
    npcType: 'bunny',
    room: RoomId.LOBBY,
    workSeat: '',
    wanderArea: 'lobby-seat',
    sprite: 11,
    spawnTile: { col: 8, row: 16 },
  },
  npc_bunny4: {
    name: '兔女郎（外場）',
    role: AgentRole.NPC,
    npcType: 'bunny',
    room: RoomId.LOBBY,
    workSeat: '',
    wanderArea: 'lobby-seat',
    sprite: 11,
    spawnTile: { col: 14, row: 15 },
  },
};

// ── Lookup helpers ───────────────────────────────────────────────────────────

/**
 * 根據 folderName / agent 名稱模糊匹配 profile。
 * NPC profiles（npc_ 前綴）不參與 fuzzy 匹配——只能用精確 key 取得。
 */
export function matchProfile(hint: string): AgentProfile | null {
  const lower = hint.toLowerCase();
  // Exact key match (works for both NPC and non-NPC)
  if (DEFAULT_PROFILES[lower]) return DEFAULT_PROFILES[lower];
  // Fuzzy match — skip npc_ prefixed profiles
  for (const [key, profile] of Object.entries(DEFAULT_PROFILES)) {
    if (key.startsWith('npc_')) continue;
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

/** Seat pool for dynamically spawned device Testers — DUT 工作時坐電腦室 */
const DEVICE_TESTER_SEATS = [
  { workSeat: 'lab1-chair1', restSeat: 'lobby-sofa3', room: RoomId.COMPUTER_ROOM },
  { workSeat: 'lab2-chair1', restSeat: 'lobby-sofa4', room: RoomId.COMPUTER_ROOM },
  { workSeat: 'lab1-chair2', restSeat: 'lobby-sofa1', room: RoomId.COMPUTER_ROOM },
  { workSeat: 'f-1775812008205-jqd6', restSeat: 'lobby-sofa2', room: RoomId.COMPUTER_ROOM },
];

/** Track allocated seat indices so multiple devices don't overlap */
const allocatedSeatIndices = new Set<number>();

/**
 * Generate a DUT profile for an ADB device.
 * Auto-assigns a free seat from the pool, round-robin cycles if exhausted.
 */
export function generateTesterProfile(
  serial: string,
  model: string,
  agentId: number,
): AgentProfile {
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
    role: AgentRole.DUT,
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

/**
 * Check if a profile key is an NPC (not available for dynamic assignment).
 */
export function isNpcProfile(key: string): boolean {
  return key.startsWith('npc_');
}

/**
 * Get all NPC profile entries.
 */
export function getNpcProfiles(): Array<[string, AgentProfile]> {
  return Object.entries(DEFAULT_PROFILES).filter(([key]) => key.startsWith('npc_'));
}
