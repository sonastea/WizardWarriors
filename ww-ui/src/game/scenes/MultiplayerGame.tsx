import { GameObjects, Scene, Tilemaps } from "phaser";
import { logger } from "@utils/logger";
import { CONSTANTS } from "../constants";
import { EventBus } from "../EventBus";
import { Minimap } from "../ui/Minimap";
import { DebuffDisplay } from "../ui/DebuffDisplay";
import { AloeCounter } from "../ui/AloeCounter";
import { SoundManager, SoundKeys } from "../audio/SoundManager";
import type {
  GameState,
  ItemState,
  ProjectileState,
  QuicksandEvent,
} from "@common/gen/multiplayer/v1/messages_pb";
import {
  ItemType,
  ProjectileType,
} from "@common/gen/multiplayer/v1/messages_pb";

const PLAYER_SIZE = 16;
const PLAYER_SPEED = 150;
const SLOWDOWN_SPEED = 60;
const SPEED_BOOST_MULTIPLIER = 1.2;
const EVENT_SLOWDOWN_TILE_ID = 237;
const ALOE_FRAME = 65;

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
  isFrozen: boolean;
  aloeCount: number;
  speedBoostUntil: number;
  frozenParticles?: GameObjects.Particles.ParticleEmitter;
}

interface ProjectileData {
  sprite: GameObjects.Sprite;
  targetX: number;
  targetY: number;
  type: ProjectileType;
  trailEmitter?: GameObjects.Particles.ParticleEmitter;
  hasExploded?: boolean;
}

interface ItemData {
  sprite: GameObjects.Sprite;
  type: ItemType;
}

