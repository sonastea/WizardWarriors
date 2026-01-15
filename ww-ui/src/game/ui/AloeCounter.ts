import { GameObjects, Scene } from "phaser";

const ALOE_FRAME = 65;

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
  private icon: GameObjects.Sprite;
  private countText: GameObjects.Text;
  private currentCount = 0;

  constructor(scene: Scene, config: AloeCounterConfig = {}) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.container = this.scene.add.container(0, 0);
    this.container.setScrollFactor(0);
    this.container.setDepth(1001);

    const size = this.config.iconSize;
    const padding = 6;
    const boxWidth = size + 28;
    const boxHeight = size;

    this.background = this.scene.add.graphics();
    this.background.fillStyle(0x000000, 0.6);
    this.background.fillRoundedRect(0, 0, boxWidth, boxHeight, 6);
    this.background.lineStyle(1, 0x7cb342, 0.4);
    this.background.strokeRoundedRect(0, 0, boxWidth, boxHeight, 6);

    this.countText = this.scene.add.text(padding + 2, boxHeight / 2, "0", {
      fontSize: "14px",
      fontStyle: "bold",
      color: "#ffffff",
    });
    this.countText.setOrigin(0, 0.5);

    this.icon = this.scene.add.sprite(
      boxWidth - padding - 12,
      boxHeight / 2,
      "multiplayer-sheet",
      ALOE_FRAME
    );
    this.icon.setScale(1.25);

    this.container.add([this.background, this.icon, this.countText]);

    this.updatePosition();
    this.scene.scale.on("resize", this.updatePosition, this);
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
