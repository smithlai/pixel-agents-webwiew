import {
  SEAT_REST_MAX_SEC,
  SEAT_REST_MIN_SEC,
  TYPE_FRAME_DURATION_SEC,
  WALK_FRAME_DURATION_SEC,
  WALK_SPEED_PX_PER_SEC,
  WANDER_MOVES_BEFORE_REST_MAX,
  WANDER_MOVES_BEFORE_REST_MIN,
  WANDER_PAUSE_MAX_SEC,
  WANDER_PAUSE_MIN_SEC,
} from '../../constants.js';
import { findPath } from '../layout/tileMap.js';
import type { CharacterSprites } from '../sprites/spriteData.js';
import type { BehaviorStep, Character, Seat, SpriteData, TileType as TileTypeVal } from '../types.js';
import { CharacterState, Direction, TILE_SIZE } from '../types.js';

/** Tools that show reading animation instead of typing */
const READING_TOOLS = new Set(['Read', 'Grep', 'Glob', 'WebFetch', 'WebSearch']);

/** @internal */
export function isReadingTool(tool: string | null): boolean {
  if (!tool) return false;
  return READING_TOOLS.has(tool);
}

/** Pixel center of a tile */
function tileCenter(col: number, row: number): { x: number; y: number } {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Direction from one tile to an adjacent tile */
function directionBetween(
  fromCol: number,
  fromRow: number,
  toCol: number,
  toRow: number,
): Direction {
  const dc = toCol - fromCol;
  const dr = toRow - fromRow;
  if (dc > 0) return Direction.RIGHT;
  if (dc < 0) return Direction.LEFT;
  if (dr > 0) return Direction.DOWN;
  return Direction.UP;
}

export function createCharacter(
  id: number,
  palette: number,
  seatId: string | null,
  seat: Seat | null,
  hueShift = 0,
): Character {
  const col = seat ? seat.seatCol : 1;
  const row = seat ? seat.seatRow : 1;
  const center = tileCenter(col, row);
  return {
    id,
    state: CharacterState.TYPE,
    dir: seat ? seat.facingDir : Direction.DOWN,
    x: center.x,
    y: center.y,
    tileCol: col,
    tileRow: row,
    path: [],
    moveProgress: 0,
    currentTool: null,
    palette,
    hueShift,
    frame: 0,
    frameTimer: 0,
    wanderTimer: 0,
    wanderCount: 0,
    wanderLimit: randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX),
    isActive: true,
    seatId,
    bubbleType: null,
    bubbleTimer: 0,
    seatTimer: 0,
    isSubagent: false,
    parentAgentId: null,
    matrixEffect: null,
    matrixEffectTimer: 0,
    matrixEffectSeeds: [],
    behaviorQueue: [],
  };
}

/** Resolve a BehaviorStep to a target tile and facing direction */
function resolveBehaviorTarget(
  step: BehaviorStep,
  seats: Map<string, Seat>,
): { col: number; row: number; facingDir: Direction } | null {
  if (step.tile) {
    return { col: step.tile.col, row: step.tile.row, facingDir: step.facingDir ?? Direction.DOWN };
  }
  if (step.seatId) {
    const seat = seats.get(step.seatId);
    if (seat) return { col: seat.seatCol, row: seat.seatRow, facingDir: seat.facingDir };
  }
  return null;
}

/**
 * Try to start the next behavior in the queue.
 * Returns true if a walk was initiated or action taken, false if queue empty.
 */
function processNextBehavior(
  ch: Character,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): boolean {
  if (ch.behaviorQueue.length === 0) return false;
  const next = ch.behaviorQueue[0];
  const target = resolveBehaviorTarget(next, seats);
  if (!target) {
    // Invalid target — skip
    ch.behaviorQueue.shift();
    return processNextBehavior(ch, seats, tileMap, blockedTiles);
  }
  // Already at the target tile?
  if (ch.tileCol === target.col && ch.tileRow === target.row) {
    ch.behaviorQueue.shift();
    applyBehaviorAction(ch, next, target.facingDir);
    return true;
  }
  // Pathfind to target
  const path = findPath(ch.tileCol, ch.tileRow, target.col, target.row, tileMap, blockedTiles);
  if (path.length > 0) {
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }
  // No path — skip this behavior
  ch.behaviorQueue.shift();
  return processNextBehavior(ch, seats, tileMap, blockedTiles);
}

