import { Scene } from "phaser";
import Player from "src/game/entity/player";
import {
  getGameStats,
  isGameSaved,
  setGameSaved,
  setGameStats,
} from "src/state";
import { GameStats } from "src/types/index.types";
import { EventBus } from "../EventBus";
import { CONSTANTS, ENTITY, SCENES } from "../constants";
import Ally from "../entity/ally";
import Enemy from "../entity/enemy";
import Slime from "../entity/slime";
import { Game as GameScene } from "../scenes/Game";
import Fireball from "../entity/fireball";
import { Minimap, EnemyData } from "../ui/Minimap";

export class Game extends Scene {
  player: Player | null;

  allies!: Phaser.Physics.Arcade.Group;
  enemies!: Phaser.Physics.Arcade.Group;
  fireballPool!: Phaser.Physics.Arcade.Group;

  get getAllies(): Ally[] {
    return this.allies.getChildren() as Ally[];
  }

  get getEnemies(): Enemy[] {
    return this.enemies.getChildren() as Enemy[];
  }

  collisionLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  elevationLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  terrainLayer: Phaser.Tilemaps.TilemapLayer | null = null;

  private allySpawnTimer?: Phaser.Time.TimerEvent;
  private enemySpawnTimer?: Phaser.Time.TimerEvent;
  private minimap: Minimap | null = null;

  chatBox: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(SCENES.GAME);

    this.player = null;

