import { ANIMS, ENTITY } from "../constants";
import { Game as GameScene } from "../scenes/Game";
import Ally from "./ally";
import Enemy from "./enemy";
import Entity from "./entity";
import Fireball from "./fireball";
import Projectile from "./projectile";

export default class Player extends Entity {
  declare scene: GameScene;

  private keys: {
    W: Phaser.Input.Keyboard.Key;
    A: Phaser.Input.Keyboard.Key;
    S: Phaser.Input.Keyboard.Key;
    D: Phaser.Input.Keyboard.Key;
    UP: Phaser.Input.Keyboard.Key;
    DOWN: Phaser.Input.Keyboard.Key;
    LEFT: Phaser.Input.Keyboard.Key;
    RIGHT: Phaser.Input.Keyboard.Key;
  };

  constructor(scene: GameScene, x: number, y: number, texture: string) {
    super(scene, x, y, texture);

    this.scene = scene;
    this.setScale(2);
    this.setImmovable(true);
    this.setCollideWorldBounds(true);

    this.initializeHealthBar(x, y, this.width, 4);

    // Initialize keyboard keys once during construction
    this.keys = {
      W: scene.input.keyboard!.addKey("w"),
      A: scene.input.keyboard!.addKey("a"),
      S: scene.input.keyboard!.addKey("s"),
      D: scene.input.keyboard!.addKey("d"),
      UP: scene.input.keyboard!.addKey("up"),
      DOWN: scene.input.keyboard!.addKey("down"),
      LEFT: scene.input.keyboard!.addKey("left"),
      RIGHT: scene.input.keyboard!.addKey("right"),
    };
  }

  incPlayerKills = () => {};

  attackTarget = (target: Ally | Enemy) => {
    if (!target) return;
    target.takeDamage(this.attack, this);
  };

  castFireball = (destX: number, destY: number) => {
    const angle = Phaser.Math.Angle.Between(this.x, this.y, destX, destY);
    const fireball = new Fireball(
      this.scene,
      this.x,
      this.y,
      destX,
      destY,
      this.attack,
      ENTITY.SKILL.FIREBALL
    );

    fireball.setRotation(angle);
    fireball.setVelocity(
      Math.cos(angle) * fireball.speed,
      Math.sin(angle) * fireball.speed
    );
  };

  takeDamage = (damage: number, attacker?: Player | Entity | Projectile) => {
    if (!attacker) return;
    if (this.damageCooldowns.has(attacker.id)) {
      return;
    }

    this.damageCooldowns.add(attacker.id);
    this.scene?.time?.delayedCall(350, () => {
      this.damageCooldowns.delete(attacker.id);
    });

    this.setTint(0xff6666);
    this.health -= damage;
    this.logDamage(damage, attacker?.name);

    if (!this.scene || !this.scene.time) return;

    this.scene?.time?.delayedCall(350, () => {
      this.healthBar.updateHealth(this.health);
      this.clearTint();
      if (this.health <= 0) {
        this.scene?.time?.delayedCall(150, () => {
          this.setActive(false).setVisible(false);
        });
        this.scene?.gameOver();
      }
    });
  };

  update(_time: number, _delta: number): void {
    if (!this.scene.input.keyboard) return;

    if (this.keys.W.isDown || this.keys.UP.isDown) {
      this.setVelocityY(-1 * this.speed);
      this.play(ANIMS.PLAYER.UP, true);
    } else if (this.keys.A.isDown || this.keys.LEFT.isDown) {
      this.setVelocityX(-1 * this.speed);
      this.play(ANIMS.PLAYER.LEFT, true);
    } else if (this.keys.S.isDown || this.keys.DOWN.isDown) {
      this.setVelocityY(1 * this.speed);
      this.play(ANIMS.PLAYER.DOWN, true);
    } else if (this.keys.D.isDown || this.keys.RIGHT.isDown) {
      this.setVelocityX(1 * this.speed);
      this.play(ANIMS.PLAYER.RIGHT, true);
    } else {
      this.setVelocityX(0);
      this.setVelocityY(0);

      this.play(ANIMS.PLAYER.IDLE);
    }
  }
}
