import { GameObjects, Scene } from "phaser";
import { CONSTANTS } from "../constants";
import { EventBus } from "../EventBus";

export default class MultiplayerGameScene extends Scene {
  private players: Map<string, GameObjects.Arc> = new Map();
  private localPlayer: GameObjects.Arc | null = null;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;

  constructor() {
    super(CONSTANTS.SCENES.MULTIPLAYER_GAME);
  }

  init() {
    this.scale.on("resize", this.resize, this);
  }

  create() {
    this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x2a2a2a)
      .setOrigin(0, 0);

    const centerX = this.scale.width / 2;
    const centerY = this.scale.height / 2;
    
    this.localPlayer = this.add.circle(centerX, centerY, 16, 0x4a9eff);
    this.localPlayer.setData("playerId", "local");

    this.cursors = this.input.keyboard?.createCursorKeys() || null;

    EventBus.on("multiplayer-game-state", this.handleGameState, this);
    EventBus.on("multiplayer-player-joined", this.handlePlayerJoined, this);
    EventBus.on("multiplayer-player-left", this.handlePlayerLeft, this);
    EventBus.on("multiplayer-player-move", this.handlePlayerMove, this);

    EventBus?.emit("current-scene-ready", this);
  }

  update() {
    if (!this.localPlayer || !this.cursors) return;

    const speed = 200;
    let velocityX = 0;
    let velocityY = 0;

    if (this.cursors.left?.isDown) {
      velocityX = -speed;
    } else if (this.cursors.right?.isDown) {
      velocityX = speed;
    }

    if (this.cursors.up?.isDown) {
      velocityY = -speed;
    } else if (this.cursors.down?.isDown) {
      velocityY = speed;
    }

    if (velocityX !== 0 || velocityY !== 0) {
      const delta = this.game.loop.delta / 1000;
      this.localPlayer.x += velocityX * delta;
      this.localPlayer.y += velocityY * delta;

      EventBus.emit("send-player-position", {
        x: this.localPlayer.x,
        y: this.localPlayer.y,
      });
    }
  }

  handleGameState(data: any) {
    if (!data.players) return;

    for (const [playerId, playerData] of Object.entries(data.players)) {
      if (playerId === "local") continue;
      
      const player = playerData as any;
      this.updateRemotePlayer(playerId, player.x, player.y);
    }
  }

  handlePlayerJoined(data: { playerId: string; username: string; x: number; y: number }) {
    if (data.playerId === "local") return;
    
    const player = this.add.circle(data.x, data.y, 16, 0xff4444);
    player.setData("playerId", data.playerId);
    this.players.set(data.playerId, player);

    const label = this.add.text(data.x, data.y - 30, data.username, {
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#000000",
      padding: { x: 4, y: 2 },
    })
      .setOrigin(0.5);
    
    player.setData("label", label);
  }

  handlePlayerLeft(data: { playerId: string }) {
    const player = this.players.get(data.playerId);
    if (player) {
      const label = player.getData("label");
      label?.destroy();
      player.destroy();
      this.players.delete(data.playerId);
    }
  }

  handlePlayerMove(data: { playerId: string; x: number; y: number }) {
    this.updateRemotePlayer(data.playerId, data.x, data.y);
  }

  updateRemotePlayer(playerId: string, x: number, y: number) {
    let player = this.players.get(playerId);
    
    if (player) {
      player.x = x;
      player.y = y;
      
      const label = player.getData("label");
      if (label) {
        label.x = x;
        label.y = y - 30;
      }
    }
  }

  resize(gameSize: GameObjects.Components.Size) {
    this.cameras.resize(gameSize.width, gameSize.height);
  }

  destroy() {
    EventBus.removeListener("multiplayer-game-state");
    EventBus.removeListener("multiplayer-player-joined");
    EventBus.removeListener("multiplayer-player-left");
    EventBus.removeListener("multiplayer-player-move");
  }
}
