import { GameObjects, Scene } from "phaser";
import { CONSTANTS } from "../constants";
import { EventBus } from "../EventBus";
import { Minimap } from "../ui/Minimap";

// These must match server constants
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const PLAYER_RADIUS = 16;
const PLAYER_SPEED = 200;
const SLOWDOWN_SPEED = 80; // Speed when in slowdown zones

// Terrain zone colors
const TERRAIN_COLORS = {
  WATER: 0x3498db,
  SLOWDOWN: 0xc4a35a,
};

// Define terrain zones (x, y, width, height)
interface TerrainZone {
  x: number;
  y: number;
  width: number;
  height: number;
  type: "water" | "slowdown";
}

// Terrain layout for the multiplayer map
const TERRAIN_ZONES: TerrainZone[] = [
  // Water ponds (impassable)
  { x: 150, y: 300, width: 200, height: 150, type: "water" },
  { x: 1600, y: 200, width: 250, height: 180, type: "water" },
  { x: 800, y: 1500, width: 300, height: 200, type: "water" },
  { x: 100, y: 1700, width: 180, height: 150, type: "water" },
  
  // Quicksand/mud areas (slowdown)
  { x: 500, y: 100, width: 250, height: 200, type: "slowdown" },
  { x: 1200, y: 600, width: 300, height: 250, type: "slowdown" },
  { x: 300, y: 1000, width: 200, height: 300, type: "slowdown" },
  { x: 1500, y: 1300, width: 280, height: 220, type: "slowdown" },
  { x: 900, y: 400, width: 180, height: 150, type: "slowdown" },
];

interface InputState {
  moveUp: boolean;
  moveDown: boolean;
  moveLeft: boolean;
  moveRight: boolean;
}

export default class MultiplayerGameScene extends Scene {
  private players: Map<string, GameObjects.Arc> = new Map();
  private localPlayer: GameObjects.Arc | null = null;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private localPlayerId: string | null = null;
  private minimap: Minimap | null = null;
  private terrainZones: TerrainZone[] = TERRAIN_ZONES;
  private currentSpeedModifier: number = 1.0;
  
  // Track last input state to detect changes
  private lastInputState: InputState = {
    moveUp: false,
    moveDown: false,
    moveLeft: false,
    moveRight: false,
  };

  constructor() {
    super(CONSTANTS.SCENES.MULTIPLAYER_GAME);
  }

  init() {
    this.scale.on("resize", this.resize, this);
    
    EventBus.on("set-local-player-id", this.handleSetLocalPlayerId, this);
  }

  create() {
    this.add.rectangle(0, 0, MAP_WIDTH, MAP_HEIGHT, 0x2a2a2a).setOrigin(0, 0);

    const graphics = this.add.graphics();
    graphics.lineStyle(4, 0xffffff, 0.5);
    graphics.strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    // Draw terrain zones
    this.drawTerrainZones();

    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);

    this.localPlayer = this.add.circle(MAP_WIDTH / 2, MAP_HEIGHT / 2, PLAYER_RADIUS, 0x4a9eff);
    this.localPlayer.setData("playerId", "local");
    this.localPlayer.setVisible(false); // Hidden until we get server position

    // Camera follows player tightly to avoid drift perception
    this.cameras.main.startFollow(this.localPlayer, true, 0.5, 0.5);

    this.cursors = this.input.keyboard?.createCursorKeys() || null;

    EventBus.on("multiplayer-game-state", this.handleGameState, this);
    EventBus.on("multiplayer-player-joined", this.handlePlayerJoined, this);
    EventBus.on("multiplayer-player-left", this.handlePlayerLeft, this);

    EventBus.emit("send-player-join");

    // Create minimap
    this.minimap = new Minimap(this, {
      worldWidth: MAP_WIDTH,
      worldHeight: MAP_HEIGHT,
      width: 150,
      height: 150,
    });

    // Render terrain zones on minimap
    this.renderTerrainOnMinimap();

