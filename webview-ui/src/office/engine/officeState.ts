import {
  AUTO_ON_FACING_DEPTH,
  AUTO_ON_SIDE_DEPTH,
  CHARACTER_HIT_HALF_WIDTH,
  CHARACTER_HIT_HEIGHT,
  CHARACTER_SITTING_OFFSET_PX,
  DISMISS_BUBBLE_FAST_FADE_SEC,
  FURNITURE_ANIM_INTERVAL_SEC,
  PERMISSION_BUBBLE_DURATION_SEC,
  HUE_SHIFT_MIN_DEG,
  HUE_SHIFT_RANGE_DEG,
  INACTIVE_SEAT_TIMER_MIN_SEC,
  INACTIVE_SEAT_TIMER_RANGE_SEC,
  WAITING_BUBBLE_DURATION_SEC,
} from '../../constants.js';
import { getAnimationFrames, getCatalogEntry, getOnStateType } from '../layout/furnitureCatalog.js';
import { getLoadedCharacterCount } from '../sprites/spriteData.js';
import {
  createDefaultLayout,
  getBlockedTiles,
  layoutToFurnitureInstances,
  layoutToSeats,
  layoutToTileMap,
} from '../layout/layoutSerializer.js';
import { findAdjacentWalkable, findPath, getWalkableTiles, isWalkable } from '../layout/tileMap.js';
import type {
  BehaviorStep,
  Character,
  FurnitureInstance,
  OfficeLayout,
  PlacedFurniture,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, Direction, MATRIX_EFFECT_DURATION, TILE_SIZE } from '../types.js';
import { AgentRole, DEFAULT_PROFILES, matchProfile, ROOM_BOUNDS, RoomId } from '../agentProfiles.js';
import type { RoomBounds } from '../agentProfiles.js';
import { createCharacter, tileCenter, updateCharacter } from './characters.js';
import { matrixEffectSeeds } from './matrixEffect.js';

export class OfficeState {
  layout: OfficeLayout;
  tileMap: TileTypeVal[][];
  seats: Map<string, Seat>;
  blockedTiles: Set<string>;
  furniture: FurnitureInstance[];
  walkableTiles: Array<{ col: number; row: number }>;
  characters: Map<number, Character> = new Map();
  /** Accumulated time for furniture animation frame cycling */
  furnitureAnimTimer = 0;
  selectedAgentId: number | null = null;
  cameraFollowId: number | null = null;
  hoveredAgentId: number | null = null;
  hoveredTile: { col: number; row: number } | null = null;
  /** Maps "parentId:toolId" → sub-agent character ID (negative) */
  subagentIdMap: Map<string, number> = new Map();
  /** Reverse lookup: sub-agent character ID → parent info */
  subagentMeta: Map<number, { parentAgentId: number; parentToolId: string }> = new Map();
  /** Ambient chat cooldown (seconds) per character */
  private ambientChatCooldownSec: Map<number, number> = new Map();
  /** DUT ids that have actually started work at least once */
  private workedDutIds: Set<number> = new Set();
  private nextSubagentId = -1;

