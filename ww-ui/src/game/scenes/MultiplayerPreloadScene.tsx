import { GameObjects, Scene } from "phaser";
import { CONSTANTS } from "../constants";

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

    this.load.spritesheet(
      "multiplayer-sheet",
      "assets/MultiplayerSpriteSheet.png",
      {
        frameWidth: 16,
        frameHeight: 16,
      }
    );
  }

  create() {
    this.anims.create({
      key: "multiplayer-idle",
      frames: [{ key: "multiplayer-sheet", frame: 1 }],
      frameRate: 8,
    });

    this.anims.create({
      key: "multiplayer-down",
      frames: this.anims.generateFrameNumbers("multiplayer-sheet", {
        start: 0,
        end: 2,
      }),
      frameRate: 8,
      repeat: -1,
    });

    this.anims.create({
      key: "multiplayer-left",
      frames: this.anims.generateFrameNumbers("multiplayer-sheet", {
        start: 16,
        end: 18,
      }),
      frameRate: 8,
      repeat: -1,
    });

    this.anims.create({
      key: "multiplayer-right",
      frames: this.anims.generateFrameNumbers("multiplayer-sheet", {
        start: 32,
        end: 34,
      }),
      frameRate: 8,
      repeat: -1,
    });

    this.anims.create({
      key: "multiplayer-up",
      frames: this.anims.generateFrameNumbers("multiplayer-sheet", {
        start: 48,
        end: 50,
      }),
      frameRate: 8,
      repeat: -1,
    });

    this.anims.create({
      key: "potion-idle",
      frames: [{ key: "multiplayer-sheet", frame: 240 }],
    });

    this.anims.create({
      key: "potion-flying",
      frames: [{ key: "multiplayer-sheet", frame: 241 }],
    });

    this.anims.create({
      key: "potion-explode",
      frames: [{ key: "multiplayer-sheet", frame: 242 }],
    });

    this.scene.start(CONSTANTS.SCENES.MULTIPLAYER_LOBBY);
  }

  resize(gameSize: GameObjects.Components.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
  }
}