    EventBus.emit("log-events", "Game started!");
  }

  loadGameStats = (gameStats: GameStats) => {
    const { player_level, total_allies, total_enemies } = gameStats;

    this.player?.setLevel(player_level);

    this.batchSpawnEntities(total_allies, total_enemies);
  };

  /**
   * Spawn entities in batches to prevent browser lockup
   * Spreads expensive spawning operations across multiple frames
   * Note: This is used for loading saved games - it does NOT increment stats
   * since the stats are already set from the save data
   */
  private batchSpawnEntities(totalAllies: number, totalEnemies: number): void {
    const BATCH_SIZE = 10;
    let alliesSpawned = 0;
    let enemiesSpawned = 0;

    const spawnBatch = () => {
      const alliesToSpawn = Math.min(BATCH_SIZE, totalAllies - alliesSpawned);
      for (let i = 0; i < alliesToSpawn; i++) {
        this.spawnEntityWithoutStats(Ally, ENTITY.ALLY, this.allies);
        alliesSpawned++;
      }

      const enemiesToSpawn = Math.min(
        BATCH_SIZE,
        totalEnemies - enemiesSpawned
      );
      for (let i = 0; i < enemiesToSpawn; i++) {
        this.spawnEntityWithoutStats(Slime, ENTITY.ENEMY.SLIME, this.enemies);
        enemiesSpawned++;
      }

      if (alliesSpawned < totalAllies || enemiesSpawned < totalEnemies) {
        this.time.delayedCall(16, spawnBatch);
      } else {
        EventBus.emit("log-events", "All entities loaded!");
      }
    };

    if (totalAllies > 0 || totalEnemies > 0) {
      spawnBatch();
    }
  }

  private spawnEntity<T extends Phaser.GameObjects.Sprite>(
    entityClass: new (
      scene: GameScene,
      x: number,
      y: number,
      type: string
    ) => T,
    entityType: string,
    group: Phaser.Physics.Arcade.Group
  ): void {
    this.spawnEntityWithoutStats(entityClass, entityType, group);
  }

  /**
   * Spawns an entity without updating game stats.
   * Used when loading saved games where stats are already set.
   */
  private spawnEntityWithoutStats<T extends Phaser.GameObjects.Sprite>(
    entityClass: new (
      scene: GameScene,
      x: number,
      y: number,
      type: string
    ) => T,
    entityType: string,
    group: Phaser.Physics.Arcade.Group
  ): void {
    let spawnX: number, spawnY: number;
    let isOverlapping: boolean;
    const MIN_DISTANCE = 64;
    const MAX_ATTEMPTS = 50;
    let attempts = 0;

    const existingEntities = group.getChildren() as T[];

    do {
      spawnX = Math.random() * this.physics.world.bounds.right;
      spawnY = Math.random() * this.physics.world.bounds.height;

      if (existingEntities.length === 0) {
        isOverlapping = false;
        break;
      }

      const minDistSq = MIN_DISTANCE * MIN_DISTANCE;
      isOverlapping = existingEntities.some((existingEntity) => {
        const dx = spawnX - existingEntity.x;
        const dy = spawnY - existingEntity.y;
        const distSq = dx * dx + dy * dy;
        return distSq < minDistSq;
      });

      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        isOverlapping = false;
      }
    } while (isOverlapping);

    new entityClass(this, spawnX, spawnY, entityType);
  }

  private setupBeforeUnload = (): void => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();

      if (!isGameSaved()) {
        EventBus.emit("save-game", getGameStats());
        setGameSaved(true);
      }
    };

    window.addEventListener("beforeunload", onBeforeUnload);
  };

  stopSpawnTimers() {
    if (this.allySpawnTimer) {
      this.allySpawnTimer.remove();
      this.allySpawnTimer = undefined;
    }

    if (this.enemySpawnTimer) {
      this.enemySpawnTimer.remove();
      this.enemySpawnTimer = undefined;
    }
  }

  gameOver() {
    this.stopSpawnTimers();

    this.player?.destroy();

    this.allies.clear(true, true);
    this.enemies.clear(true, true);

    this.player = null;

    this.minimap?.destroy();
    this.minimap = null;

    this.scene.stop();
    this.scene.start(CONSTANTS.SCENES.GAME_OVER);
  }

  spawnAlly = () => {
    this.spawnEntity(Ally, ENTITY.ALLY, this.allies);
    setGameStats((prev) => ({
      ...prev,
      total_allies: (prev.total_allies += 1),
    }));
  };

  spawnEnemy = () => {
    this.spawnEntity(Slime, ENTITY.ENEMY.SLIME, this.enemies);
    setGameStats((prev) => ({
      ...prev,
      total_enemies: (prev.total_enemies += 1),
    }));
  };

  removeFromAllies = (ally: Ally) => {
    if (!ally) return;

    setGameStats((prev) => ({
      ...prev,
      total_allies: (prev.total_allies -= 1),
    }));

    this.allies.remove(ally, true, true);
  };

  removeFromEnemies = (enemy: Enemy) => {
    if (!enemy) return;

    setGameStats((prev) => ({
      ...prev,
      total_enemies: (prev.total_enemies -= 1),
    }));

    this.enemies.remove(enemy, true, true);
  };

  create() {
    this.setupBeforeUnload();

    this.input.keyboard?.addKeys({
      esc: Phaser.Input.Keyboard.KeyCodes.ESC,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
    });

    const map = this.make.tilemap({ key: "map" });
    const tileset = map.addTilesetImage("DesertTilemap", "tiles");
    if (!tileset) return Error("Tileset not found.");

    const groundLayer = map.createLayer("ground", tileset, 0, 0);
    this.elevationLayer = map.createLayer("elevation", tileset, 0, 0);
    this.collisionLayer = map.createLayer("collisions", tileset, 0, 0);
    this.terrainLayer = map.createLayer("terrain", tileset, 0, 0);

    this.collisionLayer?.setCollisionBetween(45, 54);
    this.collisionLayer?.setCollision([
      138, 139, 140, 152, 153, 154, 166, 167, 168,
    ]);

    this.elevationLayer?.setCollisionBetween(79, 81);
    this.elevationLayer?.setCollisionBetween(93, 95);
    this.elevationLayer?.setCollisionBetween(107, 109);

    this.collisionLayer?.setTileIndexCallback(
      [
        45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 138, 139, 140, 152, 153, 154,
        166, 167, 168,
      ],
      this.onCollideWithObstacleTiles,
      this
    );

    if (groundLayer && this.elevationLayer && this.collisionLayer) {
      const mapWidth = map.widthInPixels;
      const mapHeight = map.heightInPixels;

      const staticLayersTexture = this.add.renderTexture(
        0,
        0,
        mapWidth,
        mapHeight
      );
      staticLayersTexture.setDepth(-1);

      staticLayersTexture.draw(groundLayer, 0, 0);
      staticLayersTexture.draw(this.elevationLayer, 0, 0);

      groundLayer.setVisible(true);
      this.elevationLayer.setVisible(true);
      this.collisionLayer.setVisible(true);

      this.minimap = new Minimap(this, {
        worldWidth: mapWidth,
        worldHeight: mapHeight,
        width: 150,
        height: 85,
      });

      this.minimap.renderLayers(this.collisionLayer, this.elevationLayer);
    }

    this.input?.keyboard?.on("keydown-ESC", () => {
      this.stopSpawnTimers();
      this.scene.pause();
      this.scene.run(SCENES.PAUSE);
    });

    this.player = new Player(this, 640, 310, ENTITY.PLAYER);

    this.allies = this.physics.add.group({
      classType: Ally,
      runChildUpdate: true,
    });

    this.enemies = this.physics.add.group({
      classType: Enemy,
      runChildUpdate: true,
    });

    this.fireballPool = this.physics.add.group({
      classType: Fireball,
      maxSize: 50,
      runChildUpdate: true,
      createCallback: (f) => {
        const fireball = f as Fireball;
        fireball.setName("fireball");
      },
    });

    this.physics.add.overlap(this.player, this.enemies, (player, enemy) => {
      (enemy as Enemy).attackTarget(player as Player);
    });

    this.physics.add.overlap(this.enemies, this.allies, (enemy, ally) => {
      (enemy as Enemy).attackTarget(ally as Ally);
      (ally as Ally).attackTarget(enemy as Enemy);
    });

    this.physics.add.overlap(this.fireballPool, this.enemies, (f, e) => {
      const fireball = f as Fireball;
      const enemy = e as Enemy;

      if (!fireball.active || !enemy.active) return;
      if (!fireball.body || !enemy.body) return;

      fireball.explode();
      enemy.takeDamage(fireball.damage, fireball);
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.primaryDown) return;
      this.player?.castFireball(pointer.x, pointer.y);
    });

    this.startAllySpawnLoop();
    this.startEnemySpawnLoop();

    this.loadGameStats(getGameStats());

    this.events.on("shutdown", this.stopSpawnTimers, this);
    this.events.on("pause", this.stopSpawnTimers, this);

    EventBus?.emit("current-scene-ready", this);
  }

  startAllySpawnLoop = () => {
    if (this.allySpawnTimer) {
      this.allySpawnTimer.remove();
    }

    this.allySpawnTimer = this.time.addEvent({
      delay: 5000,
      loop: true,
      callback: this.spawnAlly,
      callbackScope: this,
    });
  };

  startEnemySpawnLoop = () => {
    if (this.enemySpawnTimer) {
      this.enemySpawnTimer.remove();
    }

    const newDelay = this.getSpawnDelay(this.player?.level || 1);

    this.enemySpawnTimer = this.time.addEvent({
      delay: newDelay,
      loop: true,
      callback: this.spawnEnemy,
      callbackScope: this,
    });
  };

  private getSpawnDelay(level: number) {
    if (level > 10) return 150;

    const baseDelay = 2500;
    const decreasePerLevel = 250;

    return Math.max(150, baseDelay - level * decreasePerLevel);
  }

  private onCollideWithObstacleTiles(
    sprite: Phaser.GameObjects.GameObject,
    _tile: Phaser.Tilemaps.Tile
  ) {
    if (sprite.name !== "fireball" || !sprite.body) return;
    const fireball = sprite as Fireball;
    fireball.explode();
  }

  update(time: number, delta: number) {
    this.player?.update(time, delta);

    if (this.minimap && this.player) {
      this.minimap.update(this.player.x, this.player.y);

      const enemyData = new Map<string, EnemyData>();
      for (const enemy of this.getEnemies) {
        if (enemy.active) {
          enemyData.set(enemy.id, {
            worldX: enemy.x,
            worldY: enemy.y,
          });
        }
      }
      this.minimap.updateEnemies(enemyData);
    }
  }
}
