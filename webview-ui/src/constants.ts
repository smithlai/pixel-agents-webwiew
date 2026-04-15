import type { ColorValue } from './components/ui/types.js';

// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = 64;
export const MAX_ROWS = 64;

// ── Character Animation ─────────────────────────────────────
export const WALK_SPEED_PX_PER_SEC = 48;
export const WALK_FRAME_DURATION_SEC = 0.15;
export const TYPE_FRAME_DURATION_SEC = 0.3;
export const WANDER_PAUSE_MIN_SEC = 2.0;
export const WANDER_PAUSE_MAX_SEC = 20.0;
export const WANDER_MOVES_BEFORE_REST_MIN = 3;
export const WANDER_MOVES_BEFORE_REST_MAX = 6;
export const SEAT_REST_MIN_SEC = 120.0;
export const SEAT_REST_MAX_SEC = 240.0;

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 1.2;
export const MATRIX_TRAIL_LENGTH = 6;
export const MATRIX_SPRITE_COLS = 16;
export const MATRIX_SPRITE_ROWS = 24;
export const MATRIX_FLICKER_FPS = 30;
export const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;
export const MATRIX_COLUMN_STAGGER_RANGE = 0.3;
export const MATRIX_HEAD_COLOR = '#ccffcc';
export const matrixGreenBright = (a: number): string => `rgba(0, 255, 65, ${a})`;
export const matrixGreenMid = (a: number): string => `rgba(0, 170, 40, ${a})`;
export const matrixGreenDim = (a: number): string => `rgba(0, 85, 20, ${a})`;
export const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;
export const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;
export const MATRIX_TRAIL_MID_THRESHOLD = 0.33;
export const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

// ── Sparks Effect (physics-based welding sparks) ─────────────
export const SPARK_SPAWN_INTERVAL_MS = 600;   // ms between spawn checks per emitter
export const SPARK_SPAWN_CHANCE = 0.2;         // probability each interval
export const SPARK_MAX_COUNT = 60;             // max active particles
export const SPARK_VX_RANGE = 5;              // horizontal speed range ±, sprite-px/sec
export const SPARK_VY_INIT = 6;               // initial downward speed, sprite-px/sec
export const SPARK_VY_RANGE = 10;             // random addition to vy
export const SPARK_GRAVITY = 25;              // downward accel, sprite-px/sec²
export const SPARK_ALPHA_FADE = 1.2;          // alpha loss per second
export const SPARK_SIZE_PX = 2.5;             // initial particle size, sprite-px
export const SPARK_FALL_LIMIT_PX = 28;        // max fall distance before cull
export const SPARK_COLORS = ['#fff2a8', '#ffbf47', '#ff7a1a', '#ffffff'];

// ── Intel Monitor Effect (interval-based random alerts) ───────
export const INTEL_ALERT_INTERVAL_MS = 2000;       // ms between new alert spawns
export const INTEL_ALERT_MIN_DURATION_MS = 1000;   // minimum alert lifetime
export const INTEL_ALERT_MAX_DURATION_MS = 4000;   // maximum alert lifetime
export const INTEL_ALERT_MAX_RADIUS_PX = 5;        // expanding ring max radius, sprite-px
export const INTEL_ALERT_STROKE_PX = 2;
export const INTEL_ALERT_ALPHA = 0.8;
export const INTEL_SCANLINE_ALPHA = 0.22;
export const INTEL_SCANLINE_HEIGHT_PX = 4;
export const INTEL_SCAN_SPEED = 0.75;
export const INTEL_SCAN_INTERVAL_MS = 4000;        // ms between scanline activations
export const INTEL_SCAN_DURATION_MS = 1200;        // ms each scanline stays active
export const INTEL_BORDER_INTERVAL_MS = 6000;      // ms between border activations
export const INTEL_BORDER_DURATION_MS = 700;       // ms each border stays active
export const INTEL_SCREEN_HEIGHT_FRACTION = 0.60;  // top fraction of sprite is screen; bottom is desk
export const INTEL_MONITOR_COLOR = 'rgba(255, 72, 72, 1)';
export const INTEL_MONITOR_FILL = 'rgba(255, 40, 40, 0.08)';

