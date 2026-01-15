import { GameObjects, Scene } from "phaser";

interface AloeCounterConfig {
  /** Margin from the edge of the screen */
  margin?: number;
  /** Size of the icon box */
  iconSize?: number;
  /** Spacing between elements */
  spacing?: number;
}

const DEFAULT_CONFIG: Required<AloeCounterConfig> = {
  margin: 16,
  iconSize: 32,
  spacing: 8,
};

export class AloeCounter {
  private scene: Scene;
  private config: Required<AloeCounterConfig>;
  private container: GameObjects.Container;
  private background: GameObjects.Graphics;
  private icon: GameObjects.Graphics;
  private countText: GameObjects.Text;
  private currentCount = 0;

  constructor(scene: Scene, config: AloeCounterConfig = {}) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.container = this.scene.add.container(0, 0);
    this.container.setScrollFactor(0);
    this.container.setDepth(1001);

    const size = this.config.iconSize;

    this.background = this.scene.add.graphics();
    this.background.fillStyle(0x000000, 0.6);
    this.background.fillRoundedRect(0, 0, size + 28, size, 6);
    this.background.lineStyle(1, 0x7cb342, 0.4);
    this.background.strokeRoundedRect(0, 0, size + 28, size, 6);

    this.icon = this.scene.add.graphics();
    this.drawAloe(this.icon, size / 2, size / 2, size);

    this.countText = this.scene.add.text(size + 4, size / 2, "0", {
      fontSize: "14px",
      fontStyle: "bold",
      color: "#ffffff",
    });
    this.countText.setOrigin(0, 0.5);

    this.container.add([this.background, this.icon, this.countText]);

    this.updatePosition();
    this.scene.scale.on("resize", this.updatePosition, this);
  }

  /**
   * Draw an aloe vera icon using graphics
   */
  private drawAloe(
    graphics: GameObjects.Graphics,
    centerX: number,
    centerY: number,
    size: number
  ): void {
    const leafLength = size * 0.4;
    const leafWidth = size * 0.12;

    const leafAngles = [-0.4, -0.15, 0.15, 0.4];

    for (const angleOffset of leafAngles) {
      const angle = -Math.PI / 2 + angleOffset; // Point upward with spread

      graphics.fillStyle(0x7cb342, 1);
      graphics.beginPath();

      const tipX = centerX + Math.cos(angle) * leafLength;
      const tipY = centerY + Math.sin(angle) * leafLength;
      const baseLeftX = centerX + Math.cos(angle + Math.PI / 2) * leafWidth;
      const baseLeftY = centerY + Math.sin(angle + Math.PI / 2) * leafWidth;
      const baseRightX = centerX + Math.cos(angle - Math.PI / 2) * leafWidth;
      const baseRightY = centerY + Math.sin(angle - Math.PI / 2) * leafWidth;

      graphics.moveTo(tipX, tipY);
      graphics.lineTo(baseLeftX, baseLeftY);
      graphics.lineTo(baseRightX, baseRightY);
      graphics.closePath();
      graphics.fillPath();

      graphics.lineStyle(1, 0x9ccc65, 0.8);
      graphics.beginPath();
      graphics.moveTo(centerX, centerY);
      graphics.lineTo(tipX, tipY);
      graphics.strokePath();
    }

    graphics.fillStyle(0x558b2f, 1);
    graphics.fillCircle(centerX, centerY + size * 0.1, size * 0.1);
  }

  private updatePosition(): void {
    const { width } = this.scene.scale.gameSize;
    // Position to the left of the debuff display area (which is left of minimap)
    const minimapWidth = 150;
    const debuffWidth = this.config.iconSize + this.config.spacing;
    const x =
      width -
      minimapWidth -
      this.config.margin * 2 -
      debuffWidth -
      (this.config.iconSize + 28) -
      this.config.spacing;
    const y = this.config.margin;

    this.container.setPosition(x, y);
  }

  setCount(count: number): void {
    if (count === this.currentCount) return;
    this.currentCount = count;
    this.countText.setText(String(count));
  }

  show(): void {
    this.container.setVisible(true);
  }

  hide(): void {
    this.container.setVisible(false);
  }

  destroy(): void {
    this.scene.scale.off("resize", this.updatePosition, this);
    this.container.destroy();
  }
}
