import { GameObjects, Scene, Tilemaps } from "phaser";
import { logger } from "@utils/logger";
import { CONSTANTS } from "../constants";
import { EventBus } from "../EventBus";
import { Minimap } from "../ui/Minimap";
import type { GameState } from "@common/gen/multiplayer/v1/messages_pb";

const PLAYER_RADIUS = 16;
const PLAYER_SPEED = 200;
const SLOWDOWN_SPEED = 80; // Speed when in slowdown zones

// Collision tile IDs - must match server (maploader.go)
const COLLISION_TILES = {
  // Rocks and obstacles from collisions layer
  obstacles: [55, 56, 57, 58, 59, 60, 61, 62, 63],
  // Buildings
  buildings: [148, 149, 150, 165, 166, 167, 182, 183, 184],
  // Elevation tiles that block movement
  elevation: [93, 94, 95, 111, 112, 113, 128, 129, 130],
  // Slowdown tiles (quicksand, mud, etc.)
  slowdown: [168, 169, 170, 185, 186, 187, 202, 203, 204],
};

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

  private collisionLayer: Tilemaps.TilemapLayer | null = null;
  private elevationLayer: Tilemaps.TilemapLayer | null = null;
  private terrainLayer: Tilemaps.TilemapLayer | null = null;

  private mapWidth: number = 0;
  private mapHeight: number = 0;

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
    const map = this.make.tilemap({ key: "map" });
    const tileset = map.addTilesetImage("DesertTilemap", "tiles");
    if (!tileset) {
      logger.error("Tileset not found");
      return;
    }

    // Get map dimensions
    this.mapWidth = map.widthInPixels;
    this.mapHeight = map.heightInPixels;

    // Create all layers
    const groundLayer = map.createLayer("ground", tileset, 0, 0);
    this.elevationLayer = map.createLayer("elevation", tileset, 0, 0);
    this.collisionLayer = map.createLayer("collisions", tileset, 0, 0);
    this.terrainLayer = map.createLayer("terrain", tileset, 0, 0);

    // Set up collision detection on collision layer
    if (this.collisionLayer) {
      this.collisionLayer.setCollision([
        ...COLLISION_TILES.obstacles,
        ...COLLISION_TILES.buildings,
      ]);
    }

    // Set up collision detection on elevation layer
    if (this.elevationLayer) {
      this.elevationLayer.setCollision(COLLISION_TILES.elevation);
    }

    // Combine static layers into render texture for performance
    if (groundLayer && this.elevationLayer) {
      const staticLayersTexture = this.add.renderTexture(
        0,
        0,
        this.mapWidth,
        this.mapHeight
      );
      staticLayersTexture.setDepth(-1);
      staticLayersTexture.draw(groundLayer, 0, 0);
      staticLayersTexture.draw(this.elevationLayer, 0, 0);

      groundLayer.setVisible(true);
      this.elevationLayer.setVisible(true);
    }

    if (this.collisionLayer) {
      this.collisionLayer.setVisible(true);
    }

    if (this.terrainLayer) {
      this.terrainLayer.setVisible(true);
    }

    // Set camera bounds to map size
    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);

    // Create local player (initially invisible until server confirms position)
    this.localPlayer = this.add.circle(
      this.mapWidth / 2,
      this.mapHeight / 2,
      PLAYER_RADIUS,
      0x4a9eff
    );
    this.localPlayer.setData("playerId", "local");
    this.localPlayer.setVisible(false);
    this.localPlayer.setDepth(10); // Ensure player renders above terrain

    this.cameras.main.startFollow(this.localPlayer, true, 0.5, 0.5);

    this.cursors = this.input.keyboard?.createCursorKeys() || null;

    EventBus.on("multiplayer-game-state", this.handleGameState, this);
    EventBus.on("multiplayer-player-joined", this.handlePlayerJoined, this);
    EventBus.on("multiplayer-player-left", this.handlePlayerLeft, this);

    EventBus.emit("send-player-join");

    // Create minimap
    this.minimap = new Minimap(this, {
      worldWidth: this.mapWidth,
      worldHeight: this.mapHeight,
      width: 150,
      height: Math.floor(150 * (this.mapHeight / this.mapWidth)), // Maintain aspect ratio
      viewportScale: 0.5,
    });

    // Render collision and elevation layers on minimap
    if (this.collisionLayer && this.elevationLayer) {
      this.minimap.renderLayers(this.collisionLayer, this.elevationLayer);
    }

    EventBus?.emit("current-scene-ready", this);
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer || !this.cursors) return;

    const currentInput: InputState = {
      moveUp: this.cursors.up?.isDown || false,
      moveDown: this.cursors.down?.isDown || false,
      moveLeft: this.cursors.left?.isDown || false,
      moveRight: this.cursors.right?.isDown || false,
    };

    // Client-side prediction for immediate feedback (server is authoritative)
    if (this.localPlayer.visible) {
      // Check if player is in a slowdown zone
      const inSlowdown = this.isInSlowdownZone(
        this.localPlayer.x,
        this.localPlayer.y
      );
      const currentSpeed = inSlowdown ? SLOWDOWN_SPEED : PLAYER_SPEED;

      let velocityX = 0;
      let velocityY = 0;

      if (currentInput.moveLeft) velocityX = -currentSpeed;
      if (currentInput.moveRight) velocityX = currentSpeed;
      if (currentInput.moveUp) velocityY = -currentSpeed;
      if (currentInput.moveDown) velocityY = currentSpeed;

      const deltaSeconds = delta / 1000;
      let newX = this.localPlayer.x + velocityX * deltaSeconds;
      let newY = this.localPlayer.y + velocityY * deltaSeconds;

      // Clamp to map boundaries
      newX = Phaser.Math.Clamp(
        newX,
        PLAYER_RADIUS,
        this.mapWidth - PLAYER_RADIUS
      );
      newY = Phaser.Math.Clamp(
        newY,
        PLAYER_RADIUS,
        this.mapHeight - PLAYER_RADIUS
      );

      // Check for collision using tilemap layers
      const canMoveX = !this.isColliding(newX, this.localPlayer.y);
      const canMoveY = !this.isColliding(this.localPlayer.x, newY);

      if (canMoveX) {
        this.localPlayer.x = newX;
      }
      if (canMoveY) {
        this.localPlayer.y = newY;
      }
    }

    // Send input changes to server (event-based, only when input changes)
    if (currentInput.moveUp !== this.lastInputState.moveUp) {
      EventBus.emit("send-input-change", {
        input: "moveUp",
        pressed: currentInput.moveUp,
      });
      this.lastInputState.moveUp = currentInput.moveUp;
    }
    if (currentInput.moveDown !== this.lastInputState.moveDown) {
      EventBus.emit("send-input-change", {
        input: "moveDown",
        pressed: currentInput.moveDown,
      });
      this.lastInputState.moveDown = currentInput.moveDown;
    }
    if (currentInput.moveLeft !== this.lastInputState.moveLeft) {
      EventBus.emit("send-input-change", {
        input: "moveLeft",
        pressed: currentInput.moveLeft,
      });
      this.lastInputState.moveLeft = currentInput.moveLeft;
    }
    if (currentInput.moveRight !== this.lastInputState.moveRight) {
      EventBus.emit("send-input-change", {
        input: "moveRight",
        pressed: currentInput.moveRight,
      });
      this.lastInputState.moveRight = currentInput.moveRight;
    }

    // Update minimap
    if (this.minimap && this.localPlayer.visible) {
      this.minimap.update(this.localPlayer.x, this.localPlayer.y);
    }
  }

  /**
   * Check if a position collides with any collision tiles
   */
  private isColliding(x: number, y: number): boolean {
    // Check collision layer
    if (this.collisionLayer) {
      const tile = this.collisionLayer.getTileAtWorldXY(x, y);
      if (tile && tile.collides) {
        return true;
      }
    }

    // Check elevation layer
    if (this.elevationLayer) {
      const tile = this.elevationLayer.getTileAtWorldXY(x, y);
      if (tile && tile.collides) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a position is in a slowdown zone (quicksand, mud, etc.)
   * Returns true if the tile at position is a slowdown tile
   */
  private isInSlowdownZone(x: number, y: number): boolean {
    // No slowdown tiles defined yet - will be used when you add them to the tilemap
    if (COLLISION_TILES.slowdown.length === 0) {
      return false;
    }

    // Check terrain layer for slowdown tiles
    if (this.terrainLayer) {
      const tile = this.terrainLayer.getTileAtWorldXY(x, y);
      if (tile && COLLISION_TILES.slowdown.includes(tile.index)) {
        return true;
      }
    }

    // Also check collision layer for slowdown tiles
    if (this.collisionLayer) {
      const tile = this.collisionLayer.getTileAtWorldXY(x, y);
      if (tile && COLLISION_TILES.slowdown.includes(tile.index)) {
        return true;
      }
    }

    return false;
  }

  handleSetLocalPlayerId(data: { playerId: string }) {
    this.localPlayerId = data.playerId;
  }

  handleGameState(data: GameState) {
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

          // Correct client position towards server truth
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
            // Blend towards server position smoothly
            this.localPlayer.x = Phaser.Math.Linear(
              this.localPlayer.x,
              position.x,
              0.3
            );
            this.localPlayer.y = Phaser.Math.Linear(
              this.localPlayer.y,
              position.y,
              0.3
            );
          }
          // If within 2 pixels, trust client prediction (feels responsive)
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

  handlePlayerJoined(data: {
    playerId: string;
    username: string;
    x: number;
    y: number;
  }) {
    if (data.playerId === this.localPlayerId) return;
    if (this.players.has(data.playerId)) return;

    const player = this.add.circle(data.x, data.y, PLAYER_RADIUS, 0xff4444);
    player.setData("playerId", data.playerId);
    player.setDepth(10); // Ensure player renders above terrain
    this.players.set(data.playerId, player);

    const label = this.add
      .text(data.x, data.y - 30, data.username, {
        fontSize: "12px",
        color: "#ffffff",
        backgroundColor: "#000000",
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(11);

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

  destroy() {
    EventBus.removeListener("multiplayer-game-state");
    EventBus.removeListener("multiplayer-player-joined");
    EventBus.removeListener("multiplayer-player-left");
    EventBus.removeListener("set-local-player-id");

    this.minimap?.destroy();
    this.minimap = null;
  }
}
