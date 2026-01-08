import { GameObjects, Scene, Tilemaps } from "phaser";
import { logger } from "@utils/logger";
import { CONSTANTS } from "../constants";
import { EventBus } from "../EventBus";
import { Minimap } from "../ui/Minimap";
import type { GameState } from "@common/gen/multiplayer/v1/messages_pb";

const PLAYER_SIZE = 16;
const PLAYER_SPEED = 200;
const SLOWDOWN_SPEED = 80;

const COLLISION_TILES = {
  obstacles: [55, 56, 57, 58, 59, 60, 61, 62, 63],
  buildings: [148, 149, 150, 165, 166, 167, 182, 183, 184],
  elevation: [93, 94, 95, 111, 112, 113, 128, 129, 130],
  slowdown: [168, 169, 170, 185, 186, 187, 202, 203, 204],
};

interface InputState {
  moveUp: boolean;
  moveDown: boolean;
  moveLeft: boolean;
  moveRight: boolean;
}

interface MultiplayerPlayerData {
  sprite: GameObjects.Sprite;
  indicator: GameObjects.Graphics | null;
  lastDirection: string;
  currentAnimationKey: string;
  isEnemy: boolean;
}

export default class MultiplayerGameScene extends Scene {
  private players: Map<string, MultiplayerPlayerData> = new Map();
  private localPlayer: MultiplayerPlayerData | null = null;
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

  private createPlayerSprite(
    x: number,
    y: number,
    isEnemy: boolean
  ): MultiplayerPlayerData {
    const sprite = this.add.sprite(x, y, "multiplayer-sheet");
    sprite.setScale(2);
    sprite.setDepth(10);
    sprite.setVisible(false);

    let indicator: GameObjects.Graphics | null = null;
    if (isEnemy) {
      indicator = this.add.graphics();
      indicator.setDepth(11);
      this.drawEnemyIndicator(indicator, sprite.x, sprite.y);
    }

    sprite.play("multiplayer-idle", true);

    return {
      sprite,
      indicator,
      lastDirection: "down",
      currentAnimationKey: "multiplayer-idle",
      isEnemy,
    };
  }

  private drawEnemyIndicator(
    graphics: GameObjects.Graphics,
    x: number,
    y: number
  ): void {
    graphics.clear();

    const triangleSize = 3;
    const offsetY = -24;

    graphics.fillStyle(0xff4444, 0.9);
    graphics.beginPath();
    graphics.moveTo(x, y + offsetY + triangleSize); // Bottom point
    graphics.lineTo(x - triangleSize, y + offsetY - triangleSize); // Top left
    graphics.lineTo(x + triangleSize, y + offsetY - triangleSize); // Top right
    graphics.closePath();
    graphics.fillPath();
  }

  private updatePlayerAnimation(
    playerData: MultiplayerPlayerData,
    moving: boolean,
    direction: string
  ): void {
    if (moving) {
      playerData.lastDirection = direction;
      const animKey = `multiplayer-${direction}`;
      if (
        playerData.currentAnimationKey !== animKey &&
        this.anims.exists(animKey)
      ) {
        playerData.sprite.play(animKey, true);
        playerData.currentAnimationKey = animKey;
      }
    } else {
      if (playerData.currentAnimationKey !== "multiplayer-idle") {
        playerData.sprite.play("multiplayer-idle", true);
        playerData.currentAnimationKey = "multiplayer-idle";
      }
    }
  }

  create() {
    const map = this.make.tilemap({ key: "map" });
    const tileset = map.addTilesetImage("DesertTilemap", "tiles");
    if (!tileset) {
      logger.error("Tileset not found");
      return;
    }

    this.mapWidth = map.widthInPixels;
    this.mapHeight = map.heightInPixels;

    const groundLayer = map.createLayer("ground", tileset, 0, 0);
    this.elevationLayer = map.createLayer("elevation", tileset, 0, 0);
    this.collisionLayer = map.createLayer("collisions", tileset, 0, 0);
    this.terrainLayer = map.createLayer("terrain", tileset, 0, 0);

    if (this.collisionLayer) {
      this.collisionLayer.setCollision([
        ...COLLISION_TILES.obstacles,
        ...COLLISION_TILES.buildings,
      ]);
    }

    if (this.elevationLayer) {
      this.elevationLayer.setCollision(COLLISION_TILES.elevation);
    }

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

    this.cameras.main.setBounds(0, 0, this.mapWidth, this.mapHeight);

    this.localPlayer = this.createPlayerSprite(
      this.mapWidth / 2,
      this.mapHeight / 2,
      false
    );
    this.localPlayer.sprite.setData("playerId", "local");

    this.cameras.main.startFollow(this.localPlayer.sprite, true, 0.5, 0.5);

    this.cursors = this.input.keyboard?.createCursorKeys() || null;

    EventBus.on("multiplayer-game-state", this.handleGameState, this);
    EventBus.on("multiplayer-player-joined", this.handlePlayerJoined, this);
    EventBus.on("multiplayer-player-left", this.handlePlayerLeft, this);

    EventBus.emit("send-player-join");

    this.minimap = new Minimap(this, {
      worldWidth: this.mapWidth,
      worldHeight: this.mapHeight,
      width: 150,
      height: Math.floor(150 * (this.mapHeight / this.mapWidth)),
      viewportScale: 0.5,
    });

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

    if (this.localPlayer.sprite.visible) {
      const inSlowdown = this.isInSlowdownZone(
        this.localPlayer.sprite.x,
        this.localPlayer.sprite.y
      );
      const currentSpeed = inSlowdown ? SLOWDOWN_SPEED : PLAYER_SPEED;

      let velocityX = 0;
      let velocityY = 0;
      let moving = false;
      let direction = this.localPlayer.lastDirection;

      if (currentInput.moveLeft) {
        velocityX = -currentSpeed;
        moving = true;
        direction = "left";
      }
      if (currentInput.moveRight) {
        velocityX = currentSpeed;
        moving = true;
        direction = "right";
      }
      if (currentInput.moveUp) {
        velocityY = -currentSpeed;
        moving = true;
        direction = "up";
      }
      if (currentInput.moveDown) {
        velocityY = currentSpeed;
        moving = true;
        direction = "down";
      }

      this.updatePlayerAnimation(this.localPlayer, moving, direction);

      const deltaSeconds = delta / 1000;
      let newX = this.localPlayer.sprite.x + velocityX * deltaSeconds;
      let newY = this.localPlayer.sprite.y + velocityY * deltaSeconds;

      newX = Phaser.Math.Clamp(newX, PLAYER_SIZE, this.mapWidth - PLAYER_SIZE);
      newY = Phaser.Math.Clamp(newY, PLAYER_SIZE, this.mapHeight - PLAYER_SIZE);

      const canMoveX = !this.isColliding(newX, this.localPlayer.sprite.y);
      const canMoveY = !this.isColliding(this.localPlayer.sprite.x, newY);

      if (canMoveX) {
        this.localPlayer.sprite.x = newX;
      }
      if (canMoveY) {
        this.localPlayer.sprite.y = newY;
      }
    }

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

    if (this.minimap && this.localPlayer.sprite.visible) {
      this.minimap.update(this.localPlayer.sprite.x, this.localPlayer.sprite.y);
    }
  }

