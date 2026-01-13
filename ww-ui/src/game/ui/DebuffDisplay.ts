import { GameObjects, Scene } from "phaser";

export type DebuffType = "frozen";

interface DebuffConfig {
  /** Margin from the edge of the screen */
  margin?: number;
  /** Size of each debuff icon */
  iconSize?: number;
  /** Spacing between icons */
  spacing?: number;
}

const DEFAULT_CONFIG: Required<DebuffConfig> = {
  margin: 16,
  iconSize: 32,
  spacing: 8,
};

interface DebuffIcon {
  container: GameObjects.Container;
  background: GameObjects.Graphics;
  icon: GameObjects.Graphics;
  active: boolean;
}

export class DebuffDisplay {
  private scene: Scene;
  private config: Required<DebuffConfig>;
  private container: GameObjects.Container;
  private debuffs: Map<DebuffType, DebuffIcon> = new Map();

  constructor(scene: Scene, config: DebuffConfig = {}) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.container = this.scene.add.container(0, 0);
    this.container.setScrollFactor(0);
    this.container.setDepth(1001);

    this.createFrozenIcon();
    this.updatePosition();

    this.scene.scale.on("resize", this.updatePosition, this);
  }

  private updatePosition(): void {
    const { width } = this.scene.scale.gameSize;
    // Position to the left of where minimap would be (minimap is 150px wide + 16px margin)
    const minimapWidth = 150;
    const x =
      width -
      minimapWidth -
      this.config.margin * 2 -
      this.config.iconSize -
      this.config.spacing;
    const y = this.config.margin;

    this.container.setPosition(x, y);
  }

  /**
   * Draw a snowflake icon using graphics, centered at (centerX, centerY)
   */
  private drawSnowflake(
    graphics: GameObjects.Graphics,
    centerX: number,
    centerY: number,
    size: number
  ): void {
    const lineLength = size * 0.35;
    const branchLength = size * 0.15;
    const branchOffset = lineLength * 0.5;

    graphics.lineStyle(2, 0xffffff, 1);

    // Draw 6 main lines radiating from center
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3; // 60 degrees apart

      // Main line
      const endX = centerX + Math.cos(angle) * lineLength;
      const endY = centerY + Math.sin(angle) * lineLength;
      graphics.beginPath();
      graphics.moveTo(centerX, centerY);
      graphics.lineTo(endX, endY);
      graphics.strokePath();

      // Small branches on each main line
      const branchStartX = centerX + Math.cos(angle) * branchOffset;
      const branchStartY = centerY + Math.sin(angle) * branchOffset;

      // Left branch
      const leftAngle = angle + Math.PI / 4;
      graphics.beginPath();
      graphics.moveTo(branchStartX, branchStartY);
      graphics.lineTo(
        branchStartX + Math.cos(leftAngle) * branchLength,
        branchStartY + Math.sin(leftAngle) * branchLength
      );
      graphics.strokePath();

      // Right branch
      const rightAngle = angle - Math.PI / 4;
      graphics.beginPath();
      graphics.moveTo(branchStartX, branchStartY);
      graphics.lineTo(
        branchStartX + Math.cos(rightAngle) * branchLength,
        branchStartY + Math.sin(rightAngle) * branchLength
      );
      graphics.strokePath();
    }

    // Center dot
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(centerX, centerY, 2);
  }

  private createFrozenIcon(): void {
    const iconContainer = this.scene.add.container(0, 0);
    const size = this.config.iconSize;

    // Background with rounded corners effect (using circle + rect)
    const background = this.scene.add.graphics();
    background.fillStyle(0x000000, 0.6);
    background.fillRoundedRect(0, 0, size, size, 6);
    background.lineStyle(2, 0xff4444, 0.8); // Red outline
    background.strokeRoundedRect(0, 0, size, size, 6);

    // Snowflake icon - draw centered at (0,0) so scaling works from center
    const icon = this.scene.add.graphics();
    this.drawSnowflake(icon, 0, 0, size);
    // Position the icon at the center of the background
    icon.setPosition(size / 2, size / 2);

    iconContainer.add([background, icon]);
    iconContainer.setVisible(false);
    iconContainer.setAlpha(0);

    this.container.add(iconContainer);

    this.debuffs.set("frozen", {
      container: iconContainer,
      background,
      icon,
      active: false,
    });
  }

  /**
   * Show or hide a debuff
   */
  setDebuff(type: DebuffType, active: boolean): void {
    const debuff = this.debuffs.get(type);
    if (!debuff || debuff.active === active) return;

    debuff.active = active;

    if (active) {
      debuff.container.setVisible(true);
      // Fade in animation
      this.scene.tweens.add({
        targets: debuff.container,
        alpha: 1,
        duration: 200,
        ease: "Power2",
      });

      // Add subtle pulse animation while active
      this.scene.tweens.add({
        targets: debuff.icon,
        scaleX: 1.1,
        scaleY: 1.1,
        duration: 500,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    } else {
      // Stop pulse animation
      this.scene.tweens.killTweensOf(debuff.icon);
      debuff.icon.setScale(1);

      // Fade out animation
      this.scene.tweens.add({
        targets: debuff.container,
        alpha: 0,
        duration: 200,
        ease: "Power2",
        onComplete: () => {
          debuff.container.setVisible(false);
        },
      });
    }

    this.repositionIcons();
  }

  /**
   * Check if a debuff is currently active
   */
  isDebuffActive(type: DebuffType): boolean {
    return this.debuffs.get(type)?.active ?? false;
  }

  /**
   * Reposition visible icons in a row
   */
  private repositionIcons(): void {
    let offsetX = 0;

    this.debuffs.forEach((debuff) => {
      if (debuff.active) {
        debuff.container.setPosition(offsetX, 0);
        offsetX -= this.config.iconSize + this.config.spacing;
      }
    });
  }

  /**
   * Show the debuff display
   */
  show(): void {
    this.container.setVisible(true);
  }

  /**
   * Hide the debuff display
   */
  hide(): void {
    this.container.setVisible(false);
  }

  /**
   * Clean up the debuff display
   */
  destroy(): void {
    this.scene.scale.off("resize", this.updatePosition, this);
    this.debuffs.forEach((debuff) => {
      this.scene.tweens.killTweensOf(debuff.icon);
      this.scene.tweens.killTweensOf(debuff.container);
    });
    this.container.destroy();
  }
}