/** Apply the action when arriving at a behavior target */
function applyBehaviorAction(ch: Character, step: BehaviorStep, facingDir: Direction): void {
  ch.frame = 0;
  ch.frameTimer = 0;
  switch (step.action) {
    case 'report':
      // Stand facing the boss
      ch.state = CharacterState.REPORT;
      ch.dir = facingDir;
      break;
    case 'work':
      ch.state = CharacterState.TYPE;
      ch.dir = facingDir;
      break;
    case 'rest':
      ch.state = CharacterState.TYPE;
      ch.dir = facingDir;
      ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
      ch.wanderCount = 0;
      ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
      break;
  }
}

export function updateCharacter(
  ch: Character,
  dt: number,
  walkableTiles: Array<{ col: number; row: number }>,
  seats: Map<string, Seat>,
  tileMap: TileTypeVal[][],
  blockedTiles: Set<string>,
): void {
  ch.frameTimer += dt;

  switch (ch.state) {
    case CharacterState.TYPE: {
      if (ch.frameTimer >= TYPE_FRAME_DURATION_SEC) {
        ch.frameTimer -= TYPE_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 2;
      }
      // If active but has behavior queue (e.g. just assigned report → work), stand up
      if (ch.isActive && ch.behaviorQueue.length > 0) {
        ch.seatTimer = 0;
        processNextBehavior(ch, seats, tileMap, blockedTiles);
        break;
      }
      // If active but sitting at wrong seat (e.g. rest seat), walk to work seat
      if (ch.isActive && ch.seatId) {
        const seat = seats.get(ch.seatId);
        if (seat && (ch.tileCol !== seat.seatCol || ch.tileRow !== seat.seatRow)) {
          const path = findPath(
            ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, tileMap, blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            break;
          }
        }
      }
      // If no longer active, stand up and start idle/rest behavior
      if (!ch.isActive) {
        if (ch.seatTimer > 0) {
          ch.seatTimer -= dt;
          break;
        }
        ch.seatTimer = 0; // clear sentinel
        // If there are queued behaviors (e.g. go to restSeat), process them
        if (ch.behaviorQueue.length > 0) {
          processNextBehavior(ch, seats, tileMap, blockedTiles);
          break;
        }
        ch.state = CharacterState.IDLE;
        ch.frame = 0;
        ch.frameTimer = 0;
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        ch.wanderCount = 0;
        ch.wanderLimit = randomInt(WANDER_MOVES_BEFORE_REST_MIN, WANDER_MOVES_BEFORE_REST_MAX);
      }
      break;
    }

    case CharacterState.REPORT: {
      // Standing in front of boss's desk — idle pose, waiting for work to begin
      ch.frame = 0;
      // When isActive becomes true AND a tool starts, officeState will clear this
      // by pushing 'work' behavior to the queue. Meanwhile just stand here.
      // If queue has items (work was assigned), start moving
      if (ch.behaviorQueue.length > 0) {
        processNextBehavior(ch, seats, tileMap, blockedTiles);
      }
      break;
    }

    case CharacterState.IDLE: {
      // No idle animation — static pose
      ch.frame = 0;
      if (ch.seatTimer < 0) ch.seatTimer = 0; // clear turn-end sentinel
      // If became active — check behavior queue first, then fallback to seat
      if (ch.isActive) {
        if (ch.behaviorQueue.length > 0) {
          processNextBehavior(ch, seats, tileMap, blockedTiles);
          break;
        }
        if (!ch.seatId) {
          // No seat assigned — type in place
          ch.state = CharacterState.TYPE;
          ch.frame = 0;
          ch.frameTimer = 0;
          break;
        }
        const seat = seats.get(ch.seatId);
        if (seat) {
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            seat.seatCol,
            seat.seatRow,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
          } else {
            // Already at seat or no path — sit down
            ch.state = CharacterState.TYPE;
            ch.dir = seat.facingDir;
            ch.frame = 0;
            ch.frameTimer = 0;
          }
        }
        break;
      }
      // Countdown wander timer
      ch.wanderTimer -= dt;
      if (ch.wanderTimer <= 0) {
        // Check if we've wandered enough — return to rest seat or work seat
        if (ch.wanderCount >= ch.wanderLimit) {
          const restTarget = ch.restSeatId ?? ch.seatId;
          if (restTarget) {
            const seat = seats.get(restTarget);
            if (seat) {
              const path = findPath(
                ch.tileCol,
                ch.tileRow,
                seat.seatCol,
                seat.seatRow,
                tileMap,
                blockedTiles,
              );
              if (path.length > 0) {
                ch.path = path;
                ch.moveProgress = 0;
                ch.state = CharacterState.WALK;
                ch.frame = 0;
                ch.frameTimer = 0;
                break;
              }
            }
          }
        }
        if (walkableTiles.length > 0) {
          const target = walkableTiles[Math.floor(Math.random() * walkableTiles.length)];
          const path = findPath(
            ch.tileCol,
            ch.tileRow,
            target.col,
            target.row,
            tileMap,
            blockedTiles,
          );
          if (path.length > 0) {
            ch.path = path;
            ch.moveProgress = 0;
            ch.state = CharacterState.WALK;
            ch.frame = 0;
            ch.frameTimer = 0;
            ch.wanderCount++;
          }
        }
        ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
      }
      break;
    }

    case CharacterState.WALK: {
      // Walk animation
      if (ch.frameTimer >= WALK_FRAME_DURATION_SEC) {
        ch.frameTimer -= WALK_FRAME_DURATION_SEC;
        ch.frame = (ch.frame + 1) % 4;
      }

      if (ch.path.length === 0) {
        // Path complete — snap to tile center and transition
        const center = tileCenter(ch.tileCol, ch.tileRow);
        ch.x = center.x;
        ch.y = center.y;

        // Check behavior queue first
        if (ch.behaviorQueue.length > 0) {
          const next = ch.behaviorQueue[0];
          const target = resolveBehaviorTarget(next, seats);
          if (target && ch.tileCol === target.col && ch.tileRow === target.row) {
            // Arrived at behavior target
            ch.behaviorQueue.shift();
            applyBehaviorAction(ch, next, target.facingDir);
            break;
          }
          // Not at target yet — continue processing queue
          if (processNextBehavior(ch, seats, tileMap, blockedTiles)) break;
        }

        if (ch.isActive) {
          if (!ch.seatId) {
            // No seat — type in place
            ch.state = CharacterState.TYPE;
          } else {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
            } else {
              ch.state = CharacterState.IDLE;
            }
          }
        } else {
          // Check if arrived at rest seat or work seat — sit down for a rest
          const restTarget = ch.restSeatId ?? ch.seatId;
          if (restTarget) {
            const seat = seats.get(restTarget);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              if (ch.seatTimer < 0) {
                ch.seatTimer = 0;
              } else {
                ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
              }
              ch.wanderCount = 0;
              ch.wanderLimit = randomInt(
                WANDER_MOVES_BEFORE_REST_MIN,
                WANDER_MOVES_BEFORE_REST_MAX,
              );
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
          // Also check work seat (original behavior)
          if (ch.seatId) {
            const seat = seats.get(ch.seatId);
            if (seat && ch.tileCol === seat.seatCol && ch.tileRow === seat.seatRow) {
              ch.state = CharacterState.TYPE;
              ch.dir = seat.facingDir;
              if (ch.seatTimer < 0) {
                ch.seatTimer = 0;
              } else {
                ch.seatTimer = randomRange(SEAT_REST_MIN_SEC, SEAT_REST_MAX_SEC);
              }
              ch.wanderCount = 0;
              ch.wanderLimit = randomInt(
                WANDER_MOVES_BEFORE_REST_MIN,
                WANDER_MOVES_BEFORE_REST_MAX,
              );
              ch.frame = 0;
              ch.frameTimer = 0;
              break;
            }
          }
          ch.state = CharacterState.IDLE;
          ch.wanderTimer = randomRange(WANDER_PAUSE_MIN_SEC, WANDER_PAUSE_MAX_SEC);
        }
        ch.frame = 0;
        ch.frameTimer = 0;
        break;
      }

      // Move toward next tile in path
      const nextTile = ch.path[0];
      ch.dir = directionBetween(ch.tileCol, ch.tileRow, nextTile.col, nextTile.row);

      ch.moveProgress += (WALK_SPEED_PX_PER_SEC / TILE_SIZE) * dt;

      const fromCenter = tileCenter(ch.tileCol, ch.tileRow);
      const toCenter = tileCenter(nextTile.col, nextTile.row);
      const t = Math.min(ch.moveProgress, 1);
      ch.x = fromCenter.x + (toCenter.x - fromCenter.x) * t;
      ch.y = fromCenter.y + (toCenter.y - fromCenter.y) * t;

      if (ch.moveProgress >= 1) {
        // Arrived at next tile
        ch.tileCol = nextTile.col;
        ch.tileRow = nextTile.row;
        ch.x = toCenter.x;
        ch.y = toCenter.y;
        ch.path.shift();
        ch.moveProgress = 0;
      }

      // If became active while wandering and no behavior queue, repath to seat
      if (ch.isActive && ch.seatId && ch.behaviorQueue.length === 0) {
        const seat = seats.get(ch.seatId);
        if (seat) {
          const lastStep = ch.path[ch.path.length - 1];
          if (!lastStep || lastStep.col !== seat.seatCol || lastStep.row !== seat.seatRow) {
            const newPath = findPath(
              ch.tileCol,
              ch.tileRow,
              seat.seatCol,
              seat.seatRow,
              tileMap,
              blockedTiles,
            );
            if (newPath.length > 0) {
              ch.path = newPath;
              ch.moveProgress = 0;
            }
          }
        }
      }
      break;
    }
  }
}