// ── Rendering ────────────────────────────────────────────────
export const CHARACTER_SITTING_OFFSET_PX = 6;
export const CHARACTER_Z_SORT_OFFSET = 0.5;
export const OUTLINE_Z_SORT_OFFSET = 0.001;
export const SELECTED_OUTLINE_ALPHA = 1.0;
export const HOVERED_OUTLINE_ALPHA = 0.5;
export const GHOST_PREVIEW_SPRITE_ALPHA = 0.5;
export const GHOST_PREVIEW_TINT_ALPHA = 0.25;
export const SELECTION_DASH_PATTERN: [number, number] = [4, 3];
export const BUTTON_MIN_RADIUS = 6;
export const BUTTON_RADIUS_ZOOM_FACTOR = 3;
export const BUTTON_ICON_SIZE_FACTOR = 0.45;
export const BUTTON_LINE_WIDTH_MIN = 1.5;
export const BUTTON_LINE_WIDTH_ZOOM_FACTOR = 0.5;
export const BUBBLE_FADE_DURATION_SEC = 0.5;
export const BUBBLE_SITTING_OFFSET_PX = 10;
export const BUBBLE_VERTICAL_OFFSET_PX = 24;
export const FALLBACK_FLOOR_COLOR = '#808080';

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)';
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)';
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)';
export const GRID_LINE_COLOR = 'rgba(255,255,255,0.12)';
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255,255,255,0.08)';
export const VOID_TILE_DASH_PATTERN: [number, number] = [2, 2];
export const GHOST_BORDER_HOVER_FILL = 'rgba(60, 130, 220, 0.25)';
export const GHOST_BORDER_HOVER_STROKE = 'rgba(60, 130, 220, 0.5)';
export const GHOST_BORDER_STROKE = 'rgba(255, 255, 255, 0.06)';
export const GHOST_VALID_TINT = '#00ff00';
export const GHOST_INVALID_TINT = '#ff0000';
export const SELECTION_HIGHLIGHT_COLOR = '#007fd4';
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.85)';
export const ROTATE_BUTTON_BG = 'rgba(50, 120, 200, 0.85)';
export const BUTTON_ICON_COLOR = '#fff';
export const CANVAS_FALLBACK_TILE_COLOR = '#444';
export const CANVAS_ERROR_TILE_COLOR = '#FF00FF';
export const WALL_COLOR = '#3A3A5C';

// ── Reflection ──────────────────────────────────────────────
/** Base alpha for reflected sprites (0 = invisible, 1 = fully opaque) */
export const REFLECTION_ALPHA = 0.5;
/** Vertical gap in sprite-pixels between entity bottom and reflection top */
export const REFLECTION_GAP_PX = 0;

// ── Lighting ────────────────────────────────────────────────
/** Ambient darkness overlay alpha (0 = full daylight, 1 = pitch black).
 *  Bloom 模式：保持很低的整體壓暗，讓光源只做「發光物件的光溢出」而不改變場景主色。 */
export const AMBIENT_DARK_ALPHA = 0.12;
/** Default light radius in tiles when a source doesn't specify one. */
export const LIGHT_DEFAULT_RADIUS_TILES = 3;
/** Default warm light color (center of radial gradient). */
export const LIGHT_DEFAULT_COLOR = 'rgba(255, 220, 140, 1)';
/** Default vertical offset from sprite top-left, in sprite pixels. Negative = above top, positive = downward.
 *  Fallback places the light at ~70% of sprite height (near base) so lamps/objects glow outward from the footprint. */
export const LIGHT_DEFAULT_OFFSET_RATIO = 0.7;

