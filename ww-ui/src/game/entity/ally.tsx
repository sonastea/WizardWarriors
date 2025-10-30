import { setGameStats } from "src/state";
import { GameStats } from "src/types/index.types";
import { Game as GameScene } from "../scenes/Game";
import Entity from "./entity";

export default class Ally extends Entity {
  declare scene: GameScene;

  minDistanceToPlayer: number = 20;
  playerDetectionRange: number = 300;

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
    this.setTarget(scene.player); // allies should always be following the player

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
    return distance < this.minDistanceToPlayer;
  };

  update(_time: number, delta: number): void {
    this.timeSinceLastUpdate += delta;

    if (this.shouldUpdatePlayerTarget(delta)) {
      this.updatePlayerTarget();
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
  private shouldUpdatePlayerTarget(_delta: number): boolean {
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

    // condition 4: player is dead (game over)
    if (!this.scene.player || !this.scene.player.active) {
      return true;
    }

    return false;
  }

  /**
   * Update target to player if within detection range
   */
  private updatePlayerTarget(): void {
    const player = this.scene.player;
    if (!player) {
      this.setTarget(null);
      return;
    }

    const distanceToPlayer = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      player.x,
      player.y
    );

    if (distanceToPlayer <= this.playerDetectionRange) {
      this.setTarget(player);
    } else {
      this.setTarget(null);
    }
  }

  /**
   * Update animation based on movement direction (cached to avoid redundant plays)
   */
  private updateAnimation(): void {
    const player = this.scene.player;
    if (!player) {
      this.playAnimationCached(`${this.texture.key}-idle`);
      return;
    }

    const distance = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      player.x,
      player.y
    );

    // Standing still near player
    if (distance < this.minDistanceToPlayer) {
      this.playAnimationCached(`${this.texture.key}-idle`);
      return;
    }

    // Moving - calculate direction
    const angle = Phaser.Math.Angle.Between(this.x, this.y, player.x, player.y);
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
