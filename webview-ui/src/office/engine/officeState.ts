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
  Character,
  FurnitureInstance,
  OfficeLayout,
  PlacedFurniture,
  Seat,
  TileType as TileTypeVal,
} from '../types.js';
import { CharacterState, Direction, MATRIX_EFFECT_DURATION, TILE_SIZE } from '../types.js';
import { AgentRole, DEFAULT_PROFILES, matchProfile } from '../agentProfiles.js';
import { createCharacter, updateCharacter } from './characters.js';
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
          const cx = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
          const cy = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
          ch.x = cx;
          ch.y = cy;
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
        ch.x = seat.seatCol * TILE_SIZE + TILE_SIZE / 2;
        ch.y = seat.seatRow * TILE_SIZE + TILE_SIZE / 2;
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
    ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
    ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
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

  /** Temporarily unblock a character's own seat, run fn, then re-block */
  private withOwnSeatUnblocked<T>(ch: Character, fn: () => T): T {
    const key = this.ownSeatKey(ch);
    if (key) this.blockedTiles.delete(key);
    const result = fn();
    if (key) this.blockedTiles.add(key);
    return result;
  }

  /** Temporarily unblock own seat + all behavior queue target seats */
  private withBehaviorSeatsUnblocked<T>(ch: Character, fn: () => T): T {
    const keys: string[] = [];
    // Own seat
    const ownKey = this.ownSeatKey(ch);
    if (ownKey) keys.push(ownKey);
    // Rest seat
    if (ch.restSeatId) {
      const restSeat = this.seats.get(ch.restSeatId);
      if (restSeat) keys.push(`${restSeat.seatCol},${restSeat.seatRow}`);
    }
    // Behavior queue targets
    for (const b of ch.behaviorQueue) {
      if (b.tile) {
        keys.push(`${b.tile.col},${b.tile.row}`);
      } else if (b.seatId) {
        const seat = this.seats.get(b.seatId);
        if (seat) keys.push(`${seat.seatCol},${seat.seatRow}`);
      }
    }
    // Unblock
    const restored: string[] = [];
    for (const k of keys) {
      if (this.blockedTiles.has(k)) {
        this.blockedTiles.delete(k);
        restored.push(k);
      }
    }
    const result = fn();
    // Re-block
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
      ch.x = profile.spawnTile.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = profile.spawnTile.row * TILE_SIZE + TILE_SIZE / 2;
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
        ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
        ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
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
    const path = this.withOwnSeatUnblocked(ch, () =>
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
    const path = this.withOwnSeatUnblocked(ch, () =>
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
    const path = this.withOwnSeatUnblocked(ch, () =>
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
      ch.x = spawn.col * TILE_SIZE + TILE_SIZE / 2;
      ch.y = spawn.row * TILE_SIZE + TILE_SIZE / 2;
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

    // Find a seat in the robot workshop area (col 0-8, row 0-10)
    const workshopBounds = { colMin: 0, colMax: 8, rowMin: 0, rowMax: 10 };
    let bestSeatId: string | null = null;
    for (const [uid, seat] of this.seats) {
      if (!seat.assigned &&
        seat.seatCol >= workshopBounds.colMin && seat.seatCol <= workshopBounds.colMax &&
        seat.seatRow >= workshopBounds.rowMin && seat.seatRow <= workshopBounds.rowMax) {
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
      const workshopTiles = this.walkableTiles.filter(
        (t) => t.col >= workshopBounds.colMin && t.col <= workshopBounds.colMax &&
          t.row >= workshopBounds.rowMin && t.row <= workshopBounds.rowMax,
      );
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

  setAgentActive(id: number, active: boolean): void {
    const ch = this.characters.get(id);
    if (ch) {
      // Skip if already in the desired state (avoid resetting queue on duplicate calls)
      if (ch.isActive === active) return;
      ch.isActive = active;
      ch.behaviorQueue = [];
      if (active) {
        // Build behavior queue: reportTo → workSeat
        if (ch.reportToKey) {
          const bossProfile = DEFAULT_PROFILES[ch.reportToKey];
          if (bossProfile && this.seats.has(bossProfile.workSeat)) {
            const bossSeat = this.seats.get(bossProfile.workSeat)!;
            // Find a walkable tile adjacent to the boss's chair
            const adj = findAdjacentWalkable(
              bossSeat.seatCol, bossSeat.seatRow, this.tileMap, this.blockedTiles,
            );
            if (adj) {
              // Face toward the boss
              const dc = bossSeat.seatCol - adj.col;
              const dr = bossSeat.seatRow - adj.row;
              let facingDir: Direction;
              if (Math.abs(dc) >= Math.abs(dr)) {
                facingDir = dc > 0 ? Direction.RIGHT : Direction.LEFT;
              } else {
                facingDir = dr > 0 ? Direction.DOWN : Direction.UP;
              }
              ch.behaviorQueue.push({ tile: adj, facingDir, action: 'report' });
            }
          }
        }
        // After report (or immediately if no boss), go to own workSeat
        // This will be triggered when the first toolStart arrives (see setAgentTool)
      } else {
        // Sentinel -1: signals turn just ended, skip next seat rest timer.
        ch.seatTimer = -1;
        ch.path = [];
        ch.moveProgress = 0;
        // Queue: go to restSeat if available
        if (ch.restSeatId && this.seats.has(ch.restSeatId)) {
          ch.behaviorQueue.push({ seatId: ch.restSeatId, action: 'rest' });
        }
      }
      this.rebuildFurnitureInstances();
    }
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
      // When a tool starts and agent is in report phase → send to workSeat
      if (tool && ch.seatId) {
        const isReporting = ch.state === CharacterState.REPORT;
        const hasReportInQueue = ch.behaviorQueue.some((b) => b.action === 'report');
        if (isReporting || hasReportInQueue) {
          // Clear report queue and go straight to work
          ch.behaviorQueue = [{ seatId: ch.seatId, action: 'work' }];
          // If currently in REPORT, the update loop will pick up the queue
          // If still walking to report, let the walk finish then the queue processes
        }
      }
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

  showTextBubble(id: number, text: string, duration = 5): void {
    const ch = this.characters.get(id);
    if (ch) {
      ch.bubbleType = 'text';
      ch.bubbleText = text;
      ch.bubbleTimer = duration;
    }
  }

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
  private static readonly SECRETARY_DISPATCH_TEXT = '老闆，目前沒有可用 DUT';
  private static readonly TEXT_BUBBLE_DURATION_SEC = 5;

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
        // bunny: handled by normal wander with wanderArea constraint
      }
    }
  }

  private tickSecretary(ch: Character, _dt: number): void {
    // Secretary reacts when Boss becomes active: find an idle DUT and dispatch
    if (ch.behaviorQueue.length > 0) return;
    if (ch.state !== CharacterState.IDLE && ch.state !== CharacterState.TYPE) return;

    // Find boss character
    const boss = this.findCharacterByRole(AgentRole.BOSS);
    if (!boss || !boss.isActive) return;

    // Boss is active — find an idle (not active) DUT
    const idleDut = this.findIdleDut();
    if (!idleDut) {
      // No DUT available — show warning bubble (once per boss activation)
      if (!ch.bubbleType) {
        this.showTextBubble(ch.id, OfficeState.SECRETARY_DISPATCH_TEXT, OfficeState.TEXT_BUBBLE_DURATION_SEC);
      }
      return;
    }

    // Walk to DUT, show dispatch bubble, then return to own seat
    const dutSeat = idleDut.seatId ? this.seats.get(idleDut.seatId) : null;
    const target = dutSeat
      ? findAdjacentWalkable(dutSeat.seatCol, dutSeat.seatRow, this.tileMap, this.blockedTiles)
      : null;

    if (target) {
      const dc = (dutSeat?.seatCol ?? target.col) - target.col;
      const dr = (dutSeat?.seatRow ?? target.row) - target.row;
      let facingDir: Direction;
      if (Math.abs(dc) >= Math.abs(dr)) {
        facingDir = dc > 0 ? Direction.RIGHT : Direction.LEFT;
      } else {
        facingDir = dr > 0 ? Direction.DOWN : Direction.UP;
      }
      ch.behaviorQueue.push({ tile: target, facingDir, action: 'dispatch' });
    }

    // After dispatch, return to own seat
    const profile = ch.profileKey ? DEFAULT_PROFILES[ch.profileKey] : null;
    if (profile) {
      ch.behaviorQueue.push({ seatId: profile.workSeat, action: 'rest' });
    }
  }

  private tickPm(ch: Character, dt: number): void {
    if (ch.behaviorQueue.length > 0) return;

    // Initialize timer
    if (ch.npcTimer === undefined) ch.npcTimer = OfficeState.PM_PATROL_COOLDOWN_SEC;
    ch.npcTimer -= dt;
    if (ch.npcTimer > 0) return;

    // Timer expired — find an active DUT to visit
    const activeDuts = this.getActiveDuts();
    if (activeDuts.length === 0) {
      ch.npcTimer = OfficeState.PM_PATROL_COOLDOWN_SEC;
      return;
    }

    // Round-robin
    if (ch.npcPatrolIndex === undefined) ch.npcPatrolIndex = 0;
    const dutIdx = ch.npcPatrolIndex % activeDuts.length;
    ch.npcPatrolIndex = (ch.npcPatrolIndex + 1) % activeDuts.length;
    const dut = activeDuts[dutIdx];

    // Walk to DUT's workstation area
    const dutSeat = dut.seatId ? this.seats.get(dut.seatId) : null;
    const target = dutSeat
      ? findAdjacentWalkable(dutSeat.seatCol, dutSeat.seatRow, this.tileMap, this.blockedTiles)
      : null;

    if (target) {
      const dc = (dutSeat?.seatCol ?? target.col) - target.col;
      const dr = (dutSeat?.seatRow ?? target.row) - target.row;
      let facingDir: Direction;
      if (Math.abs(dc) >= Math.abs(dr)) {
        facingDir = dc > 0 ? Direction.RIGHT : Direction.LEFT;
      } else {
        facingDir = dr > 0 ? Direction.DOWN : Direction.UP;
      }
      ch.behaviorQueue.push({ tile: target, facingDir, action: 'patrol' });
    }

    // Return to own seat
    const profile = ch.profileKey ? DEFAULT_PROFILES[ch.profileKey] : null;
    if (profile) {
      ch.behaviorQueue.push({ seatId: profile.workSeat, action: 'rest' });
    }

    // Reset cooldown
    ch.npcTimer = OfficeState.PM_PATROL_COOLDOWN_SEC + OfficeState.PM_PATROL_STAY_SEC;
  }

  private findCharacterByRole(role: AgentRole): Character | null {
    for (const ch of this.characters.values()) {
      if (ch.role === role) return ch;
    }
    return null;
  }

  private findIdleDut(): Character | null {
    for (const ch of this.characters.values()) {
      if (ch.role === AgentRole.DUT && !ch.isActive) return ch;
    }
    return null;
  }

  private getActiveDuts(): Character[] {
    const result: Character[] = [];
    for (const ch of this.characters.values()) {
      if (ch.role === AgentRole.DUT && ch.isActive) result.push(ch);
    }
    return result;
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
      this.withBehaviorSeatsUnblocked(ch, () =>
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

    // Reap orphaned sub-agents whose parent is gone or no longer active.
    // This is the safety net for crash/disconnect scenarios where the
    // droidrun_result event never arrives to clean up the sub-agent.
    this.reapOrphanedSubagents();

    // Remove characters that finished despawn
    for (const id of toDelete) {
      this.characters.delete(id);
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
