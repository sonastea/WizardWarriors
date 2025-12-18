import { GameObjects, Scene } from "phaser";
import { CONSTANTS } from "../constants";

/**
 * Preload scene for multiplayer mode.
 * Loads all assets needed for the multiplayer game before transitioning to the lobby.
 */
export default class MultiplayerPreloadScene extends Scene {
  constructor() {
    super(CONSTANTS.SCENES.MULTIPLAYER_PRELOAD);
  }

  init() {
    this.scale.on("resize", this.resize, this);
  }

  preload() {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(width / 2 - 160, height / 2 - 25, 320, 50);

    const loadingText = this.add
      .text(width / 2, height / 2 - 50, "Loading...", {
        fontSize: "20px",
        color: "#ffffff",
      })
      .setOrigin(0.5, 0.5);

    this.load.on("progress", (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0x4a9eff, 1);
      progressBar.fillRect(width / 2 - 150, height / 2 - 15, 300 * value, 30);
    });

    this.load.on("complete", () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });

    this.load.image("tiles", "assets/DesertTilemap.png");
    this.load.tilemapTiledJSON("map", "assets/multiplayer_map.json");

    this.load.spritesheet("player", "assets/player/player.png", {
      frameWidth: 16,
      frameHeight: 16,
      startFrame: 0,
      endFrame: 23,
    });

    this.load.spritesheet("ally", "assets/player/ally.png", {
      frameWidth: 16,
      frameHeight: 16,
      startFrame: 9,
      endFrame: 17,
    });
  }

  create() {
    this.scene.start(CONSTANTS.SCENES.MULTIPLAYER_LOBBY);
  }

  resize(gameSize: GameObjects.Components.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
  }
}