export default class MultiplayerGameScene extends Scene {
  private players: Map<string, MultiplayerPlayerData> = new Map();
  private projectiles: Map<string, ProjectileData> = new Map();
  private items: Map<string, ItemData> = new Map();
  private localPlayer: MultiplayerPlayerData | null = null;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasdKeys: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
  } | null = null;
  private localPlayerId: string | null = null;
  private minimap: Minimap | null = null;
  private debuffDisplay: DebuffDisplay | null = null;
  private aloeCounter: AloeCounter | null = null;
  private freezeParticleTexture: string = "freeze-particle";
  private explosionParticleTexture: string = "explosion-particle";
  private trailParticleTexture: string = "trail-particle";
  private soundManager: SoundManager | null = null;

  private collisionLayer: Tilemaps.TilemapLayer | null = null;
  private elevationLayer: Tilemaps.TilemapLayer | null = null;
  private terrainLayer: Tilemaps.TilemapLayer | null = null;
  private eventLayer: Tilemaps.TilemapLayer | null = null;

  private activeQuicksandTiles: Array<{ x: number; y: number }> = [];

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
      isFrozen: false,
      aloeCount: 0,
      speedBoostUntil: 0,
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
    this.eventLayer = map.createLayer("event", tileset, 0, 0);

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

    if (this.eventLayer) {
      this.eventLayer.setVisible(true);
      this.eventLayer.setDepth(5);
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
    this.wasdKeys = this.input.keyboard?.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
    }) as typeof this.wasdKeys;

    EventBus.on("multiplayer-game-state", this.handleGameState, this);
    EventBus.on("multiplayer-player-joined", this.handlePlayerJoined, this);
    EventBus.on("multiplayer-player-left", this.handlePlayerLeft, this);

    this.createFreezeParticleTexture();
    this.createExplosionParticleTexture();
    this.createTrailParticleTexture();
    this.createSnowflakeTexture();

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) {
        if (this.localPlayer?.isFrozen) {
          return;
        }
        const worldPoint = this.cameras.main.getWorldPoint(
          pointer.x,
          pointer.y
        );
        EventBus.emit("send-game-action", {
          action: "throwPotion",
          targetX: worldPoint.x,
          targetY: worldPoint.y,
        });
        this.soundManager?.play(SoundKeys.POTION_THROW);
      }
    });

    this.input.mouse?.disableContextMenu();

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

    this.debuffDisplay = new DebuffDisplay(this);
    this.aloeCounter = new AloeCounter(this);

    this.soundManager = new SoundManager(this);

    EventBus?.emit("current-scene-ready", this);
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer || !this.cursors) return;

    const isFrozen = this.localPlayer.isFrozen;

    const currentInput: InputState = {
      moveUp:
        !isFrozen &&
        (this.cursors.up?.isDown || this.wasdKeys?.W.isDown || false),
      moveDown:
        !isFrozen &&
        (this.cursors.down?.isDown || this.wasdKeys?.S.isDown || false),
      moveLeft:
        !isFrozen &&
        (this.cursors.left?.isDown || this.wasdKeys?.A.isDown || false),
      moveRight:
        !isFrozen &&
        (this.cursors.right?.isDown || this.wasdKeys?.D.isDown || false),
    };

    if (this.localPlayer.sprite.visible) {
      const inSlowdown = this.isInSlowdownZone(
        this.localPlayer.sprite.x,
        this.localPlayer.sprite.y
      );
      const baseSpeed = inSlowdown ? SLOWDOWN_SPEED : PLAYER_SPEED;
      const nowSeconds = Date.now() / 1000;
      const hasSpeedBoost = this.localPlayer.speedBoostUntil > nowSeconds;
      const currentSpeed = hasSpeedBoost
        ? baseSpeed * SPEED_BOOST_MULTIPLIER
        : baseSpeed;

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

      this.soundManager?.updateFootsteps(moving);

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

    if (this.eventLayer) {
      const tile = this.eventLayer.getTileAtWorldXY(x, y);
      if (tile && tile.index === EVENT_SLOWDOWN_TILE_ID) {
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

          this.setPlayerFrozen(this.localPlayer, playerState.isFrozen);
          if (playerState.aloeCount > this.localPlayer.aloeCount) {
            this.soundManager?.play(SoundKeys.PICKUP);
          }
          this.localPlayer.aloeCount = playerState.aloeCount;
          this.localPlayer.speedBoostUntil = playerState.speedBoostUntil;
          this.aloeCounter?.setCount(playerState.aloeCount);

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
          this.updateRemotePlayer(
            playerId,
            position.x,
            position.y,
            playerState.isFrozen,
            playerState.aloeCount,
            playerState.speedBoostUntil
          );
        }
      }
    }

    if (data.projectiles) {
      this.updateProjectiles(data.projectiles);
    }

    if (data.items) {
      this.updateItems(data.items);
    } else {
      this.updateItems([]);
    }

    this.updateQuicksandEvent(data.quicksandEvent);
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

  updateRemotePlayer(
    playerId: string,
    x: number,
    y: number,
    isFrozen: boolean = false,
    aloeCount: number = 0,
    speedBoostUntil: number = 0
  ) {
    const playerData = this.players.get(playerId);

    if (playerData) {
      const prevX = playerData.sprite.x;
      const prevY = playerData.sprite.y;

      playerData.sprite.x = Phaser.Math.Linear(playerData.sprite.x, x, 0.3);
      playerData.sprite.y = Phaser.Math.Linear(playerData.sprite.y, y, 0.3);

      this.setPlayerFrozen(playerData, isFrozen);
      playerData.aloeCount = aloeCount;
      playerData.speedBoostUntil = speedBoostUntil;

      if (!isFrozen) {
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
      }

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

  /**
   * Generate placeholder particle texture for freeze effects
   */
  private createFreezeParticleTexture(): void {
    // Check if texture already exists
    if (this.textures.exists(this.freezeParticleTexture)) {
      return;
    }

    const graphics = this.make.graphics({ x: 0, y: 0 });

    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(4, 4, 4);
    graphics.fillStyle(0x88ccff, 0.8);
    graphics.fillCircle(4, 4, 2);
    graphics.generateTexture(this.freezeParticleTexture, 8, 8);
    graphics.destroy();
  }

  /**
   * Generate particle texture for explosion effects - sharp ice shard
   */
  private createExplosionParticleTexture(): void {
    if (this.textures.exists(this.explosionParticleTexture)) {
      return;
    }

    const graphics = this.make.graphics({ x: 0, y: 0 });

    // Create a sharp elongated ice shard
    graphics.fillStyle(0xffffff, 1);
    graphics.beginPath();
    graphics.moveTo(4, 0); // top point
    graphics.lineTo(6, 5);
    graphics.lineTo(4, 16); // bottom point
    graphics.lineTo(2, 5);
    graphics.closePath();
    graphics.fillPath();

    graphics.generateTexture(this.explosionParticleTexture, 8, 16);
    graphics.destroy();
  }

  /**
   * Generate snowflake particle texture for frozen effect
   */
  private createSnowflakeTexture(): void {
    if (this.textures.exists("snowflake-particle")) {
      return;
    }

    const graphics = this.make.graphics({ x: 0, y: 0 });

    // Draw a simple 6-pointed snowflake
    const cx = 6;
    const cy = 6;
    const len = 5;

    graphics.lineStyle(1, 0xffffff, 1);

    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const endX = cx + Math.cos(angle) * len;
      const endY = cy + Math.sin(angle) * len;
      graphics.beginPath();
      graphics.moveTo(cx, cy);
      graphics.lineTo(endX, endY);
      graphics.strokePath();
    }

    graphics.generateTexture("snowflake-particle", 12, 12);
    graphics.destroy();
  }

  /**
   * Generate particle texture for projectile trail effects
   */
  private createTrailParticleTexture(): void {
    if (this.textures.exists(this.trailParticleTexture)) {
      return;
    }

    const graphics = this.make.graphics({ x: 0, y: 0 });

    // Create a small bright icy particle for the trail
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(4, 4, 4);
    graphics.fillStyle(0xf0ffff, 0.9);
    graphics.fillCircle(4, 4, 2);
    graphics.generateTexture(this.trailParticleTexture, 8, 8);
    graphics.destroy();
  }

  /**
   * Create a frozen explosion effect - ice shards, snowflakes, and cold mist
   */
  private createExplosionEffect(x: number, y: number): void {
    const shardEmitter = this.add.particles(
      x,
      y,
      this.explosionParticleTexture,
      {
        speed: { min: 10, max: 25 },
        scale: { start: 0.4, end: 0.1 },
        alpha: { start: 0.9, end: 0 },
        lifespan: { min: 200, max: 400 },
        angle: { min: 0, max: 360 },
        quantity: 4,
        tint: 0xffffff,
        rotate: { start: 0, end: 45 },
        emitting: false,
      }
    );
    shardEmitter.setDepth(16);
    shardEmitter.explode();

    const snowflakeEmitter = this.add.particles(x, y, "snowflake-particle", {
      speed: { min: 4, max: 15 },
      scale: { start: 0.3, end: 0.05 },
      alpha: { start: 0.7, end: 0 },
      lifespan: { min: 300, max: 500 },
      angle: { min: 220, max: 320 },
      quantity: 3,
      tint: 0xffffff,
      rotate: { start: 0, end: 90 },
      emitting: false,
    });
    snowflakeEmitter.setDepth(17);
    snowflakeEmitter.explode();

    const groundFrostEmitter = this.add.particles(
      x,
      y,
      this.freezeParticleTexture,
      {
        speed: { min: 3, max: 7 },
        scale: { start: 0.15, end: 0.35 },
        alpha: { start: 0.4, end: 0 },
        lifespan: { min: 500, max: 900 },
        angle: { min: 0, max: 360 },
        quantity: 4,
        tint: [0xffffff, 0xe8f4ff],
        emitting: false,
      }
    );
    groundFrostEmitter.setDepth(14);
    groundFrostEmitter.explode();

    const chillEmitter = this.add.particles(x, y, this.freezeParticleTexture, {
      speedX: { min: -2, max: 1 },
      speedY: { min: -5, max: -2 },
      scale: { start: 0.08, end: 0.3 },
      alpha: { start: 0.15, end: 0 },
      lifespan: { min: 1200, max: 2000 },
      frequency: 800,
      quantity: 1,
      tint: 0xffffff,
      emitting: true,
    });
    chillEmitter.setDepth(15);

    // Stop chill after a while, then clean up
    this.time.delayedCall(3000, () => {
      chillEmitter.stop();
    });

    this.time.delayedCall(4000, () => {
      shardEmitter.destroy();
      snowflakeEmitter.destroy();
      groundFrostEmitter.destroy();
      chillEmitter.destroy();
    });
  }

  /**
   * Set frozen state visual for a player
   */
  private setPlayerFrozen(
    playerData: MultiplayerPlayerData,
    frozen: boolean
  ): void {
    if (frozen === playerData.isFrozen) return;

    playerData.isFrozen = frozen;

    if (playerData === this.localPlayer && this.debuffDisplay) {
      this.debuffDisplay.setDebuff("frozen", frozen);
    }

    if (frozen && playerData === this.localPlayer) {
      this.soundManager?.play(SoundKeys.PLAYER_FROZEN);
      this.soundManager?.stopFootsteps();
    }

    if (frozen) {
      playerData.sprite.setTint(0x88ccff);

      if (!playerData.frozenParticles) {
        playerData.frozenParticles = this.add.particles(
          playerData.sprite.x,
          playerData.sprite.y,
          this.freezeParticleTexture,
          {
            speed: { min: 10, max: 30 },
            scale: { start: 0.5, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: 800,
            frequency: 100,
            quantity: 1,
            follow: playerData.sprite,
            tint: 0x88ccff,
          }
        );
        playerData.frozenParticles.setDepth(12);
      }
    } else {
      playerData.sprite.clearTint();
      if (playerData.frozenParticles) {
        playerData.frozenParticles.stop();
        playerData.frozenParticles.destroy();
        playerData.frozenParticles = undefined;
      }
    }
  }

  /**
   * Update projectiles from server state
   */
  private updateProjectiles(projectileStates: ProjectileState[]): void {
    const activeIds = new Set<string>();

    for (const state of projectileStates) {
      if (!state.projectileId || !state.position) continue;

      activeIds.add(state.projectileId);

      let projectileData = this.projectiles.get(state.projectileId);

      // Don't create new projectiles that are already inactive (exploded)
      if (!projectileData && !state.active) {
        continue;
      }

      if (!projectileData) {
        const sprite = this.add.sprite(
          state.position.x,
          state.position.y,
          "potion-idle"
        );
        sprite.setScale(1);
        sprite.setDepth(15);

        const angle = state.target
          ? Phaser.Math.Angle.Between(
              state.position.x,
              state.position.y,
              state.target.x,
              state.target.y
            )
          : 0;
        sprite.setRotation(angle);

        sprite.play("potion-idle");
        sprite.chain("potion-flying");

        // Create trail particle emitter that follows the projectile
        const trailEmitter = this.add.particles(
          0,
          0,
          this.trailParticleTexture,
          {
            speed: { min: 5, max: 15 },
            scale: { start: 0.4, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: { min: 200, max: 350 },
            frequency: 10,
            quantity: 1,
            follow: sprite,
            tint: [0xffffff, 0xeeffff, 0xccf0ff],
            blendMode: Phaser.BlendModes.ADD,
          }
        );
        trailEmitter.setDepth(14);

        projectileData = {
          sprite,
          targetX: state.target?.x ?? state.position.x,
          targetY: state.target?.y ?? state.position.y,
          type: state.type,
          trailEmitter,
        };
        this.projectiles.set(state.projectileId, projectileData);
      }

      if (state.active && state.position) {
        projectileData.sprite.x = Phaser.Math.Linear(
          projectileData.sprite.x,
          state.position.x,
          0.5
        );
        projectileData.sprite.y = Phaser.Math.Linear(
          projectileData.sprite.y,
          state.position.y,
          0.5
        );
        projectileData.sprite.setVisible(true);
      } else {
        // The server says the projectile is dead (impacted)
        // Only handle explosion once per projectile
        if (!state.active && !projectileData.hasExploded) {
          projectileData.hasExploded = true;

          projectileData.sprite.x = state.position.x;
          projectileData.sprite.y = state.position.y;
          projectileData.sprite.play("potion-explode");

          // Stop and destroy trail emitter
          if (projectileData.trailEmitter) {
            projectileData.trailEmitter.stop();
            projectileData.trailEmitter.destroy();
            projectileData.trailEmitter = undefined;
          }

          // Create lively cold explosion effect
          this.createExplosionEffect(state.position.x, state.position.y);

          this.soundManager?.play(SoundKeys.POTION_EXPLODE);

          this.time.delayedCall(300, () => {
            projectileData.sprite.destroy();
            this.projectiles.delete(state.projectileId);
          });
        }
      }
    }

    this.projectiles.forEach((data, id) => {
      if (!activeIds.has(id)) {
        if (data.trailEmitter) {
          data.trailEmitter.stop();
          data.trailEmitter.destroy();
        }
        data.sprite.destroy();
        this.projectiles.delete(id);
      }
    });
  }

  private updateItems(itemStates: ItemState[]): void {
    const activeIds = new Set<string>();

    for (const state of itemStates) {
      if (!state.itemId || !state.position) continue;
      if (!state.active) {
        continue;
      }

      activeIds.add(state.itemId);

      let itemData = this.items.get(state.itemId);
      if (!itemData) {
        const sprite = this.add.sprite(
          state.position.x,
          state.position.y,
          "multiplayer-sheet",
          ALOE_FRAME
        );
        sprite.setDepth(9);

        itemData = {
          sprite,
          type: state.type,
        };
        this.items.set(state.itemId, itemData);
      }

      itemData.sprite.x = state.position.x;
      itemData.sprite.y = state.position.y;
      itemData.sprite.setVisible(true);
    }

    this.items.forEach((data, id) => {
      if (!activeIds.has(id)) {
        data.sprite.destroy();
        this.items.delete(id);
      }
    });
  }

  private updateQuicksandEvent(event?: QuicksandEvent): void {
    if (!this.eventLayer) return;

    this.clearQuicksandTiles();

    if (!event || event.tiles.length === 0) {
      return;
    }

    const tileId = event.tileId || EVENT_SLOWDOWN_TILE_ID;
    const layerWidth = this.eventLayer.layer.width;
    const layerHeight = this.eventLayer.layer.height;
    for (const tile of event.tiles) {
      if (
        tile.x < 0 ||
        tile.y < 0 ||
        tile.x >= layerWidth ||
        tile.y >= layerHeight
      ) {
        continue;
      }
      this.eventLayer.putTileAt(tileId, tile.x, tile.y);
      this.activeQuicksandTiles.push({ x: tile.x, y: tile.y });
    }
  }

  private clearQuicksandTiles(): void {
    if (!this.eventLayer || this.activeQuicksandTiles.length === 0) {
      this.activeQuicksandTiles = [];
      return;
    }

    const layerWidth = this.eventLayer.layer.width;
    const layerHeight = this.eventLayer.layer.height;
    for (const tile of this.activeQuicksandTiles) {
      if (
        tile.x < 0 ||
        tile.y < 0 ||
        tile.x >= layerWidth ||
        tile.y >= layerHeight
      ) {
        continue;
      }
      this.eventLayer.removeTileAt(tile.x, tile.y);
    }

    this.activeQuicksandTiles = [];
  }

  destroy() {
    EventBus.removeListener("multiplayer-game-state");
    EventBus.removeListener("multiplayer-player-joined");
    EventBus.removeListener("multiplayer-player-left");
    EventBus.removeListener("set-local-player-id");

    this.items.forEach((data) => {
      data.sprite.destroy();
    });
    this.items.clear();
    this.clearQuicksandTiles();

    this.projectiles.forEach((data) => {
      if (data.trailEmitter) {
        data.trailEmitter.stop();
        data.trailEmitter.destroy();
      }
      data.sprite.destroy();
    });
    this.projectiles.clear();

    this.players.forEach((data) => {
      if (data.frozenParticles) {
        data.frozenParticles.destroy();
      }
    });

    if (this.localPlayer?.frozenParticles) {
      this.localPlayer.frozenParticles.destroy();
    }

    this.minimap?.destroy();
    this.minimap = null;

    this.debuffDisplay?.destroy();
    this.debuffDisplay = null;

    this.aloeCounter?.destroy();
    this.aloeCounter = null;

    this.soundManager?.destroy();
    this.soundManager = null;
  }
}
