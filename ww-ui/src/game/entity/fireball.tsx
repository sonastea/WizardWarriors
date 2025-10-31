import { ANIMS } from "../constants";
import { Game as GameScene } from "../scenes/Game";
import Projectile from "./projectile";

export default class Fireball extends Projectile {
  damage: number;

  constructor(
    scene: GameScene,
    x: number,
    y: number,
    texture: string = "fireball"
  ) {
    super(scene, x, y, texture);

    this.damage = 0;
    this.speed = 250;
    this.setScale(2);
    this.setActive(false);
    this.setVisible(false);
  }

  fire(x: number, y: number, destX: number, destY: number, damage: number) {
    this.setPosition(x, y);
    this.setActive(true);
    this.setVisible(true);
    this.damage = damage;

    const angle = Phaser.Math.Angle.Between(x, y, destX, destY);
    this.setRotation(angle);
    this.setVelocity(
      Math.cos(angle) * this.speed,
      Math.sin(angle) * this.speed
    );

    this.play(ANIMS.SKILL.FIREBALL);
  }

  explode() {
    if (!this.body) return;

    this.setVelocity(0, 0);
    this.setActive(false);
    this.setVisible(false);
    this.setRotation(0);
  }

  preUpdate(time: number, delta: number) {
    super.preUpdate(time, delta);

    if (
      !this.scene ||
      !this.scene.physics.world.bounds.contains(this.x, this.y)
    ) {
      this.explode();
    }
  }
}
