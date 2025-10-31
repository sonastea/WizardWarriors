import { setGameStats } from "src/state";
import { GameStats } from "src/types/index.types";
import { Game as GameScene } from "../scenes/Game";
import Entity from "./entity";

export default class Ally extends Entity {
  declare scene: GameScene;

  minDistanceToPlayer: number = 20;
  playerFollowRange: number = 300;
  enemyDetectionRange: number = 200;

  // spatial partitioning optimization (delta-time based)
  private timeSinceLastUpdate: number = 0;
  private updateInterval: number = 333;
  private lastUpdatePosition: Phaser.Math.Vector2;
  private movementThreshold: number = 40;

  constructor(scene: GameScene, x: number, y: number, texture: string) {
    super(scene, x, y, texture);

    this.level = 1;
    this.health = 100;
    this.speed = 100;
    this.attack = 2;

    this.scene = scene;
    this.setScale(2);
    this.setCollideWorldBounds(true);
    this.initializeHealthBar(x, y, this.width, 4);
    this.setTarget(null);

    scene.allies.add(this);

    this.lastUpdatePosition = new Phaser.Math.Vector2(x, y);
    this.timeSinceLastUpdate = Phaser.Math.Between(0, this.updateInterval);
  }

  setDead = () => {
    if (!this.scene) return;
    this.setActive(false).setVisible(false);
    this.scene.removeFromAllies(this);
  };

  incPlayerKills = () => {
    // TODO: Add friendly ally kills?
    setGameStats((prev: GameStats) => ({
      ...prev,
      team_kills: prev.team_kills + 1,
    }));
  };

  shouldStopMoving = (distance: number): boolean => {
    if (this.target === this.scene.player) {
      return distance < this.minDistanceToPlayer;
    }
    return false;
  };

  update(_time: number, delta: number): void {
    this.timeSinceLastUpdate += delta;

    if (this.shouldUpdateTarget(delta)) {
      this.updateTarget();
      this.timeSinceLastUpdate = 0;
      this.lastUpdatePosition.set(this.x, this.y);
    }

    this.moveToTarget();
    this.updateAnimation();
  }

  /**
   * Spatial partitioning logic using delta-time (frame-rate independent)
   * @param delta - Time elapsed since last frame in milliseconds
   */
  private shouldUpdateTarget(_delta: number): boolean {
    // condition 1: temporal, minimum update interval reached (333ms)
    if (this.timeSinceLastUpdate >= this.updateInterval) {
      return true;
    }

    // Condition 2: Spatial, moved significantly since last update
    const distanceMoved = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      this.lastUpdatePosition.x,
      this.lastUpdatePosition.y
    );
    if (distanceMoved >= this.movementThreshold) {
      return true;
    }

    // condition 3: no target currently set
    if (!this.target) {
      return true;
    }

    // condition 4: target is dead/inactive
    if (!this.target.active) {
      return true;
    }

    // condition 5: player is dead (game over)
    if (!this.scene.player || !this.scene.player.active) {
      return true;
    }

    return false;
  }

  /**
   * Update target based on proximity:
   * - If player is within followRange, follow player
   * - Otherwise, look for nearby enemies
   */
  private updateTarget(): void {
    const player = this.scene.player;
    if (!player || !player.active) {
      this.setTarget(null);
      return;
    }

    const distanceToPlayer = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      player.x,
      player.y
    );

    // priorty 1: follow player if within range
    if (distanceToPlayer <= this.playerFollowRange) {
      this.setTarget(player);
      return;
    }

    // priority 2: look for nearby enemies
    const nearbyEnemy = this.findNearestEnemy();
    if (nearbyEnemy) {
      this.setTarget(nearbyEnemy);
      return;
    }

    this.setTarget(null);
  }

  /**
   * Find the nearest enemy within detection range
   */
  private findNearestEnemy(): Entity | null {
    const enemies = this.scene.enemies.getChildren() as Entity[];
    let nearestEnemy: Entity | null = null;
    let nearestDistanceSq = this.enemyDetectionRange * this.enemyDetectionRange;

    for (const enemy of enemies) {
      if (!enemy.active) continue;

      const dx = enemy.x - this.x;
      const dy = enemy.y - this.y;
      const distanceSq = dx * dx + dy * dy;

      if (distanceSq < nearestDistanceSq) {
        nearestDistanceSq = distanceSq;
        nearestEnemy = enemy;
      }
    }

    return nearestEnemy;
  }

  /**
   * Update animation based on movement direction (cached to avoid redundant plays)
   */
  private updateAnimation(): void {
    if (!this.target) {
      this.playAnimationCached(`${this.texture.key}-idle`);
      return;
    }

    const distance = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      this.target.x,
      this.target.y
    );

    // standing still near target (only applies to player)
    if (
      this.target === this.scene.player &&
      distance < this.minDistanceToPlayer
    ) {
      this.playAnimationCached(`${this.texture.key}-idle`);
      return;
    }

    const angle = Phaser.Math.Angle.Between(
      this.x,
      this.y,
      this.target.x,
      this.target.y
    );
    const RIGHT_BOUNDARY = Math.PI / 4;
    const LEFT_BOUNDARY = -Math.PI / 4;
    const UP_BOUNDARY = -(3 * Math.PI) / 4;
    const DOWN_BOUNDARY = (3 * Math.PI) / 4;

    if (angle >= LEFT_BOUNDARY && angle <= RIGHT_BOUNDARY) {
      this.setFlipX(true);
      this.playAnimationCached(`${this.texture.key}-right`);
    } else if (angle > RIGHT_BOUNDARY && angle < DOWN_BOUNDARY) {
      this.playAnimationCached(`${this.texture.key}-down`);
    } else if (angle <= LEFT_BOUNDARY && angle > UP_BOUNDARY) {
      this.playAnimationCached(`${this.texture.key}-up`);
    } else {
      this.setFlipX(false);
      this.playAnimationCached(`${this.texture.key}-left`);
    }
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
}
