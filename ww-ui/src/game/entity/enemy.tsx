import { Game as GameScene } from "../scenes/Game";
import Entity from "./entity";

export default class Enemy extends Entity {
  declare scene: GameScene;

  // Spatial partitioning optimization (delta-time based)
  private timeSinceLastUpdate: number = 0; // Accumulated time in ms
  private updateInterval: number = 500; // Update every 500ms (0.5 seconds)
  private lastUpdatePosition: Phaser.Math.Vector2;
  private movementThreshold: number = 50; // Update if moved 50px
  private lastTargetDistance: number = Infinity;
  private quickCheckInterval: number = 100; // Quick escape check every 100ms
  private timeSinceQuickCheck: number = 0;

  constructor(scene: GameScene, x: number, y: number, texture: string) {
    super(scene, x, y, texture);

    this.level = 1;
    this.health = 2;
    this.baseSpeed = 75;
    this.attack = 5;

    this.scene = scene;
    this.setScale(2);
    this.setImmovable(true);
    this.setCollideWorldBounds(true);
    this.initializeHealthBar(x, y, this.width, 4);

    // Add to group (group is the single source of truth)
    scene.enemies.add(this);

    // Initialize spatial tracking
    this.lastUpdatePosition = new Phaser.Math.Vector2(x, y);

    // Randomize initial time offset to spread CPU load across frames
    this.timeSinceLastUpdate = Phaser.Math.Between(0, this.updateInterval);
    this.timeSinceQuickCheck = Phaser.Math.Between(0, this.quickCheckInterval);
  }

  setDead = () => {
    if (!this.scene) return;
    this.incPlayerKills();
    this.scene.removeFromEnemies(this);
    this.setActive(false).setVisible(false);
  };

  findClosestTarget = () => {
    let closestTarget: Entity | null = null;
    let closestDistance = this.detectionRange;

    const player = this.scene.player;

    if (player && player.active) {
      const playerDistance = Phaser.Math.Distance.Between(
        this.x,
        this.y,
        player.x,
        player.y
      );
      if (playerDistance <= this.detectionRange) {
        closestTarget = player;
        closestDistance = playerDistance;
      }
    }

    for (const ally of this.scene.getAllies) {
      if (!ally.active) continue; // Skip inactive allies

      const allyDistance = Phaser.Math.Distance.Between(
        this.x,
        this.y,
        ally.x,
        ally.y
      );
      if (allyDistance < closestDistance) {
        closestTarget = ally;
        closestDistance = allyDistance;
      }
    }

    this.setTarget(closestTarget);
  };

  setTarget = (target: Entity | null) => {
    this.target = target;
  };

  update(_time: number, delta: number): void {
    this.timeSinceLastUpdate += delta;
    this.timeSinceQuickCheck += delta;

    if (this.shouldUpdateTarget(delta)) {
      this.findClosestTarget();
      this.timeSinceLastUpdate = 0;
      this.lastUpdatePosition.set(this.x, this.y);
    }

    this.moveToTarget();
    this.playAnimationCached(this.texture.key + "-idle");
  }

  /**
   * Play animation only if different from current (avoids redundant play calls)
   */
  private playAnimationCached(key: string): void {
    if (this.lastAnimationKey !== key) {
      this.play(key, true);
      this.lastAnimationKey = key;
    }
  }

  /**
   * Spatial partitioning logic using delta-time (frame-rate independent)
   * @param delta - Time elapsed since last frame in milliseconds
   */
  private shouldUpdateTarget(_delta: number): boolean {
    // Condition 1: temporal, minimum update interval reached (500ms)
    if (this.timeSinceLastUpdate >= this.updateInterval) {
      return true;
    }

    // Condition 2: spatial, moved significantly since last update
    const distanceMoved = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      this.lastUpdatePosition.x,
      this.lastUpdatePosition.y
    );
    if (distanceMoved >= this.movementThreshold) {
      return true;
    }

    // Condition 3: no target currently set
    if (!this.target) {
      return true;
    }

    // Condition 4: current target is dead or inactive
    if (!this.target.active || this.target.health <= 0) {
      return true;
    }

    // Condition 5: target escaped detection range (quick check every 100ms)
    if (this.timeSinceQuickCheck >= this.quickCheckInterval) {
      this.timeSinceQuickCheck = 0;

      const currentTargetDistance = Phaser.Math.Distance.Between(
        this.x,
        this.y,
        this.target.x,
        this.target.y
      );

      if (currentTargetDistance > this.detectionRange * 1.5) {
        return true;
      }

      this.lastTargetDistance = currentTargetDistance;
    }

    return false;
  }
}
