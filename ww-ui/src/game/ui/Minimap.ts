import { GameObjects, Scene } from "phaser";

const LAYER_COLORS = {
  ROCK: 0x8b4513,
  PLANT: 0x90ee90,
  WATER: 0x00bfff,
  ELEVATION: 0xf0e68c,
};

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
  /** Viewport indicator scale (0-1, smaller = smaller rectangle) */
  viewportScale?: number;
  /** World width in pixels */
  worldWidth: number;
  /** World height in pixels */
  worldHeight: number;
}

const DEFAULT_CONFIG: Required<
  Omit<MinimapConfig, "worldWidth" | "worldHeight">
> = {
  width: 150,
  height: 150,
  margin: 16,
  backgroundColor: 0x1a1a1a,
  backgroundAlpha: 0.8,
  borderColor: 0xffffff,
  borderWidth: 2,
  playerColor: 0x32cd32,
  playerSize: 3,
  viewportColor: 0xffffff,
  viewportAlpha: 0.3,
  viewportScale: 0.5,
};

export class Minimap {
  private scene: Scene;
  private config: Required<MinimapConfig>;
  private container: GameObjects.Container;
  private background: GameObjects.Rectangle;
  private border: GameObjects.Graphics;
  private terrainGraphics: GameObjects.Graphics;
  private playerIndicator: GameObjects.Arc;
  private viewportIndicator: GameObjects.Rectangle;
  private viewportMaskShape: GameObjects.Graphics;
  private viewportMask: Phaser.Display.Masks.GeometryMask;
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
    this.terrainGraphics = this.createTerrainGraphics();
    this.border = this.createBorder();
    this.viewportIndicator = this.createViewportIndicator();
    this.playerIndicator = this.createPlayerIndicator();

    const { maskShape, mask } = this.createViewportMask();
    this.viewportMaskShape = maskShape;
    this.viewportMask = mask;

    // Add elements to container in correct order (background first, player on top)
    this.container.add([
      this.background,
      this.terrainGraphics,
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

  private createTerrainGraphics(): GameObjects.Graphics {
    return this.scene.add.graphics();
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

  private createViewportMask(): {
    maskShape: GameObjects.Graphics;
    mask: Phaser.Display.Masks.GeometryMask;
  } {
    const maskShape = this.scene.add.graphics();
    maskShape.setScrollFactor(0);

    const mask = maskShape.createGeometryMask();
    this.viewportIndicator.setMask(mask);

    return { maskShape, mask };
  }

  private updatePosition(): void {
    const { width } = this.scene.scale.gameSize;
    const x = width - this.config.width - this.config.margin;
    const y = this.config.margin;

    this.container.setPosition(x, y);

    this.updateMaskPosition(x, y);
  }

  private updateMaskPosition(x: number, y: number): void {
    this.viewportMaskShape.clear();
    this.viewportMaskShape.fillStyle(0xffffff);
    this.viewportMaskShape.fillRect(
      x,
      y,
      this.config.width,
      this.config.height
    );
  }

  /**
   * Convert world coordinates to minimap coordinates
   */
  private worldToMinimap(
    worldX: number,
    worldY: number
  ): { x: number; y: number } {
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
    const viewportWidth =
      camera.width * this.scaleX * this.config.viewportScale;
    const viewportHeight =
      camera.height * this.scaleY * this.config.viewportScale;

    const playerX = this.playerIndicator.x;
    const playerY = this.playerIndicator.y;

    this.viewportIndicator.setPosition(
      playerX - viewportWidth / 2,
      playerY - viewportHeight / 2
    );
    this.viewportIndicator.setSize(viewportWidth, viewportHeight);
  }

  /**
   * Add or update another player's position on the minimap
   */
  updateOtherPlayer(
    playerId: string,
    worldX: number,
    worldY: number,
    color: number = 0xff4444
  ): void {
    let indicator = this.otherPlayersIndicators.get(playerId);

    if (!indicator) {
      indicator = this.scene.add.circle(
        0,
        0,
        this.config.playerSize - 1,
        color
      );
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

  renderLayers(
    collisionLayer: Phaser.Tilemaps.TilemapLayer | null,
    elevationLayer: Phaser.Tilemaps.TilemapLayer | null
  ): void {
    this.terrainGraphics.clear();

    const referenceLayer = collisionLayer || elevationLayer;
    if (!referenceLayer) return;

    const tileWidth = referenceLayer.tilemap.tileWidth;
    const tileHeight = referenceLayer.tilemap.tileHeight;
    const minimapTileWidth = tileWidth * this.scaleX;
    const minimapTileHeight = tileHeight * this.scaleY;

    if (elevationLayer) {
      elevationLayer.forEachTile((tile) => {
        if (tile.index <= 0) return;

        const minimapX = tile.pixelX * this.scaleX;
        const minimapY = tile.pixelY * this.scaleY;

        this.terrainGraphics.fillStyle(LAYER_COLORS.ELEVATION, 0.7);
        this.terrainGraphics.fillRect(
          minimapX,
          minimapY,
          minimapTileWidth,
          minimapTileHeight
        );
      });
    }

    if (collisionLayer) {
      collisionLayer.forEachTile((tile) => {
        if (tile.index <= 0) return;

        const minimapX = tile.pixelX * this.scaleX;
        const minimapY = tile.pixelY * this.scaleY;

        const waterTiles = [138, 139, 140, 152, 153, 154, 166, 167, 168];
        const plantTiles = [46, 47, 48, 54];
        const rockTiles = [51, 52];

        let color = LAYER_COLORS.ROCK;
        if (waterTiles.includes(tile.index)) {
          color = LAYER_COLORS.WATER;
        } else if (plantTiles.includes(tile.index)) {
          color = LAYER_COLORS.PLANT;
        } else if (rockTiles.includes(tile.index)) {
          color = LAYER_COLORS.ROCK;
        }

        this.terrainGraphics.fillStyle(color, 0.8);
        this.terrainGraphics.fillRect(
          minimapX,
          minimapY,
          minimapTileWidth,
          minimapTileHeight
        );
      });
    }
  }

  /**
   * Render terrain zones directly (for multiplayer maps without tilemaps)
   */
  renderTerrainZones(
    zones: {
      x: number;
      y: number;
      width: number;
      height: number;
      color: number;
    }[]
  ): void {
    this.terrainGraphics.clear();

    for (const zone of zones) {
      const minimapX = zone.x * this.scaleX;
      const minimapY = zone.y * this.scaleY;
      const minimapWidth = zone.width * this.scaleX;
      const minimapHeight = zone.height * this.scaleY;

      this.terrainGraphics.fillStyle(zone.color, 0.8);
      this.terrainGraphics.fillRect(
        minimapX,
        minimapY,
        minimapWidth,
        minimapHeight
      );
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
    this.viewportMask.destroy();
    this.viewportMaskShape.destroy();
    this.container.destroy();
  }
}
