import { GameObjects, Scene } from "phaser";
import { CONSTANTS } from "../constants";
import { EventBus } from "../EventBus";

export default class MultiplayerLobbyScene extends Scene {
  private lobbyText: GameObjects.Text | null = null;
  private statusText: GameObjects.Text | null = null;

  constructor() {
    super(CONSTANTS.SCENES.MULTIPLAYER_LOBBY);
  }

  init() {
    this.scale.on("resize", this.resize, this);
  }

  create() {
    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;

    this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x1a1a1a)
      .setOrigin(0, 0);

    this.add
      .text(centerX, centerY - 100, "Multiplayer Lobby", {
        fontSize: "48px",
        fontStyle: "bold",
        color: "#ffffff",
        strokeThickness: 4,
        stroke: "#000",
      })
      .setOrigin(0.5);

    this.lobbyText = this.add
      .text(centerX, centerY, "Waiting for players...", {
        fontSize: "24px",
        color: "#aaaaaa",
        align: "center",
      })
      .setOrigin(0.5);

    this.statusText = this.add
      .text(centerX, centerY + 80, "Not ready", {
        fontSize: "20px",
        color: "#ff4444",
      })
      .setOrigin(0.5);

    EventBus.on("multiplayer-game-start", this.handleGameStart, this);
    EventBus.on("multiplayer-lobby-update", this.handleLobbyUpdate, this);
    EventBus.on("multiplayer-player-ready", this.handlePlayerReady, this);

    EventBus?.emit("current-scene-ready", this);
  }

  handleGameStart() {
    this.scene.start(CONSTANTS.SCENES.MULTIPLAYER_GAME);
  }

  handleLobbyUpdate(data: { players: string[]; readyCount: number }) {
    const playerCount = data.players?.length || 0;
    const readyCount = data.readyCount || 0;

    this.lobbyText?.setText(
      `Players in lobby: ${playerCount}\nReady: ${readyCount}/${playerCount}`
    );
  }

  handlePlayerReady() {
    this.statusText?.setText("Ready!");
    this.statusText?.setColor("#44ff44");
  }

  resize(gameSize: GameObjects.Components.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
  }

  destroy() {
    EventBus.removeListener("multiplayer-game-start");
    EventBus.removeListener("multiplayer-lobby-update");
    EventBus.removeListener("multiplayer-player-ready");
  }
}
