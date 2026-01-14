import { GameObjects, Scene } from "phaser";
import { CONSTANTS } from "../constants";
import { EventBus } from "../EventBus";

export default class MultiplayerLobbyScene extends Scene {
  private background: GameObjects.Rectangle | null = null;
  private titleContainer: GameObjects.Container | null = null;
  private titleLetters: GameObjects.Text[] = [];

  constructor() {
    super(CONSTANTS.SCENES.MULTIPLAYER_LOBBY);
  }

  init() {
    this.scale.on("resize", this.resize, this);
    this.events.on("shutdown", this.shutdown, this);
  }

  create() {
    const centerX = this.scale.width / 2;

    this.background = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x1a1a1a)
      .setOrigin(0, 0);

    this.createTitle(centerX, 50);

    EventBus.on("multiplayer-game-start", this.handleGameStart, this);

    EventBus?.emit("current-scene-ready", this);
  }

  handleGameStart() {
    this.scene.start(CONSTANTS.SCENES.MULTIPLAYER_GAME);
  }

  createTitle(centerX: number, y: number) {
    const title = "WIZARD WARRIORS";
    const blueColor = "#60a5fa";
    const purpleColor = "#a855f7";
    const baseFontSize = Math.max(32, Math.min(56, this.scale.width * 0.05));

    this.titleLetters.forEach((letter) => letter.destroy());
    this.titleLetters = [];
    this.titleContainer?.destroy();

    this.titleContainer = this.add.container(centerX, y);

    let totalWidth = 0;
    const letterSpacing = 4;

    // First pass: create letters to measure total width
    const tempLetters: GameObjects.Text[] = [];
    for (let i = 0; i < title.length; i++) {
      const char = title[i];
      const color = i % 2 === 0 ? blueColor : purpleColor;
      const shadowColor = i % 2 === 0 ? "#1e3a5f" : "#4a1d6e";

      // Shadow layer for depth
      const shadow = this.add
        .text(0, 0, char, {
          fontSize: `${baseFontSize}px`,
          fontStyle: "bold",
          color: shadowColor,
        })
        .setOrigin(0.5)
        .setAlpha(0.8);

      // Main letter with gradient-like effect
      const letter = this.add
        .text(0, 0, char, {
          fontSize: `${baseFontSize}px`,
          fontStyle: "bold",
          color: color,
          stroke: i % 2 === 0 ? "#1e40af" : "#7e22ce",
          strokeThickness: 3,
          shadow: {
            offsetX: 2,
            offsetY: 2,
            color: "#000000",
            blur: 4,
            fill: true,
          },
        })
        .setOrigin(0.5);

      tempLetters.push(shadow, letter);
      totalWidth += letter.width + letterSpacing;
    }

    // Clean up temp measurement
    tempLetters.forEach((t) => t.destroy());
    totalWidth -= letterSpacing; // Remove last spacing

    // Second pass: position letters correctly
    let xOffset = -totalWidth / 2;
    for (let i = 0; i < title.length; i++) {
      const char = title[i];
      const color = i % 2 === 0 ? blueColor : purpleColor;
      const shadowColor = i % 2 === 0 ? "#1e3a5f" : "#4a1d6e";
      const shadow = this.add
        .text(0, 0, char, {
          fontSize: `${baseFontSize}px`,
          fontStyle: "bold",
          color: shadowColor,
        })
        .setOrigin(0, 0.5)
        .setAlpha(0.6);
      shadow.setPosition(xOffset + 3, 3);

      const letter = this.add
        .text(0, 0, char, {
          fontSize: `${baseFontSize}px`,
          fontStyle: "bold",
          color: color,
          stroke: i % 2 === 0 ? "#1e40af" : "#7e22ce",
          strokeThickness: 3,
          shadow: {
            offsetX: 0,
            offsetY: 0,
            color: color,
            blur: 8,
            fill: true,
          },
        })
        .setOrigin(0, 0.5);
      letter.setPosition(xOffset, 0);

      this.titleContainer.add([shadow, letter]);
      this.titleLetters.push(shadow, letter);

      xOffset += letter.width + letterSpacing;
    }

    this.titleContainer.setAlpha(0.85);
  }

  resize(gameSize: GameObjects.Components.Size) {
    if (!this.background?.active) return;

    this.cameras.resize(gameSize.width, gameSize.height);
    this.background.setSize(gameSize.width, gameSize.height);

    this.createTitle(gameSize.width / 2, 50);
  }

  shutdown() {
    this.scale.off("resize", this.resize, this);
    EventBus.removeListener("multiplayer-game-start");
  }

  destroy() {
    this.shutdown();
  }
}