  private isColliding(x: number, y: number): boolean {
    if (this.collisionLayer) {
      const tile = this.collisionLayer.getTileAtWorldXY(x, y);
      if (tile && tile.collides) {
        return true;
      }
    }

    if (this.elevationLayer) {
      const tile = this.elevationLayer.getTileAtWorldXY(x, y);
      if (tile && tile.collides) {
        return true;
      }
    }

    return false;
  }

  private isInSlowdownZone(x: number, y: number): boolean {
    if (COLLISION_TILES.slowdown.length === 0) {
      return false;
    }

    if (this.terrainLayer) {
      const tile = this.terrainLayer.getTileAtWorldXY(x, y);
      if (tile && COLLISION_TILES.slowdown.includes(tile.index)) {
        return true;
      }
    }

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
          if (!this.localPlayer.sprite.visible) {
            this.localPlayer.sprite.setVisible(true);
          }

          const distance = Phaser.Math.Distance.Between(
            this.localPlayer.sprite.x,
            this.localPlayer.sprite.y,
            position.x,
            position.y
          );

          if (distance > 100) {
            this.localPlayer.sprite.x = position.x;
            this.localPlayer.sprite.y = position.y;
          } else if (distance > 2) {
            this.localPlayer.sprite.x = Phaser.Math.Linear(
              this.localPlayer.sprite.x,
              position.x,
              0.3
            );
            this.localPlayer.sprite.y = Phaser.Math.Linear(
              this.localPlayer.sprite.y,
              position.y,
              0.3
            );
          }
        }
      } else {
        if (!this.players.has(playerId)) {
          this.handlePlayerJoined({
            playerId: playerId,
            x: position.x,
            y: position.y,
          });
        } else {
          this.updateRemotePlayer(playerId, position.x, position.y);
        }
      }
    }
  }

  handlePlayerJoined(data: { playerId: string; x: number; y: number }) {
    if (data.playerId === this.localPlayerId) return;
    if (this.players.has(data.playerId)) return;

    const playerData = this.createPlayerSprite(data.x, data.y, true);
    playerData.sprite.setData("playerId", data.playerId);
    playerData.sprite.setVisible(true);
    this.players.set(data.playerId, playerData);

    this.minimap?.updateOtherPlayerWithVisibility(
      data.playerId,
      data.x,
      data.y
    );
  }

  handlePlayerLeft(data: { playerId: string }) {
    const playerData = this.players.get(data.playerId);
    if (playerData) {
      playerData.sprite.destroy();
      playerData.indicator?.destroy();
      this.players.delete(data.playerId);
    }

    this.minimap?.removeOtherPlayer(data.playerId);
  }

  updateRemotePlayer(playerId: string, x: number, y: number) {
    const playerData = this.players.get(playerId);

    if (playerData) {
      const prevX = playerData.sprite.x;
      const prevY = playerData.sprite.y;

      playerData.sprite.x = Phaser.Math.Linear(playerData.sprite.x, x, 0.3);
      playerData.sprite.y = Phaser.Math.Linear(playerData.sprite.y, y, 0.3);

      // Determine movement direction and update animation
      const dx = x - prevX;
      const dy = y - prevY;
      const moving = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;

      let direction = playerData.lastDirection;
      if (moving) {
        if (Math.abs(dx) > Math.abs(dy)) {
          direction = dx > 0 ? "right" : "left";
        } else {
          direction = dy > 0 ? "down" : "up";
        }
      }
      this.updatePlayerAnimation(playerData, moving, direction);

      if (playerData.indicator) {
        this.drawEnemyIndicator(
          playerData.indicator,
          playerData.sprite.x,
          playerData.sprite.y
        );
      }

      this.minimap?.updateOtherPlayerWithVisibility(
        playerId,
        playerData.sprite.x,
        playerData.sprite.y
      );
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
