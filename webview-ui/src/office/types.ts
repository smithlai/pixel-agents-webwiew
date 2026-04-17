export {
  DEFAULT_COLS,
  DEFAULT_ROWS,
  MATRIX_EFFECT_DURATION_SEC as MATRIX_EFFECT_DURATION,
  MAX_COLS,
  MAX_ROWS,
  TILE_SIZE,
} from '../constants.js';

export const TileType = {
  WALL: 0,
  FLOOR_1: 1,
  FLOOR_2: 2,
  FLOOR_3: 3,
  FLOOR_4: 4,
  FLOOR_5: 5,
  FLOOR_6: 6,
  FLOOR_7: 7,
  FLOOR_8: 8,
  FLOOR_9: 9,
  VOID: 255,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

/** Re-export ColorValue for consumers that import color types from office/types */
export type { ColorValue } from '../components/ui/types.js';
import type { ColorValue } from '../components/ui/types.js';

export const CharacterState = {
  IDLE: 'idle',
  WALK: 'walk',
  TYPE: 'type',
  /** Standing in front of reportTo's desk, waiting for work to begin */
  REPORT: 'report',
} as const;
export type CharacterState = (typeof CharacterState)[keyof typeof CharacterState];

export const Direction = {
  DOWN: 0,
  LEFT: 1,
  RIGHT: 2,
  UP: 3,
} as const;
export type Direction = (typeof Direction)[keyof typeof Direction];

/** 2D array of hex color strings: '' = transparent, '#RRGGBB' = opaque, '#RRGGBBAA' = semi-transparent. [row][col] */
export type SpriteData = string[][];

export interface Seat {
  /** Chair furniture uid */
  uid: string;
  /** Tile col where agent sits */
  seatCol: number;
  /** Tile row where agent sits */
  seatRow: number;
  /** Direction character faces when sitting (toward adjacent desk) */
  facingDir: Direction;
  assigned: boolean;
}

export interface FurnitureInstance {
  sprite: SpriteData;
  /** Pixel x (top-left) */
  x: number;
  /** Pixel y (top-left) */
  y: number;
  /** Y value used for depth sorting (typically bottom edge) */
  zY: number;
  /** Render-time horizontal flip flag (for mirrored side variants) */
  mirrored?: boolean;
  /** Catalog type ID (asset ID). Used by plugins to look up catalog metadata. */
  type?: string;
}

/**
 * Light source definition for furniture. Positioned relative to the sprite top-left.
 * Used by the lighting render plugin.
 */
export interface LightSource {
  /** Radius in tiles. Fades to transparent at the edge. */
  radius: number;
  /** Core color (rgba string). Alpha is multiplied by intensity. */
  color: string;
  /** 0..1 strength multiplier. Default 1. */
  intensity?: number;
  /** Horizontal offset in sprite pixels from footprint top-left. Default = sprite center. */
  offsetX?: number;
  /** Vertical offset in sprite pixels from footprint top-left. Default = half sprite height. */
  offsetY?: number;
}

export interface ToolActivity {
  toolId: string;
  status: string;
  done: boolean;
  permissionWait?: boolean;
}

export const EditTool = {
  TILE_PAINT: 'tile_paint',
  WALL_PAINT: 'wall_paint',
  FURNITURE_PLACE: 'furniture_place',
  FURNITURE_PICK: 'furniture_pick',
  SELECT: 'select',
  EYEDROPPER: 'eyedropper',
  ERASE: 'erase',
} as const;
export type EditTool = (typeof EditTool)[keyof typeof EditTool];

export interface FurnitureCatalogEntry {
  type: string; // asset ID from furniture manifest
  label: string;
  footprintW: number;
  footprintH: number;
  sprite: SpriteData;
  isDesk: boolean;
  category?: string;
  /** Orientation from rotation group: 'front' | 'back' | 'left' | 'right' */
  orientation?: string;
  /** Whether this item can be placed on top of desk/table surfaces */
  canPlaceOnSurfaces?: boolean;
  /** Number of tile rows from the top of the footprint that are "background" (allow placement, still block walking). Default 0. */
  backgroundTiles?: number;
  /** Whether this item can be placed on wall tiles */
  canPlaceOnWalls?: boolean;
  /** Whether this is a side-oriented asset that produces a mirrored "left" variant */
  mirrorSide?: boolean;
  /** State variant: 'on' | 'off' | undefined. Used by lighting plugin to gate emission. */
  state?: string;
  /** Optional light source emitted by this furniture when active (ON state). */
  light?: LightSource;
}

export interface PlacedFurniture {
  uid: string;
  type: string; // asset ID from furniture manifest
  col: number;
  row: number;
  /** Optional color override for furniture */
  color?: ColorValue;
}

export interface OfficeLayout {
  version: 1;
  cols: number;
  rows: number;
  tiles: TileType[];
  furniture: PlacedFurniture[];
  /** Per-tile color settings, parallel to tiles array. null = wall/no color */
  tileColors?: Array<ColorValue | null>;
  /** Bumped when the bundled default layout changes; forces a reset on existing installs */
  layoutRevision?: number;
}

export interface Character {
  id: number;
  state: CharacterState;
  dir: Direction;
  /** Pixel position */
  x: number;
  y: number;
  /** Current tile column */
  tileCol: number;
  /** Current tile row */
  tileRow: number;
  /** Remaining path steps (tile coords) */
  path: Array<{ col: number; row: number }>;
  /** 0-1 lerp between current tile and next tile */
  moveProgress: number;
  /** Current tool name for typing vs reading animation, or null */
  currentTool: string | null;
  /** Palette index (0-5) */
  palette: number;
  /** Hue shift in degrees (0 = no shift, ≥45 for repeated palettes) */
  hueShift: number;
  /** Animation frame index */
  frame: number;
  /** Time accumulator for animation */
  frameTimer: number;
  /** Timer for idle wander decisions */
  wanderTimer: number;
  /** Number of wander moves completed in current roaming cycle */
  wanderCount: number;
  /** Max wander moves before returning to seat for rest */
  wanderLimit: number;
  /** Whether the agent is actively working */
  isActive: boolean;
  /** Assigned seat uid, or null if no seat */
  seatId: string | null;
  /** Active speech bubble type, or null if none showing */
  bubbleType: 'permission' | 'waiting' | 'text' | null;
  /** Countdown timer for bubble (waiting: 2→0, text: auto-fade, permission: unused) */
  bubbleTimer: number;
  /** Text content for 'text' bubble type */
  bubbleText?: string;
  /**
   * Priority of the active text bubble — higher wins when a new bubble arrives.
   * 0 = ambient chat, 1 = JSONL activity, 2 = notify (dispatch / completion / alerts).
   */
  bubblePriority?: number;
  /** Timer to stay seated while inactive after seat reassignment (counts down to 0) */
  seatTimer: number;
  /** Whether this character represents a sub-agent (spawned by Task tool) */
  isSubagent: boolean;
  /** Parent agent ID if this is a sub-agent, null otherwise */
  parentAgentId: number | null;
  /** Active matrix spawn/despawn effect, or null */
  matrixEffect: 'spawn' | 'despawn' | null;
  /** Timer counting up from 0 to MATRIX_EFFECT_DURATION */
  matrixEffectTimer: number;
  /** Per-column random seeds (16 values) for staggered rain timing */
  matrixEffectSeeds: number[];
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
  /** Matched agent profile key (e.g. 'boss', 'npc_secretary') */
  profileKey?: string;
  /** Rest seat uid (from AgentProfile.restSeat), used for idle behavior */
  restSeatId?: string;
  /** Report-to agent's profile key (from AgentProfile.reportTo) */
  reportToKey?: string;
  /** Agent role (from AgentProfile.role) — determines behavior mode */
  role?: string;
  /** Room bounding box for area-restricted wander (from AgentProfile.wanderArea) */
  wanderArea?: string;
  /** NPC sub-type for behavior dispatch (secretary/pm/bunny) */
  npcType?: 'secretary' | 'pm' | 'bunny';
  /** NPC-specific timer (PM: patrol cooldown, secretary: dispatch cooldown) */
  npcTimer?: number;
  /** PM patrol: index of next DUT to visit (round-robin) */
  npcPatrolIndex?: number;
  /** DUT: timestamp (performance.now ms) of last coffee service — avoids rapid re-service */
  lastCoffeeTs?: number;
  /**
   * Behavior queue — sequential walk-to targets.
   * Each entry has a target (seatId or tile coords) and an action on arrival.
   * 'report' = stand and wait, 'work' = sit and type, 'rest' = sit then idle.
   */
  behaviorQueue: Array<BehaviorStep>;
  /**
   * Runtime speech log — event-only bubbles (dispatch / completion / alerts).
   * Ambient chatter is excluded. Used by the status panel to surface history
   * for NPCs without JSONL (Boss / Secretary).
   */
  speechLog?: Array<{ text: string; timestamp: number }>;
}

export interface BehaviorStep {
  /** Target seat UID (used for 'work' and 'rest' actions) */
  seatId?: string;
  /** Target tile (used for 'report' — stand at a specific tile) */
  tile?: { col: number; row: number };
  /** Direction to face on arrival */
  facingDir?: Direction;
  /** What to do on arrival */
  action: 'report' | 'work' | 'rest' | 'patrol' | 'dispatch' | 'bar-patrol';
  /** Optional text bubble to show on arrival (observer-style: the animation carries its own subtitle) */
  bubbleText?: string;
}
