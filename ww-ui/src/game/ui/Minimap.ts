import { GameObjects, Scene } from "phaser";

interface MinimapConfig {
  /** Width of the minimap in pixels */
  width?: number;
  /** Height of the minimap in pixels */
  height?: number;
  /** Margin from the edge of the screen */
  margin?: number;
  /** Background color of the minimap */
  backgroundColor?: number;
  /** Background alpha */
  backgroundAlpha?: number;
  /** Border color */
  borderColor?: number;
  /** Border width */
  borderWidth?: number;
  /** Player indicator color */
  playerColor?: number;
  /** Player indicator size */
  playerSize?: number;
  /** Viewport indicator color */
  viewportColor?: number;
  /** Viewport indicator alpha */
  viewportAlpha?: number;
  /** World width in pixels */
  worldWidth: number;
  /** World height in pixels */
  worldHeight: number;
}

const DEFAULT_CONFIG: Required<Omit<MinimapConfig, "worldWidth" | "worldHeight">> = {
  width: 150,
  height: 150,
  margin: 16,
  backgroundColor: 0x1a1a1a,
  backgroundAlpha: 0.8,
  borderColor: 0xffffff,
  borderWidth: 2,
  playerColor: 0x4a9eff,
  playerSize: 6,
  viewportColor: 0xffffff,
  viewportAlpha: 0.3,
};

export class Minimap {
  private scene: Scene;
  private config: Required<MinimapConfig>;
  private container: GameObjects.Container;
  private background: GameObjects.Rectangle;
  private border: GameObjects.Graphics;
  private playerIndicator: GameObjects.Arc;
  private viewportIndicator: GameObjects.Rectangle;
  private otherPlayersIndicators: Map<string, GameObjects.Arc> = new Map();

  // Scale factors to convert world coordinates to minimap coordinates
  private scaleX: number;
  private scaleY: number;

  constructor(scene: Scene, config: MinimapConfig) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config } as Required<MinimapConfig>;

    this.scaleX = this.config.width / this.config.worldWidth;
    this.scaleY = this.config.height / this.config.worldHeight;

    this.container = this.createContainer();
    this.background = this.createBackground();
    this.border = this.createBorder();
    this.viewportIndicator = this.createViewportIndicator();
    this.playerIndicator = this.createPlayerIndicator();

    // Add elements to container in correct order (background first, player on top)
    this.container.add([
      this.background,
      this.border,
      this.viewportIndicator,
      this.playerIndicator,
    ]);

    // Make minimap fixed to camera (UI element)
    this.container.setScrollFactor(0);
    this.container.setDepth(1000);

    // Position in top-right corner
    this.updatePosition();

    // Listen for resize events to reposition minimap
    this.scene.scale.on("resize", this.updatePosition, this);
  }

  private createContainer(): GameObjects.Container {
    return this.scene.add.container(0, 0);
  }

  private createBackground(): GameObjects.Rectangle {
    const bg = this.scene.add.rectangle(
      0,
      0,
      this.config.width,
      this.config.height,
      this.config.backgroundColor,
      this.config.backgroundAlpha
    );
    bg.setOrigin(0, 0);
    return bg;
  }

  private createBorder(): GameObjects.Graphics {
    const graphics = this.scene.add.graphics();
    graphics.lineStyle(this.config.borderWidth, this.config.borderColor, 1);
    graphics.strokeRect(0, 0, this.config.width, this.config.height);
    return graphics;
  }

  private createPlayerIndicator(): GameObjects.Arc {
    const indicator = this.scene.add.circle(
      this.config.width / 2,
      this.config.height / 2,
      this.config.playerSize,
      this.config.playerColor
    );
    return indicator;
  }

  private createViewportIndicator(): GameObjects.Rectangle {
    // Initial size, will be updated based on camera
    const viewport = this.scene.add.rectangle(
      0,
      0,
      20,
      20,
      this.config.viewportColor,
      this.config.viewportAlpha
    );
    viewport.setOrigin(0, 0);
    viewport.setStrokeStyle(1, this.config.viewportColor, 0.8);
    return viewport;
  }

  private updatePosition(): void {
    const { width } = this.scene.scale.gameSize;
    this.container.setPosition(
      width - this.config.width - this.config.margin,
      this.config.margin
    );
  }

  /**
   * Convert world coordinates to minimap coordinates
   */
  private worldToMinimap(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: Phaser.Math.Clamp(worldX * this.scaleX, 0, this.config.width),
      y: Phaser.Math.Clamp(worldY * this.scaleY, 0, this.config.height),
    };
  }

  /**
   * Update the player position on the minimap
   */
  updatePlayerPosition(worldX: number, worldY: number): void {
    const minimapPos = this.worldToMinimap(worldX, worldY);
    this.playerIndicator.setPosition(minimapPos.x, minimapPos.y);
  }

  /**
   * Update the camera viewport indicator on the minimap
   */
  updateViewport(camera: Phaser.Cameras.Scene2D.Camera): void {
    const minimapPos = this.worldToMinimap(camera.scrollX, camera.scrollY);
    const viewportWidth = camera.width * this.scaleX;
    const viewportHeight = camera.height * this.scaleY;

    this.viewportIndicator.setPosition(minimapPos.x, minimapPos.y);
    this.viewportIndicator.setSize(viewportWidth, viewportHeight);
  }

  /**
   * Add or update another player's position on the minimap
   */
  updateOtherPlayer(playerId: string, worldX: number, worldY: number, color: number = 0xff4444): void {
    let indicator = this.otherPlayersIndicators.get(playerId);

    if (!indicator) {
      indicator = this.scene.add.circle(0, 0, this.config.playerSize - 1, color);
      this.otherPlayersIndicators.set(playerId, indicator);
      this.container.add(indicator);
    }

    const minimapPos = this.worldToMinimap(worldX, worldY);
    indicator.setPosition(minimapPos.x, minimapPos.y);
  }

  /**
   * Remove another player from the minimap
   */
  removeOtherPlayer(playerId: string): void {
    const indicator = this.otherPlayersIndicators.get(playerId);
    if (indicator) {
      indicator.destroy();
      this.otherPlayersIndicators.delete(playerId);
    }
  }

  /**
   * Update method to be called in the scene's update loop
   */
  update(playerX: number, playerY: number): void {
    this.updatePlayerPosition(playerX, playerY);
    this.updateViewport(this.scene.cameras.main);
  }

  /**
   * Show the minimap
   */
  show(): void {
    this.container.setVisible(true);
  }

  /**
   * Hide the minimap
   */
  hide(): void {
    this.container.setVisible(false);
  }

  /**
   * Toggle minimap visibility
   */
  toggle(): void {
    this.container.setVisible(!this.container.visible);
  }

  /**
   * Clean up the minimap
   */
  destroy(): void {
    this.scene.scale.off("resize", this.updatePosition, this);
    this.otherPlayersIndicators.forEach((indicator) => indicator.destroy());
    this.otherPlayersIndicators.clear();
    this.container.destroy();
  }
}