/** Get the correct sprite frame for a character's current state and direction */
export function getCharacterSprite(ch: Character, sprites: CharacterSprites): SpriteData {
  switch (ch.state) {
    case CharacterState.TYPE:
      if (isReadingTool(ch.currentTool)) {
        return sprites.reading[ch.dir][ch.frame % 2];
      }
      return sprites.typing[ch.dir][ch.frame % 2];
    case CharacterState.WALK:
      return sprites.walk[ch.dir][ch.frame % 4];
    case CharacterState.REPORT:
      return sprites.walk[ch.dir][1]; // standing pose
    case CharacterState.IDLE:
      return sprites.walk[ch.dir][1];
    default:
      return sprites.walk[ch.dir][1];
  }
}

/** Map character state/dir/frame to sprite sheet (row, col, mirror) for canvas-based Route B rendering. */
export function getCharacterSheetCoords(
  ch: Character,
): { row: 0 | 1 | 2; col: number; mirror: boolean } {
  const mirror = ch.dir === Direction.LEFT;
  const row: 0 | 1 | 2 =
    ch.dir === Direction.DOWN ? 0 : ch.dir === Direction.UP ? 1 : 2;

  let col: number;
  switch (ch.state) {
    case CharacterState.TYPE:
      col = isReadingTool(ch.currentTool) ? 5 + (ch.frame % 2) : 3 + (ch.frame % 2);
      break;
    case CharacterState.WALK:
      col = [0, 1, 2, 1][ch.frame % 4];
      break;
    default:
      col = 1; // standing pose
  }
  return { row, col, mirror };
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}