  constructor(layout?: OfficeLayout) {
    this.layout = layout || createDefaultLayout();
    this.tileMap = layoutToTileMap(this.layout);
    this.seats = layoutToSeats(this.layout.furniture);
    this.blockedTiles = getBlockedTiles(this.layout.furniture);
    this.furniture = layoutToFurnitureInstances(this.layout.furniture);
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);
  }

  /** Rebuild all derived state from a new layout. Reassigns existing characters.
   *  @param shift Optional pixel shift to apply when grid expands left/up */
  rebuildFromLayout(layout: OfficeLayout, shift?: { col: number; row: number }): void {
    this.layout = layout;
    this.tileMap = layoutToTileMap(layout);
    this.seats = layoutToSeats(layout.furniture);
    this.blockedTiles = getBlockedTiles(layout.furniture);
    this.rebuildFurnitureInstances();
    this.walkableTiles = getWalkableTiles(this.tileMap, this.blockedTiles);

    // Shift character positions when grid expands left/up
    if (shift && (shift.col !== 0 || shift.row !== 0)) {
      for (const ch of this.characters.values()) {
        ch.tileCol += shift.col;
        ch.tileRow += shift.row;
        ch.x += shift.col * TILE_SIZE;
        ch.y += shift.row * TILE_SIZE;
        // Clear path since tile coords changed
        ch.path = [];
        ch.moveProgress = 0;
      }
    }

    // Reassign characters to new seats, preserving existing assignments when possible
    for (const seat of this.seats.values()) {
      seat.assigned = false;
    }

    // First pass: try to keep characters at their existing seats
    for (const ch of this.characters.values()) {
      if (ch.seatId && this.seats.has(ch.seatId)) {
        const seat = this.seats.get(ch.seatId)!;
        if (!seat.assigned) {
          seat.assigned = true;
          // Snap character to seat position
          ch.tileCol = seat.seatCol;
          ch.tileRow = seat.seatRow;
          const center = tileCenter(seat.seatCol, seat.seatRow);
          ch.x = center.x;
          ch.y = center.y;
          ch.dir = seat.facingDir;
          continue;
        }
      }
      ch.seatId = null; // will be reassigned below
    }

    // Second pass: assign remaining characters to free seats
    // Skip characters that intentionally have no seat (e.g. bunny NPCs with spawnTile)
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue;
      if (ch.npcType === 'bunny') continue;
      const seatId = this.findFreeSeat();
      if (seatId) {
        this.seats.get(seatId)!.assigned = true;
        ch.seatId = seatId;
        const seat = this.seats.get(seatId)!;
        ch.tileCol = seat.seatCol;
        ch.tileRow = seat.seatRow;
        const center = tileCenter(seat.seatCol, seat.seatRow);
        ch.x = center.x;
        ch.y = center.y;
        ch.dir = seat.facingDir;
      }
    }

    // Relocate any characters that ended up outside bounds or on non-walkable tiles
    for (const ch of this.characters.values()) {
      if (ch.seatId) continue; // seated characters are fine
      if (
        ch.tileCol < 0 ||
        ch.tileCol >= layout.cols ||
        ch.tileRow < 0 ||
        ch.tileRow >= layout.rows
      ) {
        this.relocateCharacterToWalkable(ch);
      }
    }
  }

  /** Move a character to a random walkable tile */
  private relocateCharacterToWalkable(ch: Character): void {
    if (this.walkableTiles.length === 0) return;
    const spawn = this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)];
    ch.tileCol = spawn.col;
    ch.tileRow = spawn.row;
    const center = tileCenter(spawn.col, spawn.row);
    ch.x = center.x;
    ch.y = center.y;
    ch.path = [];
    ch.moveProgress = 0;
  }

  getLayout(): OfficeLayout {
    return this.layout;
  }

  /** Get the blocked-tile key for a character's own seat, or null */
  private ownSeatKey(ch: Character): string | null {
    if (!ch.seatId) return null;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return null;
    return `${seat.seatCol},${seat.seatRow}`;
  }

  /** Collect tile keys to temporarily unblock for pathfinding involving a character. */
  private collectUnblockKeys(ch: Character, includeBehavior: boolean): string[] {
    const keys: string[] = [];
    const ownKey = this.ownSeatKey(ch);
    if (ownKey) keys.push(ownKey);
    if (!includeBehavior) return keys;
    if (ch.restSeatId) {
      const restSeat = this.seats.get(ch.restSeatId);
      if (restSeat) keys.push(`${restSeat.seatCol},${restSeat.seatRow}`);
    }
    for (const b of ch.behaviorQueue) {
      if (b.tile) {
        keys.push(`${b.tile.col},${b.tile.row}`);
      } else if (b.seatId) {
        const seat = this.seats.get(b.seatId);
        if (seat) keys.push(`${seat.seatCol},${seat.seatRow}`);
      }
    }
    return keys;
  }

  /** Temporarily unblock the given tile keys, run fn, then restore the ones we actually removed. */
  private withSeatsUnblocked<T>(keys: string[], fn: () => T): T {
    const restored: string[] = [];
    for (const k of keys) {
      if (this.blockedTiles.has(k)) {
        this.blockedTiles.delete(k);
        restored.push(k);
      }
    }
    const result = fn();
    for (const k of restored) {
      this.blockedTiles.add(k);
    }
    return result;
  }

  private findFreeSeat(): string | null {
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned) return uid;
    }
    return null;
  }

  /**
   * Pick a diverse palette for a new agent based on currently active agents.
   * First 6 agents each get a unique skin (random order). Beyond 6, skins
   * repeat in balanced rounds with a random hue shift (≥45°).
   */
  private pickDiversePalette(): { palette: number; hueShift: number } {
    // Count how many non-sub-agents use each base palette
    const paletteCount = getLoadedCharacterCount();
    const counts = new Array(paletteCount).fill(0) as number[];
    for (const ch of this.characters.values()) {
      if (ch.isSubagent) continue;
      if (ch.role === 'npc') continue;
      counts[ch.palette % paletteCount]++;
    }
    const minCount = Math.min(...counts);
    // Available = palettes at the minimum count (least used)
    const available: number[] = [];
    for (let i = 0; i < paletteCount; i++) {
      if (counts[i] === minCount) available.push(i);
    }
    const palette = available[Math.floor(Math.random() * available.length)];
    // First round (minCount === 0): no hue shift. Subsequent rounds: random ≥45°.
    let hueShift = 0;
    if (minCount > 0) {
      hueShift = HUE_SHIFT_MIN_DEG + Math.floor(Math.random() * HUE_SHIFT_RANGE_DEG);
    }
    return { palette, hueShift };
  }

  addAgent(
    id: number,
    preferredPalette?: number,
    preferredHueShift?: number,
    preferredSeatId?: string,
    skipSpawnEffect?: boolean,
    folderName?: string,
  ): void {
    if (this.characters.has(id)) return;

    // Try to match an AgentProfile by folderName
    const profile = folderName ? matchProfile(folderName) : null;

    let palette: number;
    let hueShift: number;
    if (preferredPalette !== undefined) {
      palette = preferredPalette;
      hueShift = preferredHueShift ?? 0;
    } else if (profile?.sprite !== undefined) {
      // NPC with fixed sprite index — bypass rotation pool
      palette = profile.sprite;
      hueShift = 0;
    } else if (profile?.palette !== undefined) {
      palette = profile.palette;
      hueShift = 0;
    } else {
      const pick = this.pickDiversePalette();
      palette = pick.palette;
      hueShift = pick.hueShift;
    }

    let ch: Character;
    if (profile?.spawnTile) {
      // Fixed spawn position (no seat) — used by bunny NPCs
      ch = createCharacter(id, palette, null, null, hueShift);
      const center = tileCenter(profile.spawnTile.col, profile.spawnTile.row);
      ch.x = center.x;
      ch.y = center.y;
      ch.tileCol = profile.spawnTile.col;
      ch.tileRow = profile.spawnTile.row;
    } else {
      // Seat priority: explicit param > profile workSeat > any free seat
      let seatId: string | null = null;
      const seatCandidates = [preferredSeatId, profile?.workSeat].filter(Boolean) as string[];
      for (const candidate of seatCandidates) {
        if (this.seats.has(candidate)) {
          const seat = this.seats.get(candidate)!;
          if (!seat.assigned) {
            seatId = candidate;
            break;
          }
        }
      }
      if (!seatId) {
        seatId = this.findFreeSeat();
      }

      if (seatId) {
        const seat = this.seats.get(seatId)!;
        seat.assigned = true;
        ch = createCharacter(id, palette, seatId, seat, hueShift);
      } else {
        // No seats — spawn at random walkable tile
        const spawn =
          this.walkableTiles.length > 0
            ? this.walkableTiles[Math.floor(Math.random() * this.walkableTiles.length)]
            : { col: 1, row: 1 };
        ch = createCharacter(id, palette, null, null, hueShift);
        const center = tileCenter(spawn.col, spawn.row);
        ch.x = center.x;
        ch.y = center.y;
        ch.tileCol = spawn.col;
        ch.tileRow = spawn.row;
      }
    }

    // Apply profile metadata
    ch.folderName = folderName ?? profile?.name;
    if (profile) {
      for (const [key, p] of Object.entries(DEFAULT_PROFILES)) {
        if (p === profile) {
          ch.profileKey = key;
          break;
        }
      }
      if (profile.restSeat) ch.restSeatId = profile.restSeat;
      if (profile.reportTo) ch.reportToKey = profile.reportTo;
      if (profile.role) ch.role = profile.role;
      if (profile.wanderArea) ch.wanderArea = profile.wanderArea;
      if (profile.npcType) ch.npcType = profile.npcType;
    }
    // Bunny NPCs start standing and wandering, not sitting
    if (ch.npcType === 'bunny') {
      ch.isActive = false;
      ch.state = CharacterState.IDLE;
      ch.wanderTimer = 0.5;
      ch.wanderCount = 0;
      ch.wanderLimit = Infinity;
      ch.restSeatId = undefined;
      // Release the seat so others can use it
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId);
        if (seat) seat.assigned = false;
        ch.seatId = null;
      }
    }

    if (!skipSpawnEffect) {
      ch.matrixEffect = 'spawn';
      ch.matrixEffectTimer = 0;
      ch.matrixEffectSeeds = matrixEffectSeeds();
    }
    this.characters.set(id, ch);
  }

  removeAgent(id: number): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (ch.matrixEffect === 'despawn') return; // already despawning
    // Free seat and clear selection immediately
    if (ch.seatId) {
      const seat = this.seats.get(ch.seatId);
      if (seat) seat.assigned = false;
    }
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
    // Start despawn animation instead of immediate delete
    ch.matrixEffect = 'despawn';
    ch.matrixEffectTimer = 0;
    ch.matrixEffectSeeds = matrixEffectSeeds();
    ch.bubbleType = null;
  }

  /** Find seat uid at a given tile position, or null */
  getSeatAtTile(col: number, row: number): string | null {
    for (const [uid, seat] of this.seats) {
      if (seat.seatCol === col && seat.seatRow === row) return uid;
    }
    return null;
  }

  /** Reassign an agent from their current seat to a new seat */
  reassignSeat(agentId: number, seatId: string): void {
    const ch = this.characters.get(agentId);
    if (!ch) return;
    // Unassign old seat
    if (ch.seatId) {
      const old = this.seats.get(ch.seatId);
      if (old) old.assigned = false;
    }
    // Assign new seat
    const seat = this.seats.get(seatId);
    if (!seat || seat.assigned) return;
    seat.assigned = true;
    ch.seatId = seatId;
    // Pathfind to new seat (unblock own seat tile for this query)
    const path = this.withSeatsUnblocked(this.collectUnblockKeys(ch, false), () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
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
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /** Send an agent back to their currently assigned seat */
  sendToSeat(agentId: number): void {
    const ch = this.characters.get(agentId);
    if (!ch || !ch.seatId) return;
    const seat = this.seats.get(ch.seatId);
    if (!seat) return;
    const path = this.withSeatsUnblocked(this.collectUnblockKeys(ch, false), () =>
      findPath(ch.tileCol, ch.tileRow, seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles),
    );
    if (path.length > 0) {
      ch.path = path;
      ch.moveProgress = 0;
      ch.state = CharacterState.WALK;
      ch.frame = 0;
      ch.frameTimer = 0;
    } else {
      // Already at seat — sit down
      ch.state = CharacterState.TYPE;
      ch.dir = seat.facingDir;
      ch.frame = 0;
      ch.frameTimer = 0;
      if (!ch.isActive) {
        ch.seatTimer = INACTIVE_SEAT_TIMER_MIN_SEC + Math.random() * INACTIVE_SEAT_TIMER_RANGE_SEC;
      }
    }
  }

  /** Walk an agent to an arbitrary walkable tile (right-click command) */
  walkToTile(agentId: number, col: number, row: number): boolean {
    const ch = this.characters.get(agentId);
    if (!ch || ch.isSubagent) return false;
    if (!isWalkable(col, row, this.tileMap, this.blockedTiles)) {
      // Also allow walking to own seat tile (blocked for others but not self)
      const key = this.ownSeatKey(ch);
      if (!key || key !== `${col},${row}`) return false;
    }
    const path = this.withSeatsUnblocked(this.collectUnblockKeys(ch, false), () =>
      findPath(ch.tileCol, ch.tileRow, col, row, this.tileMap, this.blockedTiles),
    );
    if (path.length === 0) return false;
    ch.path = path;
    ch.moveProgress = 0;
    ch.state = CharacterState.WALK;
    ch.frame = 0;
    ch.frameTimer = 0;
    return true;
  }

  /** Create a sub-agent character with the parent's palette. Returns the sub-agent ID. */
  addSubagent(parentAgentId: number, parentToolId: string): number {
    const key = `${parentAgentId}:${parentToolId}`;
    if (this.subagentIdMap.has(key)) return this.subagentIdMap.get(key)!;

    const id = this.nextSubagentId--;
    const parentCh = this.characters.get(parentAgentId);
    const palette = parentCh ? parentCh.palette : 0;
    const hueShift = parentCh ? parentCh.hueShift : 0;

    // Find the free seat closest to the parent agent
    const parentCol = parentCh ? parentCh.tileCol : 0;
    const parentRow = parentCh ? parentCh.tileRow : 0;
    const dist = (c: number, r: number) => Math.abs(c - parentCol) + Math.abs(r - parentRow);

    let bestSeatId: string | null = null;
    let bestDist = Infinity;
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned) {
        const d = dist(seat.seatCol, seat.seatRow);
        if (d < bestDist) {
          bestDist = d;
          bestSeatId = uid;
        }
      }
    }

    let ch: Character;
    if (bestSeatId) {
      const seat = this.seats.get(bestSeatId)!;
      seat.assigned = true;
      ch = createCharacter(id, palette, bestSeatId, seat, hueShift);
    } else {
      // No seats — spawn at closest walkable tile to parent
      let spawn = { col: 1, row: 1 };
      if (this.walkableTiles.length > 0) {
        let closest = this.walkableTiles[0];
        let closestDist = dist(closest.col, closest.row);
        for (let i = 1; i < this.walkableTiles.length; i++) {
          const d = dist(this.walkableTiles[i].col, this.walkableTiles[i].row);
          if (d < closestDist) {
            closest = this.walkableTiles[i];
            closestDist = d;
          }
        }
        spawn = closest;
      }
      ch = createCharacter(id, palette, null, null, hueShift);
      const center = tileCenter(spawn.col, spawn.row);
      ch.x = center.x;
      ch.y = center.y;
      ch.tileCol = spawn.col;
      ch.tileRow = spawn.row;
    }
    ch.isSubagent = true;
    ch.parentAgentId = parentAgentId;
    ch.matrixEffect = 'spawn';
    ch.matrixEffectTimer = 0;
    ch.matrixEffectSeeds = matrixEffectSeeds();
    this.characters.set(id, ch);

    this.subagentIdMap.set(key, id);
    this.subagentMeta.set(id, { parentAgentId, parentToolId });
    return id;
  }

  /**
   * Route a sub-agent (droidrun) to the robot workshop.
   * Finds the nearest free seat in the workshop, or a walkable tile near the robot arms.
   */
  routeSubagentToWorkshop(subagentId: number): void {
    const ch = this.characters.get(subagentId);
    if (!ch) return;

    ch.role = AgentRole.DROIDRUN;

    const bounds = ROOM_BOUNDS[RoomId.ROBOT_WORKSHOP];
    const inBounds = (col: number, row: number): boolean =>
      col >= bounds.colMin && col <= bounds.colMax &&
      row >= bounds.rowMin && row <= bounds.rowMax;

    let bestSeatId: string | null = null;
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned && inBounds(seat.seatCol, seat.seatRow)) {
        bestSeatId = uid;
        break;
      }
    }

    // Release the initial seat (near parent) so we can reassign to workshop
    if (ch.seatId) {
      const oldSeat = this.seats.get(ch.seatId);
      if (oldSeat) oldSeat.assigned = false;
      ch.seatId = null;
    }

    if (bestSeatId) {
      // Reassign seat to workshop — FSM will naturally walk there
      const wSeat = this.seats.get(bestSeatId)!;
      wSeat.assigned = true;
      ch.seatId = bestSeatId;
    } else {
      // No seat — walk to a walkable tile in the workshop
      const workshopTiles = this.walkableTiles.filter((t) => inBounds(t.col, t.row));
      if (workshopTiles.length > 0) {
        const target = workshopTiles[Math.floor(Math.random() * workshopTiles.length)];
        ch.behaviorQueue.push({ tile: target, action: 'work' });
      }
    }
  }

  /** Remove a specific sub-agent character and free its seat */
  removeSubagent(parentAgentId: number, parentToolId: string): void {
    const key = `${parentAgentId}:${parentToolId}`;
    const id = this.subagentIdMap.get(key);
    if (id === undefined) return;

    const ch = this.characters.get(id);
    if (ch) {
      if (ch.matrixEffect === 'despawn') {
        // Already despawning — just clean up maps
        this.subagentIdMap.delete(key);
        this.subagentMeta.delete(id);
        return;
      }
      if (ch.seatId) {
        const seat = this.seats.get(ch.seatId);
        if (seat) seat.assigned = false;
      }
      // Start despawn animation — keep character in map for rendering
      ch.matrixEffect = 'despawn';
      ch.matrixEffectTimer = 0;
      ch.matrixEffectSeeds = matrixEffectSeeds();
      ch.bubbleType = null;
    }
    // Clean up tracking maps immediately so keys don't collide
    this.subagentIdMap.delete(key);
    this.subagentMeta.delete(id);
    if (this.selectedAgentId === id) this.selectedAgentId = null;
    if (this.cameraFollowId === id) this.cameraFollowId = null;
  }

  /** Remove all sub-agents belonging to a parent agent */
  removeAllSubagents(parentAgentId: number): void {
    const toRemove: string[] = [];
    for (const [key, id] of this.subagentIdMap) {
      const meta = this.subagentMeta.get(id);
      if (meta && meta.parentAgentId === parentAgentId) {
        const ch = this.characters.get(id);
        if (ch) {
          if (ch.matrixEffect === 'despawn') {
            // Already despawning — just clean up maps
            this.subagentMeta.delete(id);
            toRemove.push(key);
            continue;
          }
          if (ch.seatId) {
            const seat = this.seats.get(ch.seatId);
            if (seat) seat.assigned = false;
          }
          ch.bubbleType = null;
          // Start despawn animation
          ch.matrixEffect = 'despawn';
          ch.matrixEffectTimer = 0;
          ch.matrixEffectSeeds = matrixEffectSeeds();
        }
        this.subagentMeta.delete(id);
        if (this.selectedAgentId === id) this.selectedAgentId = null;
        if (this.cameraFollowId === id) this.cameraFollowId = null;
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      this.subagentIdMap.delete(key);
    }
  }

  /**
   * Invariant enforcement: sub-agents cannot outlive their parent's active state.
   * If the parent is missing or idle, the sub-agent is orphaned and must despawn.
   * Called every frame in update() as a safety net for crash/disconnect scenarios
   * where cleanup events (droidrun_result, subagentClear) never arrive.
   */
  private reapOrphanedSubagents(): void {
    const orphanKeys: string[] = [];
    for (const [key, subId] of this.subagentIdMap) {
      const meta = this.subagentMeta.get(subId);
      if (!meta) { orphanKeys.push(key); continue; }
      const parent = this.characters.get(meta.parentAgentId);
      if (parent && parent.isActive) continue;
      // Parent is missing or idle — this sub-agent is orphaned
      orphanKeys.push(key);
      const ch = this.characters.get(subId);
      if (ch && ch.matrixEffect !== 'despawn') {
        if (ch.seatId) {
          const seat = this.seats.get(ch.seatId);
          if (seat) seat.assigned = false;
        }
        ch.matrixEffect = 'despawn';
        ch.matrixEffectTimer = 0;
        ch.matrixEffectSeeds = matrixEffectSeeds();
        ch.bubbleType = null;
      }
      this.subagentMeta.delete(subId);
      if (this.selectedAgentId === subId) this.selectedAgentId = null;
      if (this.cameraFollowId === subId) this.cameraFollowId = null;
    }
    for (const key of orphanKeys) {
      this.subagentIdMap.delete(key);
    }
  }

  /** Look up the sub-agent character ID for a given parent+toolId, or null */
  getSubagentId(parentAgentId: number, parentToolId: string): number | null {
    return this.subagentIdMap.get(`${parentAgentId}:${parentToolId}`) ?? null;
  }

  /**
   * Observer-style animation playback.
   *
   * Unconditionally overwrites the character's behaviorQueue with the given steps.
   * Any in-progress walk is allowed to finish its current tile step (the FSM will
   * pick up the new queue on arrival) — no teleporting, just a clean redirect.
   *
   * Use this instead of `ch.behaviorQueue.push(...)` for any event-driven update:
   * events are truth, animations are reactions, previous reactions get discarded.
   */
  private playAnimation(ch: Character, steps: BehaviorStep[]): void {
    ch.behaviorQueue = steps;
    // Keep only the immediate next tile (path[0]) so the character finishes
    // the current tile-to-tile lerp without teleporting, then the FSM picks
    // up the new behaviorQueue.  Discard the rest of the old route.
    if (ch.path.length > 1) {
      ch.path.length = 1;
    }
  }

  /**
   * Build a BehaviorStep that walks adjacent to a seat and faces toward it.
   * Returns null if the seat is unreachable.
   */
  private stepToSeatAdjacent(seat: Seat, action: BehaviorStep['action']): BehaviorStep | null {
    const target = findAdjacentWalkable(seat.seatCol, seat.seatRow, this.tileMap, this.blockedTiles);
    if (!target) return null;
    const dc = seat.seatCol - target.col;
    const dr = seat.seatRow - target.row;
    const facingDir: Direction = Math.abs(dc) >= Math.abs(dr)
      ? (dc > 0 ? Direction.RIGHT : Direction.LEFT)
      : (dr > 0 ? Direction.DOWN : Direction.UP);
    return { tile: target, facingDir, action };
  }

  setAgentActive(id: number, active: boolean): void {
    const ch = this.characters.get(id);
    if (!ch) return;
    if (ch.isActive === active) return;

    if (active && ch.role === AgentRole.DUT) {
      this.workedDutIds.add(ch.id);
    }

    ch.isActive = active;

    if (active) {
      // Go to work seat — no report-to-boss detour.
      const steps: BehaviorStep[] = [];
      if (ch.seatId && this.seats.has(ch.seatId)) {
        steps.push({ seatId: ch.seatId, action: 'work' });
      }
      this.playAnimation(ch, steps);

      // DUT dispatched → secretary announces (event-driven, not polled)
      if (ch.role === AgentRole.DUT) {
        const secretary = this.findNpcByType('secretary');
        if (secretary) {
          const dutName = ch.folderName ?? `DUT-${ch.id}`;
          this.showNotifyBubble(
            secretary.id, `Dispatch ${dutName} to perform the task`, OfficeState.TEXT_BUBBLE_DURATION_SEC,
          );
        }
      }
    } else {
      // Sentinel -1: signals turn just ended, skip next seat rest timer.
      ch.seatTimer = -1;

      // DUT finished → announce in place, secretary broadcasts to boss.
      // No walking handoff — zero timing issues.
      if (ch.role === AgentRole.DUT && this.workedDutIds.has(ch.id)) {
        const dutName = ch.folderName ?? `DUT-${ch.id}`;
        this.showNotifyBubble(
          ch.id, 'Task completed', OfficeState.TEXT_BUBBLE_DURATION_SEC,
        );
        const secretary = this.findNpcByType('secretary');
        if (secretary) {
          this.showNotifyBubble(
            secretary.id, `${dutName} Task completed`, OfficeState.TEXT_BUBBLE_DURATION_SEC,
          );
        }
      }
      const steps: BehaviorStep[] = [];
      if (ch.restSeatId && this.seats.has(ch.restSeatId)) {
        steps.push({ seatId: ch.restSeatId, action: 'rest' });
      }
      this.playAnimation(ch, steps);
    }
    this.rebuildFurnitureInstances();
  }

  /** Rebuild furniture instances with auto-state applied (active agents turn electronics ON) */
  private rebuildFurnitureInstances(): void {
    // Collect tiles where active agents face desks
    const autoOnTiles = new Set<string>();
    for (const ch of this.characters.values()) {
      if (!ch.isActive || !ch.seatId) continue;
      const seat = this.seats.get(ch.seatId);
      if (!seat) continue;
      // Find the desk tile(s) the agent faces from their seat
      const dCol =
        seat.facingDir === Direction.RIGHT ? 1 : seat.facingDir === Direction.LEFT ? -1 : 0;
      const dRow = seat.facingDir === Direction.DOWN ? 1 : seat.facingDir === Direction.UP ? -1 : 0;
      // Check tiles in the facing direction (desk could be 1-3 tiles deep)
      for (let d = 1; d <= AUTO_ON_FACING_DEPTH; d++) {
        const tileCol = seat.seatCol + dCol * d;
        const tileRow = seat.seatRow + dRow * d;
        autoOnTiles.add(`${tileCol},${tileRow}`);
      }
      // Also check tiles to the sides of the facing direction (desks can be wide)
      for (let d = 1; d <= AUTO_ON_SIDE_DEPTH; d++) {
        const baseCol = seat.seatCol + dCol * d;
        const baseRow = seat.seatRow + dRow * d;
        if (dCol !== 0) {
          // Facing left/right: check tiles above and below
          autoOnTiles.add(`${baseCol},${baseRow - 1}`);
          autoOnTiles.add(`${baseCol},${baseRow + 1}`);
        } else {
          // Facing up/down: check tiles left and right
          autoOnTiles.add(`${baseCol - 1},${baseRow}`);
          autoOnTiles.add(`${baseCol + 1},${baseRow}`);
        }
      }
    }

    if (autoOnTiles.size === 0) {
      this.furniture = layoutToFurnitureInstances(this.layout.furniture);
      return;
    }

    // Build modified furniture list with auto-state and animation applied
    const animFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    const modifiedFurniture: PlacedFurniture[] = this.layout.furniture.map((item) => {
      const entry = getCatalogEntry(item.type);
      if (!entry) return item;
      // Check if any tile of this furniture overlaps an auto-on tile
      for (let dr = 0; dr < entry.footprintH; dr++) {
        for (let dc = 0; dc < entry.footprintW; dc++) {
          if (autoOnTiles.has(`${item.col + dc},${item.row + dr}`)) {
            let onType = getOnStateType(item.type);
            if (onType !== item.type) {
              // Check if the on-state type has animation frames
              const frames = getAnimationFrames(onType);
              if (frames && frames.length > 1) {
                const frameIdx = animFrame % frames.length;
                onType = frames[frameIdx];
              }
              return { ...item, type: onType };
            }
            return item;
          }
        }
      }
      return item;
    });

    this.furniture = layoutToFurnitureInstances(modifiedFurniture);
  }

  setAgentTool(id: number, tool: string | null): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.currentTool = tool;
    }
  }

  showPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'permission';
      ch.bubbleTimer = PERMISSION_BUBBLE_DURATION_SEC;
    }
  }

  clearPermissionBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch && ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    }
  }

  showWaitingBubble(id: number): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'waiting';
      ch.bubbleTimer = WAITING_BUBBLE_DURATION_SEC;
    }
  }

  /**
   * Internal bubble setter — public callers should use showAmbientBubble /
   * showJsonlBubble / showNotifyBubble for the right priority + history rule.
   *
   * Priority rule: a new bubble only replaces an active one when its priority
   * is greater-than-or-equal. Once the active bubble fades, any priority wins.
   */
  private showTextBubble(id: number, text: string, duration: number, priority: number): boolean {
    const ch = this.characters.get(id);
    if (!ch) return false;
    const stillActive = ch.bubbleType === 'text' && ch.bubbleTimer > 0;
    if (stillActive && (ch.bubblePriority ?? 0) > priority) return false;
    ch.bubbleType = 'text';
    ch.bubbleText = text;
    ch.bubbleTimer = duration;
    ch.bubblePriority = priority;
    return true;
  }

  /** Ambient chatter — lowest priority, no history. */
  showAmbientBubble(id: number, text: string, duration = 5): void {
    this.showTextBubble(id, text, duration, 0);
  }

  /** JSONL tool activity — mid priority, no history (already in agentTools). */
  showJsonlBubble(id: number, text: string, duration = 5): void {
    this.showTextBubble(id, text, duration, 1);
  }

  /** Event notify (dispatch / completion / alerts) — top priority, recorded in speechLog. */
  showNotifyBubble(id: number, text: string, duration = 5): void {
    const accepted = this.showTextBubble(id, text, duration, 2);
    if (!accepted) return;
    const ch = this.characters.get(id);
    if (!ch) return;
    if (!ch.speechLog) ch.speechLog = [];
    ch.speechLog.push({ text, timestamp: Date.now() });
    if (ch.speechLog.length > OfficeState.SPEECH_LOG_MAX) {
      ch.speechLog.splice(0, ch.speechLog.length - OfficeState.SPEECH_LOG_MAX);
    }
  }

  /** Max speech log entries per character (notify bubbles only) */
  private static readonly SPEECH_LOG_MAX = 50;

  /** Dismiss bubble on click — permission: instant, waiting: quick fade */
  dismissBubble(id: number): void {
    const ch = this.characters.get(id);
    if (!ch || !ch.bubbleType) return;
    if (ch.bubbleType === 'permission') {
      ch.bubbleType = null;
      ch.bubbleTimer = 0;
    } else if (ch.bubbleType === 'waiting') {
      // Trigger immediate fade (0.3s remaining)
      ch.bubbleTimer = Math.min(ch.bubbleTimer, DISMISS_BUBBLE_FAST_FADE_SEC);
    }
  }

  // ── NPC behavior constants ──────────────────────────────────────────────
  private static readonly PM_PATROL_COOLDOWN_SEC = 30;
  private static readonly PM_PATROL_STAY_SEC = 5;
  private static readonly TEXT_BUBBLE_DURATION_SEC = 5;
  private static readonly BUNNY_SERVICE_COOLDOWN_SEC = 45;
  private static readonly BUNNY_COFFEE_COOLDOWN_SEC = 30;
  private static readonly AMBIENT_CHAT_MIN_SEC = 18;
  private static readonly AMBIENT_CHAT_RANGE_SEC = 20;
  private static readonly AMBIENT_CHAT_DURATION_SEC = 4;

  private static readonly BOSS_AMBIENT_LINES = [
    'Scan today’s node risks first.',
    'Stability first, speed second.',
    'Keep records complete for easy traceability.',
  ] as const;
  private static readonly SECRETARY_AMBIENT_LINES = [
    "Today's tasks are sorted and can be assigned at any time.",
    'Meetings and test sessions are scheduled.',
    'If you need to adjust priorities, please inform me directly.',
  ] as const;
  private static readonly PM_AMBIENT_LINES = [
    'Requirement split is being updated to the latest version.',
    'Current risks are under control, continue monitoring.',
    'I will organize the next round of verification checklist.',
  ] as const;

  /** Tick NPC-specific behaviors (secretary, PM, bunny) */
  private updateNpcBehaviors(dt: number): void {
    for (const ch of this.characters.values()) {
      if (!ch.npcType) continue;
      if (ch.matrixEffect) continue;

      switch (ch.npcType) {
        case 'secretary':
          this.tickSecretary(ch, dt);
          break;
        case 'pm':
          this.tickPm(ch, dt);
          break;
        case 'bunny':
          this.tickBunny(ch, dt);
          break;
      }
    }
  }

  /**
   * Secretary tick — now purely passive.
   *
   * All announcements (dispatch / completion) are event-driven from
   * setAgentActive, not polled here.  The tick is kept as a hook for
   * future idle behaviors if needed, but currently does nothing.
   */
  private tickSecretary(_ch: Character, _dt: number): void {
    // Intentionally empty — secretary announcements are event-driven.
  }

  /**
   * Observer-style bunny tick.
   *
   * Periodically picks an active DUT that hasn't been served recently and plays
   * a "walk over → serve coffee" animation. If the situation changes mid-walk,
   * the next interruption (e.g. DUT disconnects) just overwrites the queue —
   * the bunny doesn't track "in-progress deliveries".
   */
  private tickBunny(ch: Character, dt: number): void {
    // While executing an animation, wait it out.
    if (ch.behaviorQueue.length > 0) return;

    // Counter bunny (lobby-bar) just wanders behind the bar — no delivery.
    if (ch.wanderArea === 'lobby-bar') return;

    // First-time init: don't serve immediately on spawn.
    if (ch.npcTimer === undefined) ch.npcTimer = OfficeState.BUNNY_SERVICE_COOLDOWN_SEC;
    ch.npcTimer -= dt;
    if (ch.npcTimer > 0) return;

    // Only serve DUTs whose seats are inside the LOBBY — don't wander into test labs.
    const lobbyBounds = ROOM_BOUNDS[RoomId.LOBBY];
    const target = this.pickCoffeeTarget(lobbyBounds);
    if (!target) {
      // Nobody to serve — stay in wander mode, retry after half a cooldown.
      ch.npcTimer = OfficeState.BUNNY_SERVICE_COOLDOWN_SEC / 2;
      return;
    }

    const dutSeat = target.seatId ? this.seats.get(target.seatId) : null;
    if (!dutSeat) {
      ch.npcTimer = OfficeState.BUNNY_SERVICE_COOLDOWN_SEC / 2;
      return;
    }
    const serveStep = this.stepToSeatAdjacent(dutSeat, 'dispatch');
    if (!serveStep) {
      ch.npcTimer = OfficeState.BUNNY_SERVICE_COOLDOWN_SEC / 2;
      return;
    }

    // Mark the DUT as served NOW — even if the bunny never arrives, we won't
    // spam-select the same DUT on every tick.
    target.lastCoffeeTs = performance.now();

    const dutName = target.folderName ?? `DUT-${target.id}`;
    this.playAnimation(ch, [
      { ...serveStep, bubbleText: `Please enjoy ☕ ${dutName}` },
    ]);
    ch.npcTimer = OfficeState.BUNNY_SERVICE_COOLDOWN_SEC;
  }

  /** Pick an active DUT that hasn't had coffee recently.
   *  If `bounds` is given, only consider DUTs whose seat is within that area. */
  private pickCoffeeTarget(bounds?: RoomBounds): Character | null {
    const now = performance.now();
    const cooldownMs = OfficeState.BUNNY_COFFEE_COOLDOWN_SEC * 1000;
    const candidates: Character[] = [];
    for (const ch of this.characters.values()) {
      if (ch.role !== AgentRole.DUT) continue;
      if (!ch.isActive) continue;
      if (ch.matrixEffect) continue;
      if (ch.lastCoffeeTs !== undefined && now - ch.lastCoffeeTs < cooldownMs) continue;
      // Area filter: DUT's seat must be inside the specified bounds
      if (bounds && ch.seatId) {
        const seat = this.seats.get(ch.seatId);
        if (seat && (
          seat.seatCol < bounds.colMin || seat.seatCol > bounds.colMax ||
          seat.seatRow < bounds.rowMin || seat.seatRow > bounds.rowMax
        )) continue;
      }
      candidates.push(ch);
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  private tickPm(ch: Character, dt: number): void {
    // While walking to a target, wait until arrival (behaviorQueue clears on arrival)
    if (ch.behaviorQueue.length > 0) return;

    // Initialize: start in cooldown phase (npcPatrolIndex undefined = cooldown)
    if (ch.npcTimer === undefined) ch.npcTimer = OfficeState.PM_PATROL_COOLDOWN_SEC;

    ch.npcTimer -= dt;
    if (ch.npcTimer > 0) return;

    const activeDuts = this.getActiveDuts();

    if (ch.npcPatrolIndex === undefined) {
      // ── Cooldown expired — start a new patrol run ─────────────────────────
      if (activeDuts.length === 0) {
        ch.npcTimer = OfficeState.PM_PATROL_COOLDOWN_SEC;
        return;
      }
      ch.npcPatrolIndex = 0;
    } else {
      // ── Stay expired at current DUT — advance to next ──────────────────────
      ch.npcPatrolIndex++;
    }

    if (ch.npcPatrolIndex >= activeDuts.length) {
      // All DUTs visited — return to own seat, then enter cooldown
      ch.npcPatrolIndex = undefined;
      const profile = ch.profileKey ? DEFAULT_PROFILES[ch.profileKey] : null;
      if (profile?.workSeat) {
        ch.behaviorQueue.push({ seatId: profile.workSeat, action: 'rest' });
      }
      ch.npcTimer = OfficeState.PM_PATROL_COOLDOWN_SEC;
      return;
    }

    // Walk to the current DUT's workstation, then stay PM_PATROL_STAY_SEC
    this.pmWalkToDut(ch, activeDuts[ch.npcPatrolIndex]);
    ch.npcTimer = OfficeState.PM_PATROL_STAY_SEC;
  }

  /** Queue a walk-to-DUT patrol step for PM */
  private pmWalkToDut(ch: Character, dut: Character): void {
    const dutSeat = dut.seatId ? this.seats.get(dut.seatId) : null;
    if (!dutSeat) return;
    const step = this.stepToSeatAdjacent(dutSeat, 'patrol');
    if (step) this.playAnimation(ch, [step]);
  }

  findNpcByType(npcType: 'secretary' | 'pm' | 'bunny'): Character | null {
    for (const ch of this.characters.values()) {
      if (ch.npcType === npcType) return ch;
    }
    return null;
  }

  private getActiveDuts(): Character[] {
    const result: Character[] = [];
    for (const ch of this.characters.values()) {
      if (ch.role === AgentRole.DUT && ch.isActive && !ch.matrixEffect) result.push(ch);
    }
    return result;
  }

  /** Lightweight ambient chatter: speech bubbles only, no status/tool side effects. */
  private tickAmbientChat(dt: number): void {
    for (const ch of this.characters.values()) {
      if (ch.isSubagent || ch.matrixEffect) continue;
      if (ch.bubbleType) continue;
      if (ch.isActive) continue;

      const prev = this.ambientChatCooldownSec.get(ch.id);
      if (prev === undefined) {
        const seeded =
          OfficeState.AMBIENT_CHAT_MIN_SEC
          + Math.random() * OfficeState.AMBIENT_CHAT_RANGE_SEC;
        this.ambientChatCooldownSec.set(ch.id, seeded);
        continue;
      }

      const next = prev - dt;
      if (next > 0) {
        this.ambientChatCooldownSec.set(ch.id, next);
        continue;
      }

      const lines = this.getAmbientLines(ch);
      if (lines.length > 0) {
        const text = lines[Math.floor(Math.random() * lines.length)];
        this.showAmbientBubble(ch.id, text, OfficeState.AMBIENT_CHAT_DURATION_SEC);
      }

      const reset =
        OfficeState.AMBIENT_CHAT_MIN_SEC
        + Math.random() * OfficeState.AMBIENT_CHAT_RANGE_SEC;
      this.ambientChatCooldownSec.set(ch.id, reset);
    }
  }

  private getAmbientLines(ch: Character): readonly string[] {
    if (ch.role === AgentRole.BOSS) return OfficeState.BOSS_AMBIENT_LINES;
    if (ch.npcType === 'secretary') return OfficeState.SECRETARY_AMBIENT_LINES;
    if (ch.npcType === 'pm') return OfficeState.PM_AMBIENT_LINES;
    return [];
  }

  update(dt: number): void {
    // Furniture animation cycling
    const prevFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    this.furnitureAnimTimer += dt;
    const newFrame = Math.floor(this.furnitureAnimTimer / FURNITURE_ANIM_INTERVAL_SEC);
    if (newFrame !== prevFrame) {
      this.rebuildFurnitureInstances();
    }

    const toDelete: number[] = [];
    for (const ch of this.characters.values()) {
      // Handle matrix effect animation
      if (ch.matrixEffect) {
        ch.matrixEffectTimer += dt;
        if (ch.matrixEffectTimer >= MATRIX_EFFECT_DURATION) {
          if (ch.matrixEffect === 'spawn') {
            // Spawn complete — clear effect, resume normal FSM
            ch.matrixEffect = null;
            ch.matrixEffectTimer = 0;
            ch.matrixEffectSeeds = [];
          } else {
            // Despawn complete — mark for deletion
            toDelete.push(ch.id);
          }
        }
        continue; // skip normal FSM while effect is active
      }

      // Temporarily unblock own seat + behavior queue targets so character can pathfind
      this.withSeatsUnblocked(this.collectUnblockKeys(ch, true), () =>
        updateCharacter(ch, dt, this.walkableTiles, this.seats, this.tileMap, this.blockedTiles),
      );

      // Tick bubble timer (both permission and waiting auto-fade)
      if (ch.bubbleType && ch.bubbleTimer > 0) {
        ch.bubbleTimer -= dt;
        if (ch.bubbleTimer <= 0) {
          ch.bubbleType = null;
          ch.bubbleTimer = 0;
        }
      }
    }

    // NPC behavior tick (secretary dispatch, PM patrol, etc.)
    this.updateNpcBehaviors(dt);
    // Ambient chatter tick (speech bubbles only; does not affect status panel)
    this.tickAmbientChat(dt);

    // Reap orphaned sub-agents whose parent is gone or no longer active.
    // This is the safety net for crash/disconnect scenarios where the
    // droidrun_result event never arrives to clean up the sub-agent.
    this.reapOrphanedSubagents();

    // Remove characters that finished despawn
    for (const id of toDelete) {
      this.characters.delete(id);
      this.ambientChatCooldownSec.delete(id);
      this.workedDutIds.delete(id);
    }
  }

  getCharacters(): Character[] {
    return Array.from(this.characters.values());
  }

  /** Get character at pixel position (for hit testing). Returns id or null. */
  getCharacterAt(worldX: number, worldY: number): number | null {
    const chars = this.getCharacters().sort((a, b) => b.y - a.y);
    for (const ch of chars) {
      // Skip characters that are despawning
      if (ch.matrixEffect === 'despawn') continue;
      // Character sprite is 16x24, anchored bottom-center
      // Apply sitting offset to match visual position
      const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
      const anchorY = ch.y + sittingOffset;
      const left = ch.x - CHARACTER_HIT_HALF_WIDTH;
      const right = ch.x + CHARACTER_HIT_HALF_WIDTH;
      const top = anchorY - CHARACTER_HIT_HEIGHT;
      const bottom = anchorY;
      if (worldX >= left && worldX <= right && worldY >= top && worldY <= bottom) {
        return ch.id;
      }
    }
    return null;
  }
}
