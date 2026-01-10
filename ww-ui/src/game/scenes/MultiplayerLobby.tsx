import { GameObjects, Scene } from "phaser";
import { CONSTANTS } from "../constants";
import { EventBus } from "../EventBus";

export default class MultiplayerLobbyScene extends Scene {
  private background: GameObjects.Rectangle | null = null;
  private titleText: GameObjects.Text | null = null;

  constructor() {
    super(CONSTANTS.SCENES.MULTIPLAYER_LOBBY);
  }

  init() {
    this.scale.on("resize", this.resize, this);
  }

  create() {
    const centerX = this.scale.width / 2;

    // Dark background - matches the app background
    this.background = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x1a1a1a)
      .setOrigin(0, 0);

    // Title at top-center with fantasy styling
    this.titleText = this.add
      .text(centerX, 36, "WIZARD WARRIORS", {
        fontSize: "20px",
        fontStyle: "bold",
        color: "#60a5fa",
        letterSpacing: 6,
        stroke: "#60a5fa",
        strokeThickness: 1,
      })
      .setOrigin(0.5)
      .setAlpha(0.5);

    EventBus.on("multiplayer-game-start", this.handleGameStart, this);

    EventBus?.emit("current-scene-ready", this);
  }

  handleGameStart() {
    this.scene.start(CONSTANTS.SCENES.MULTIPLAYER_GAME);
  }

  resize(gameSize: GameObjects.Components.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
    this.background?.setSize(gameSize.width, gameSize.height);
    this.titleText?.setPosition(gameSize.width / 2, 36);
  }

  destroy() {
    EventBus.removeListener("multiplayer-game-start");
  }
}
