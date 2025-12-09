import { setGameStats } from "src/state";
import { GameStats } from "src/types/index.types";
import { Game as GameScene } from "../scenes/Game";
import HealthBar from "./healthbar";
import Player from "./player";
import Projectile from "./projectile";
import { EventBus } from "../EventBus";
import Ally from "./ally";

export const TERRAIN_TILES = {
  // Water tiles (impassable) - using tile indices 29-32 (row 2, columns 0-3)
  WATER: [29, 30, 31, 32],
  // Slowdown tiles (quicksand/mud) - using tile indices 43-44 (row 3, columns 0-1)
  SLOWDOWN: [43, 44, 45],
};

export const SLOWDOWN_MULTIPLIER = 0.4; // 40% of normal speed

export default class Entity extends Phaser.Physics.Arcade.Sprite {
  declare scene: GameScene;

  id: string;
  level: number = 1;
  attack: number = 1;
  health: number = 100;
  baseSpeed: number = 100;
  speedModifier: number = 1.0;

  get speed(): number {
    return this.baseSpeed * this.speedModifier;
  }

  healthBar!: HealthBar;

  // also used for checking if an entity is close to the player
  minDistanceToPlayer: number = 20;

  // used for checking if an entity is close to an enemy
  detectionRange: number = 200;
  target: Entity | null = null;

  damageCooldowns = new Set<string>();

  protected lastAnimationKey: string = "";

  constructor(scene: GameScene, x: number, y: number, texture: string) {
    super(scene, x, y, texture);

    this.id = Phaser.Math.RND.uuid();
    this.name = texture;

    scene.add.existing(this);
    scene.physics.add.existing(this, false);

    scene.physics.add.collider(this, scene.collisionLayer!);
    scene.physics.add.collider(this, scene.elevationLayer!);
    
    if (scene.terrainLayer) {
      scene.physics.add.collider(this, scene.terrainLayer);
    }
  }

  initializeHealthBar(
    x: number,
    y: number,
    width: number,
    height: number
  ): void {
    this.healthBar = new HealthBar(
      this.scene,
      x - this.displayWidth / 1.9,
      y + this.displayHeight / 1.5,
      width * 2.05,
      height,
      this.health
    );
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    this.healthBar.setPosition(
      this.x - this.displayWidth / 2,
      this.y + this.displayHeight / 1.5
    );

    this.updateTerrainEffects();
  }

  /**
   * Check current tile for terrain effects and update speed modifier
   */
  protected updateTerrainEffects(): void {
    if (!this.scene.terrainLayer) {
      this.speedModifier = 1.0;
      return;
    }

    const tile = this.scene.terrainLayer.getTileAtWorldXY(this.x, this.y);
    
    if (tile && TERRAIN_TILES.SLOWDOWN.includes(tile.index)) {
      this.speedModifier = SLOWDOWN_MULTIPLIER;
    } else {
      this.speedModifier = 1.0;
    }
  }

  destroy(fromScene?: boolean): void {
    super.destroy(fromScene);

    this.healthBar.destroy();
  }

  findClosestTarget = () => {};
  setDead = () => {};

  setLevel = (level: number) => {
    this.level = level;
  };

  setHealth = (health: number) => {
    this.health = health;
  };

  incPlayerKills = () => {
    setGameStats((prev: GameStats) => {
      const newPlayerKills = prev.player_kills + 1;
      const newPlayerLevel = Math.floor(
        1 + Math.sqrt(1 + 8 * newPlayerKills) / 2
      );

      if (newPlayerLevel > prev.player_level) {
        this.scene.startEnemySpawnLoop(); // we would want to spawn more enemies on level up
        EventBus.emit(
          "log-events",
          `You have reached level ${newPlayerLevel}!`
        );
      }

      return {
        ...prev,
        player_level: newPlayerLevel,
        player_kills: prev.player_kills + 1,
      };
    });
  };

  takeDamage = (
    damage: number,
    attacker?: Player | Ally | Entity | Projectile
  ) => {
    if (!attacker) return;
    if (this.damageCooldowns.has(attacker?.id)) {
      return;
    }

    this.damageCooldowns.add(attacker?.id);
    this.scene?.time?.delayedCall(250, () => {
      this.damageCooldowns.delete(attacker?.id);
    });

    this.setTint(0xff6666);
    this.health -= damage;
    this.healthBar.updateHealth(this.health);
    this.logDamage(damage, attacker?.name);

    const delayedCall = this.scene.time.delayedCall(500, () => {
      this.clearTint();
    });
    const delayedDeath = this.scene.time.delayedCall(750, () => {
      if (this.health <= 0) {
        delayedCall.remove();
        delayedDeath.remove();
        this.setDead();
      }
    });
  };

  attackTarget = (target: Entity): void => {
    if (!target) return;
    target.takeDamage(this.attack, this);
  };

  logDamage = (amount: number, attackerName?: string): void => {
    EventBus.emit(
      "log-damage",
      `[${new Date().toLocaleTimeString("en-US").replace(/AM|PM/, "").trim()}] ${this.name}-${this.id} took ${amount} damage from ${attackerName}!`
    );
  };

  setTarget = (target: Entity | null) => {
    this.target = target;
  };

  moveToTarget = () => {
    const target = this.getTarget();
    if (!target || this.health <= 0) {
      this.setVelocity(0, 0);
      return;
    }

    const distance = Phaser.Math.Distance.Between(
      this.x,
      this.y,
      target.x,
      target.y
    );

    if (this.shouldStopMoving(distance)) {
      this.setVelocity(0, 0);
      return;
    }

    const angle = Phaser.Math.Angle.Between(this.x, this.y, target.x, target.y);
    this.setVelocity(
      Math.cos(angle) * this.speed,
      Math.sin(angle) * this.speed
    );
  };

  getTarget = (): Entity | null => {
    return this.target;
  };

  shouldStopMoving = (_distance: number): boolean => {
    return false;
  };
}