// ── Camera ───────────────────────────────────────────────────
export const CAMERA_FOLLOW_LERP = 0.1;
export const CAMERA_FOLLOW_SNAP_THRESHOLD = 0.5;

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;
export const ZOOM_DEFAULT_DPR_FACTOR = 2;
export const ZOOM_LEVEL_FADE_DELAY_MS = 1500;
export const ZOOM_LEVEL_HIDE_DELAY_MS = 2000;
export const ZOOM_LEVEL_FADE_DURATION_SEC = 0.5;
export const ZOOM_STEP = 0.1;
export const ZOOM_SCROLL_THRESHOLD = 50;
export const PAN_MARGIN_FRACTION = 0.25;

// ── Editor ───────────────────────────────────────────────────
export const UNDO_STACK_MAX_SIZE = 50;
export const LAYOUT_SAVE_DEBOUNCE_MS = 500;
export const DEFAULT_FLOOR_COLOR: ColorValue = { h: 35, s: 30, b: 15, c: 0 };
export const DEFAULT_WALL_COLOR: ColorValue = { h: 240, s: 25, b: 0, c: 0 };
export const DEFAULT_NEUTRAL_COLOR: ColorValue = { h: 0, s: 0, b: 0, c: 0 };

// ── Notification Sound (done: ascending chime) ─────────────
export const NOTIFICATION_NOTE_1_HZ = 659.25; // E5
export const NOTIFICATION_NOTE_2_HZ = 1318.51; // E6 (octave up)
export const NOTIFICATION_NOTE_1_START_SEC = 0;
export const NOTIFICATION_NOTE_2_START_SEC = 0.1;
export const NOTIFICATION_NOTE_DURATION_SEC = 0.18;
export const NOTIFICATION_VOLUME = 0.14;

// ── Permission Sound (attention: descending double tap) ────
export const PERMISSION_NOTE_1_HZ = 880; // A5
export const PERMISSION_NOTE_2_HZ = 659.25; // E5 (down a fourth)
export const PERMISSION_NOTE_1_START_SEC = 0;
export const PERMISSION_NOTE_2_START_SEC = 0.12;
export const PERMISSION_NOTE_DURATION_SEC = 0.15;
export const PERMISSION_VOLUME = 0.12;

// ── Furniture Animation ─────────────────────────────────────
export const FURNITURE_ANIM_INTERVAL_SEC = 0.2;

// ── Version Notice ──────────────────────────────────────────
export const WHATS_NEW_AUTO_CLOSE_MS = 20000;
export const WHATS_NEW_FADE_MS = 1000;

// ── Path Overlay ─────────────────────────────────────────────
export const PATH_OVERLAY_COLOR = 'rgba(140, 220, 255, 1)';
export const PATH_OVERLAY_ALPHA = 0.38;
export const PATH_OVERLAY_DOT_RADIUS_PX = 2;
export const PATH_OVERLAY_DASH: [number, number] = [2, 2];

// ── Game Logic ───────────────────────────────────────────────
export const MAX_DELTA_TIME_SEC = 0.1;
export const WAITING_BUBBLE_DURATION_SEC = 2.0;
export const PERMISSION_BUBBLE_DURATION_SEC = 8.0;
export const DISMISS_BUBBLE_FAST_FADE_SEC = 0.3;
export const INACTIVE_SEAT_TIMER_MIN_SEC = 3.0;
export const INACTIVE_SEAT_TIMER_RANGE_SEC = 2.0;
export const PALETTE_COUNT = 6;
export const HUE_SHIFT_MIN_DEG = 45;
export const HUE_SHIFT_RANGE_DEG = 271;
export const AUTO_ON_FACING_DEPTH = 3;
export const AUTO_ON_SIDE_DEPTH = 2;
export const CHARACTER_HIT_HALF_WIDTH = 8;
export const CHARACTER_HIT_HEIGHT = 24;
export const TOOL_OVERLAY_VERTICAL_OFFSET = 32;
export const PULSE_ANIMATION_DURATION_SEC = 1.5;
