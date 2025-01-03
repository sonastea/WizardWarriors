import { Game as GameScene } from "../scenes/Game";
import Enemy from "./enemy";

export default class Slime extends Enemy {
  declare scene: GameScene;

  health = 3;

  constructor(scene: GameScene, x: number, y: number, texture: string) {
    super(scene, x, y, texture);
  }

  update(): void {
    this.findClosestTarget();
    this.moveToTarget();
    this.play(this.texture.key + "-idle", true);
  }
}
