import { GameObjects, Scene } from "phaser";
import { CONSTANTS } from "../constants";
import { EventBus } from "../EventBus";

// These must match server constants
const MAP_WIDTH = 2000;
const MAP_HEIGHT = 2000;
const PLAYER_RADIUS = 16;
const PLAYER_SPEED = 200;

interface InputState {
  moveUp: boolean;
  moveDown: boolean;
  moveLeft: boolean;
  moveRight: boolean;
}

export default class MultiplayerGameScene extends Scene {
  private players: Map<string, GameObjects.Arc> = new Map();
  private localPlayer: GameObjects.Arc | null = null;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private localPlayerId: string | null = null;
  
  // Track last input state to detect changes
  private lastInputState: InputState = {
    moveUp: false,
    moveDown: false,
    moveLeft: false,
    moveRight: false,
  };

  constructor() {
    super(CONSTANTS.SCENES.MULTIPLAYER_GAME);
  }

  init() {
    this.scale.on("resize", this.resize, this);
    
    EventBus.on("set-local-player-id", this.handleSetLocalPlayerId, this);
  }

  create() {
    this.add.rectangle(0, 0, MAP_WIDTH, MAP_HEIGHT, 0x2a2a2a).setOrigin(0, 0);

    const graphics = this.add.graphics();
    graphics.lineStyle(4, 0xffffff, 0.5);
    graphics.strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);

    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);

    this.localPlayer = this.add.circle(MAP_WIDTH / 2, MAP_HEIGHT / 2, PLAYER_RADIUS, 0x4a9eff);
    this.localPlayer.setData("playerId", "local");
    this.localPlayer.setVisible(false); // Hidden until we get server position

    // Camera follows player tightly to avoid drift perception
    this.cameras.main.startFollow(this.localPlayer, true, 0.5, 0.5);

    this.cursors = this.input.keyboard?.createCursorKeys() || null;

    EventBus.on("multiplayer-game-state", this.handleGameState, this);
    EventBus.on("multiplayer-player-joined", this.handlePlayerJoined, this);
    EventBus.on("multiplayer-player-left", this.handlePlayerLeft, this);

    EventBus.emit("send-player-join");

    EventBus?.emit("current-scene-ready", this);
  }

  update(_time: number, delta: number) {
    if (!this.localPlayer || !this.cursors) return;

    const currentInput: InputState = {
      moveUp: this.cursors.up?.isDown || false,
      moveDown: this.cursors.down?.isDown || false,
      moveLeft: this.cursors.left?.isDown || false,
      moveRight: this.cursors.right?.isDown || false,
    };

    // Client side movement locally for immediate feedback, but server is authority
    if (this.localPlayer.visible) {
      let velocityX = 0;
      let velocityY = 0;

      if (currentInput.moveLeft) velocityX = -PLAYER_SPEED;
      if (currentInput.moveRight) velocityX = PLAYER_SPEED;
      if (currentInput.moveUp) velocityY = -PLAYER_SPEED;
      if (currentInput.moveDown) velocityY = PLAYER_SPEED;

      const deltaSeconds = delta / 1000;
      let newX = this.localPlayer.x + velocityX * deltaSeconds;
      let newY = this.localPlayer.y + velocityY * deltaSeconds;

      // Clamp to map boundaries (same as server)
      newX = Phaser.Math.Clamp(newX, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
      newY = Phaser.Math.Clamp(newY, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);

      this.localPlayer.x = newX;
      this.localPlayer.y = newY;
    }

    // Send input changes to server (event-based, only when input changes)
    // Check each input individually and only send what changed
    if (currentInput.moveUp !== this.lastInputState.moveUp) {
      EventBus.emit("send-input-change", { input: "moveUp", pressed: currentInput.moveUp });
      this.lastInputState.moveUp = currentInput.moveUp;
    }
    if (currentInput.moveDown !== this.lastInputState.moveDown) {
      EventBus.emit("send-input-change", { input: "moveDown", pressed: currentInput.moveDown });
      this.lastInputState.moveDown = currentInput.moveDown;
    }
    if (currentInput.moveLeft !== this.lastInputState.moveLeft) {
      EventBus.emit("send-input-change", { input: "moveLeft", pressed: currentInput.moveLeft });
      this.lastInputState.moveLeft = currentInput.moveLeft;
    }
    if (currentInput.moveRight !== this.lastInputState.moveRight) {
      EventBus.emit("send-input-change", { input: "moveRight", pressed: currentInput.moveRight });
      this.lastInputState.moveRight = currentInput.moveRight;
    }
  }

  handleSetLocalPlayerId(data: { playerId: string }) {
    this.localPlayerId = data.playerId;
  }

  handleGameState(data: any) {
    if (!data.players) return;
    if (!this.localPlayerId) return;

    for (const playerState of data.players) {
      const playerId = playerState.playerId?.value;
      const position = playerState.position;
      
      if (!playerId || !position) continue;
      
      if (playerId === this.localPlayerId) {
        if (this.localPlayer) {
          if (!this.localPlayer.visible) {
            this.localPlayer.setVisible(true);
          }
          
          // Server reconciliation: correct client position towards server truth
          const distance = Phaser.Math.Distance.Between(
            this.localPlayer.x,
            this.localPlayer.y,
            position.x,
            position.y
          );
          
          if (distance > 100) {
            // Snap if very far (teleport, initial spawn, or major desync)
            this.localPlayer.x = position.x;
            this.localPlayer.y = position.y;
          } else if (distance > 2) {
            // Blend towards server position - stronger correction to prevent drift
            // Use higher lerp factor to keep client close to server truth
            this.localPlayer.x = Phaser.Math.Linear(this.localPlayer.x, position.x, 0.3);
            this.localPlayer.y = Phaser.Math.Linear(this.localPlayer.y, position.y, 0.3);
          }
          // If within 2 pixels, trust client prediction (feels responsive)
          // If very close, trust client prediction
        }
      } else {
        // Remote player - update or create
        if (!this.players.has(playerId)) {
          this.handlePlayerJoined({
            playerId: playerId,
            username: playerId,
            x: position.x,
            y: position.y,
          });
        } else {
          this.updateRemotePlayer(playerId, position.x, position.y);
        }
      }
    }
  }

  handlePlayerJoined(data: { playerId: string; username: string; x: number; y: number }) {
    if (data.playerId === this.localPlayerId) return;
    if (this.players.has(data.playerId)) return;
    
    const player = this.add.circle(data.x, data.y, PLAYER_RADIUS, 0xff4444);
    player.setData("playerId", data.playerId);
    this.players.set(data.playerId, player);

    const label = this.add.text(data.x, data.y - 30, data.username, {
      fontSize: "12px",
      color: "#ffffff",
      backgroundColor: "#000000",
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5);
    
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

  updateRemotePlayer(playerId: string, x: number, y: number) {
    const player = this.players.get(playerId);
    
    if (player) {
      // Smooth interpolation for remote players
      player.x = Phaser.Math.Linear(player.x, x, 0.3);
      player.y = Phaser.Math.Linear(player.y, y, 0.3);
      
      const label = player.getData("label");
      if (label) {
        label.x = player.x;
        label.y = player.y - 30;
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
    EventBus.removeListener("set-local-player-id");
  }
}
