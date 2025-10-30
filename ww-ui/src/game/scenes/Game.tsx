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

  private allySpawnTimer?: Phaser.Time.TimerEvent;
  private enemySpawnTimer?: Phaser.Time.TimerEvent;

  chatBox: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(SCENES.GAME);

    this.player = null;

    EventBus.emit("log-events", "Game started!");
  }

  loadGameStats = (gameStats: GameStats) => {
    const { player_level, total_allies, total_enemies } = gameStats;

    this.player?.setLevel(player_level);

    for (let i = 0; i < total_allies; i++) {
      this.spawnAlly();
    }

    for (let i = 0; i < total_enemies; i++) {
      this.spawnEnemy();
    }
  };

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
    let spawnX: number, spawnY: number;
    let isOverlapping: boolean;

    // Get existing entities from the group
    const existingEntities = group.getChildren() as T[];

    do {
      spawnX = Math.random() * this.physics.world.bounds.right;
      spawnY = Math.random() * this.physics.world.bounds.height;

      isOverlapping = existingEntities.some((existingEntity) => {
        const distance = Phaser.Math.Distance.Between(
          spawnX,
          spawnY,
          existingEntity.x,
          existingEntity.y
        );
        return distance < existingEntity.width;
      });
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

  gameOver() {
    this.player?.destroy();

    this.allies.clear(true, true);
    this.enemies.clear(true, true);

    this.player = null;

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

    map.createLayer("ground", tileset, 0, 0);
    this.elevationLayer = map.createLayer("elevation", tileset, 0, 0);
    this.collisionLayer = map.createLayer("collisions", tileset, 0, 0);

    this.collisionLayer?.setCollisionBetween(45, 54);
    this.elevationLayer?.setCollisionBetween(79, 81);
    this.elevationLayer?.setCollisionBetween(93, 95);
    this.elevationLayer?.setCollisionBetween(107, 109);

    this.collisionLayer?.setTileIndexCallback(
      [45, 46, 47, 48, 49, 50, 51, 52, 53, 54],
      this.onCollideWithObstacleTiles,
      this
    );

    this.input?.keyboard?.on("keydown-ESC", () => {
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

    this.physics.add.overlap(this.enemies, this.player, (enemy, player) => {
      (enemy as Player).attackTarget(player as Player);
    });

    this.physics.add.overlap(this.enemies, this.allies, (enemy, ally) => {
      (enemy as Enemy).attackTarget(ally as Ally);
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
  }
}