    EventBus?.emit("current-scene-ready", this);
  }

  /**
   * Draw terrain zones on the game world
   */
  private drawTerrainZones(): void {
    const terrainGraphics = this.add.graphics();

    for (const zone of this.terrainZones) {
      const color = zone.type === "water" ? TERRAIN_COLORS.WATER : TERRAIN_COLORS.SLOWDOWN;
      const alpha = zone.type === "water" ? 0.8 : 0.6;

      // Fill the zone
      terrainGraphics.fillStyle(color, alpha);
      terrainGraphics.fillRect(zone.x, zone.y, zone.width, zone.height);

      // Add a border
      terrainGraphics.lineStyle(2, color, 1);
      terrainGraphics.strokeRect(zone.x, zone.y, zone.width, zone.height);
    }
  }

  /**
   * Render terrain zones on the minimap
   */
  private renderTerrainOnMinimap(): void {
    if (!this.minimap) return;

    this.minimap.renderTerrainZones(this.terrainZones.map(zone => ({
      x: zone.x,
      y: zone.y,
      width: zone.width,
      height: zone.height,
      color: zone.type === "water" ? TERRAIN_COLORS.WATER : TERRAIN_COLORS.SLOWDOWN,
    })));
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer || !this.cursors) return;

    const currentInput: InputState = {
      moveUp: this.cursors.up?.isDown || false,
      moveDown: this.cursors.down?.isDown || false,
      moveLeft: this.cursors.left?.isDown || false,
      moveRight: this.cursors.right?.isDown || false,
    };

    // Client side movement locally for immediate feedback, but server is authority
    if (this.localPlayer.visible) {
      // Check current terrain and get speed modifier
      this.updateTerrainEffects(this.localPlayer.x, this.localPlayer.y);
      const currentSpeed = this.currentSpeedModifier < 1.0 ? SLOWDOWN_SPEED : PLAYER_SPEED;

      let velocityX = 0;
      let velocityY = 0;

      if (currentInput.moveLeft) velocityX = -currentSpeed;
      if (currentInput.moveRight) velocityX = currentSpeed;
      if (currentInput.moveUp) velocityY = -currentSpeed;
      if (currentInput.moveDown) velocityY = currentSpeed;

      const deltaSeconds = delta / 1000;
      let newX = this.localPlayer.x + velocityX * deltaSeconds;
      let newY = this.localPlayer.y + velocityY * deltaSeconds;

      // Clamp to map boundaries first
      newX = Phaser.Math.Clamp(newX, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
      newY = Phaser.Math.Clamp(newY, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);

      // Check for water collision - allow sliding along edges
      const canMoveX = !this.isInWater(newX, this.localPlayer.y);
      const canMoveY = !this.isInWater(this.localPlayer.x, newY);

      if (canMoveX) {
        this.localPlayer.x = newX;
      }
      if (canMoveY) {
        this.localPlayer.y = newY;
      }
    }

    // Send input changes to server (event-based, only when input changes)
    // Check each input individually and only send what changed
    if (currentInput.moveUp !== this.lastInputState.moveUp) {
      EventBus.emit("send-input-change", { input: "moveUp", pressed: currentInput.moveUp });
      this.lastInputState.moveUp = currentInput.moveUp;
    }
    if (currentInput.moveDown !== this.lastInputState.moveDown) {
      EventBus.emit("send-input-change", { input: "moveDown", pressed: currentInput.moveDown });
      this.lastInputState.moveDown = currentInput.moveDown;
    }
    if (currentInput.moveLeft !== this.lastInputState.moveLeft) {
      EventBus.emit("send-input-change", { input: "moveLeft", pressed: currentInput.moveLeft });
      this.lastInputState.moveLeft = currentInput.moveLeft;
    }
    if (currentInput.moveRight !== this.lastInputState.moveRight) {
      EventBus.emit("send-input-change", { input: "moveRight", pressed: currentInput.moveRight });
      this.lastInputState.moveRight = currentInput.moveRight;
    }

    if (this.minimap && this.localPlayer.visible) {
      this.minimap.update(this.localPlayer.x, this.localPlayer.y);
    }
  }

  handleSetLocalPlayerId(data: { playerId: string }) {
    this.localPlayerId = data.playerId;
  }

  handleGameState(data: any) {
    if (!data.players) return;
    if (!this.localPlayerId) return;

    for (const playerState of data.players) {
      const playerId = playerState.playerId?.value;
      const position = playerState.position;
      
      if (!playerId || !position) continue;
      
      if (playerId === this.localPlayerId) {
        if (this.localPlayer) {
          if (!this.localPlayer.visible) {
            this.localPlayer.setVisible(true);
          }
          
          // Server reconciliation: correct client position towards server truth
          const distance = Phaser.Math.Distance.Between(
            this.localPlayer.x,
            this.localPlayer.y,
            position.x,
            position.y
          );
          
          if (distance > 100) {
            // Snap if very far (teleport, initial spawn, or major desync)
            this.localPlayer.x = position.x;
            this.localPlayer.y = position.y;
          } else if (distance > 2) {
            // Blend towards server position - stronger correction to prevent drift
            // Use higher lerp factor to keep client close to server truth
            this.localPlayer.x = Phaser.Math.Linear(this.localPlayer.x, position.x, 0.3);
            this.localPlayer.y = Phaser.Math.Linear(this.localPlayer.y, position.y, 0.3);
          }
          // If within 2 pixels, trust client prediction (feels responsive)
          // If very close, trust client prediction
        }
      } else {
        // Remote player - update or create
        if (!this.players.has(playerId)) {
          this.handlePlayerJoined({
            playerId: playerId,
            username: playerId,
            x: position.x,
            y: position.y,
          });
        } else {
          this.updateRemotePlayer(playerId, position.x, position.y);
        }
      }
    }
  }

  handlePlayerJoined(data: { playerId: string; username: string; x: number; y: number }) {
    if (data.playerId === this.localPlayerId) return;
    if (this.players.has(data.playerId)) return;
    
    const player = this.add.circle(data.x, data.y, PLAYER_RADIUS, 0xff4444);
    player.setData("playerId", data.playerId);
    this.players.set(data.playerId, player);

    const label = this.add.text(data.x, data.y - 30, data.username, {
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#000000",
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5);
    
    player.setData("label", label);

    // Add player to minimap
    this.minimap?.updateOtherPlayer(data.playerId, data.x, data.y);
  }

  handlePlayerLeft(data: { playerId: string }) {
    const player = this.players.get(data.playerId);
    if (player) {
      const label = player.getData("label");
      label?.destroy();
      player.destroy();
      this.players.delete(data.playerId);
    }

    // Remove player from minimap
    this.minimap?.removeOtherPlayer(data.playerId);
  }

  updateRemotePlayer(playerId: string, x: number, y: number) {
    const player = this.players.get(playerId);
    
    if (player) {
      // Smooth interpolation for remote players
      player.x = Phaser.Math.Linear(player.x, x, 0.3);
      player.y = Phaser.Math.Linear(player.y, y, 0.3);
      
      const label = player.getData("label");
      if (label) {
        label.x = player.x;
        label.y = player.y - 30;
      }

      // Update player on minimap
      this.minimap?.updateOtherPlayer(playerId, player.x, player.y);
    }
  }

  resize(gameSize: GameObjects.Components.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
  }

  /**
   * Check if a position (with player radius) collides with a water zone
   */
  private isInWater(x: number, y: number): boolean {
    for (const zone of this.terrainZones) {
      if (zone.type !== "water") continue;
      
      // Check if player circle overlaps with water rectangle
      // Account for player radius on all sides
      if (
        x + PLAYER_RADIUS > zone.x &&
        x - PLAYER_RADIUS < zone.x + zone.width &&
        y + PLAYER_RADIUS > zone.y &&
        y - PLAYER_RADIUS < zone.y + zone.height
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check terrain effects at position and update speed modifier
   */
  private updateTerrainEffects(x: number, y: number): void {
    for (const zone of this.terrainZones) {
      if (zone.type !== "slowdown") continue;
      
      if (
        x >= zone.x &&
        x <= zone.x + zone.width &&
        y >= zone.y &&
        y <= zone.y + zone.height
      ) {
        this.currentSpeedModifier = 0.4;
        return;
      }
    }
    this.currentSpeedModifier = 1.0;
  }

  destroy() {
    EventBus.removeListener("multiplayer-game-state");
    EventBus.removeListener("multiplayer-player-joined");
    EventBus.removeListener("multiplayer-player-left");
    EventBus.removeListener("set-local-player-id");
    
    this.minimap?.destroy();
    this.minimap = null;
  }
}
