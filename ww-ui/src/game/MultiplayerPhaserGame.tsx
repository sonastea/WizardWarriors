import usePhaserGame from "@hooks/usePhaserGame";
import { RefObject, useEffect, useRef, useState } from "react";
import { Types } from "phaser";
import { EventBus } from "./EventBus";
import { useSocket } from "@contexts/Socket";
import MultiplayerLobbyScene from "./scenes/MultiplayerLobby";
import MultiplayerGameScene from "./scenes/MultiplayerGame";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ChatMessageSchema,
  GameMessageSchema,
  GameMessageType,
} from "@common/gen/multiplayer/v1/messages_pb";
import {
  PlayerEventSchema,
  PlayerEventType,
} from "@common/gen/multiplayer/v1/player_pb";

export interface IRefPhaserGame {
  game: Phaser.Game | null;
  scene: Phaser.Scene | null;
}

interface MultiplayerPhaserGameProps {
  currentActiveScene?: (scene_instance: Phaser.Scene) => void;
  token: string;
}

const multiplayerConfig: Types.Core.GameConfig = {
  type: Phaser.AUTO,
  title: "WizardWarriors - Multiplayer",
  parent: "game-content",
  backgroundColor: "#1a1a1a",
  width: 1280,
  height: 720,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: process.env.NEXT_PUBLIC_DEBUG === "true",
    },
  },
  antialias: false,
  pixelArt: true,
  roundPixels: true,
  scene: [MultiplayerLobbyScene, MultiplayerGameScene],
};

interface ChatMessageDisplay {
  username: string;
  message: string;
  timestamp: number;
}

const MultiplayerPhaserGame = ({
  currentActiveScene,
  token,
}: MultiplayerPhaserGameProps) => {
  const gameRef = useRef<HTMLDivElement>(null);
  const gameInstanceRef = useRef<IRefPhaserGame>({ game: null, scene: null });
  const chatInputRef = useRef<HTMLInputElement>(null);

  const { ws, isConnected, isConnecting, error, connect } = useSocket();

  const [isReady, setIsReady] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessageDisplay[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [playersInLobby, setPlayersInLobby] = useState<string[]>([]);

  useEffect(() => {
    if (token && !isConnected && !isConnecting) {
      connect(token);
    }
  }, [token]);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const bytes = new Uint8Array(event.data);
        const msg = fromBinary(GameMessageSchema, bytes);
        
        console.log("Received message:", msg);

        switch (msg.type) {
          case GameMessageType.CHAT_MESSAGE:
            if (msg.payload.case === "chatMessage") {
              const chatMsg = msg.payload.value;
              setChatMessages((prev) => [
                ...prev,
                {
                  username: chatMsg.senderId?.value || "Unknown",
                  message: chatMsg.text,
                  timestamp: Number(chatMsg.sentAtUnix),
                },
              ]);
            }
            break;

          case GameMessageType.PLAYER_EVENT:
            if (msg.payload.case === "playerEvent") {
              const playerEvent = msg.payload.value;
              // Handle player events (join, leave, move, ready, etc.)
              console.log("Player event:", playerEvent.type);
            }
            break;

          case GameMessageType.GAME_STATE:
            if (msg.payload.case === "gameState") {
              const gameState = msg.payload.value;
              EventBus.emit("multiplayer-game-state", gameState);
            }
            break;

          case GameMessageType.ANNOUNCEMENT:
            if (msg.payload.case === "chatAnnouncement") {
              const announcement = msg.payload.value;
              console.log("Announcement:", announcement.text);
            }
            break;

          default:
            console.log("Unknown message type:", msg.type);
        }
      } catch (err) {
        console.error("Failed to parse websocket message:", err);
      }
    };

    ws.addEventListener("message", handleMessage);

    return () => {
      ws.removeEventListener("message", handleMessage);
    };
  }, [ws]);

  usePhaserGame(multiplayerConfig, gameRef as RefObject<HTMLDivElement>);

  useEffect(() => {
    const handleSceneReady = (scene_instance: Phaser.Scene) => {
      gameInstanceRef.current = {
        game: gameInstanceRef.current.game,
        scene: scene_instance,
      };

      if (currentActiveScene && typeof currentActiveScene === "function") {
        currentActiveScene(scene_instance);
      }
    };

    EventBus.on("current-scene-ready", handleSceneReady);

    return () => {
      EventBus.removeListener("current-scene-ready");
    };
  }, [currentActiveScene]);

  useEffect(() => {
    const handleSendPosition = (position: { x: number; y: number }) => {
      if (!ws || !isConnected) return;

      const playerEvent = create(PlayerEventSchema, {
        type: PlayerEventType.MOVE,
        position: {
          x: position.x,
          y: position.y,
        },
      });

      const message = create(GameMessageSchema, {
        type: GameMessageType.PLAYER_EVENT,
        payload: {
          case: "playerEvent",
          value: playerEvent,
        },
      });

      ws.send(toBinary(GameMessageSchema, message));
    };

    EventBus.on("send-player-position", handleSendPosition);

    return () => {
      EventBus.removeListener("send-player-position");
    };
  }, [ws, isConnected]);

  const handleReady = () => {
    if (!ws || !isConnected) return;

    setIsReady(true);
    EventBus.emit("multiplayer-player-ready");

    const playerEvent = create(PlayerEventSchema, {
      type: PlayerEventType.READY,
    });

    const message = create(GameMessageSchema, {
      type: GameMessageType.PLAYER_EVENT,
      payload: {
        case: "playerEvent",
        value: playerEvent,
      },
    });

    ws.send(toBinary(GameMessageSchema, message));
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();

    if (!ws || !isConnected || !chatInput.trim()) return;

    const message = create(GameMessageSchema, {
      type: GameMessageType.CHAT_MESSAGE,
      payload: {
        case: "chatMessage",
        value: create(ChatMessageSchema, {
          text: chatInput.trim(),
        }),
      },
    });

    ws.send(toBinary(GameMessageSchema, message));

    setChatInput("");
  };

  return (
    <div style={{ position: "relative" }}>
      <div ref={gameRef} />

      {/* Lobby UI Overlay */}
      <div
        style={{
          position: "absolute",
          top: "20px",
          left: "20px",
          maxWidth: "300px",
          backgroundColor: "rgba(0, 0, 0, 0.8)",
          padding: "15px",
          borderRadius: "8px",
          color: "white",
          zIndex: 100,
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: "10px" }}>Lobby</h3>

        {error && (
          <div
            style={{
              padding: "8px",
              backgroundColor: "#ff4444",
              borderRadius: "4px",
              marginBottom: "10px",
              fontSize: "12px",
            }}
          >
            {error}
          </div>
        )}

        {isConnecting && (
          <div style={{ fontSize: "14px", marginBottom: "10px" }}>
            Connecting...
          </div>
        )}

        {isConnected && (
          <>
            <div style={{ marginBottom: "15px" }}>
              <div style={{ fontSize: "14px", marginBottom: "5px" }}>
                Players ({playersInLobby.length}):
              </div>
              <div
                style={{
                  backgroundColor: "#1a1a1a",
                  padding: "8px",
                  borderRadius: "4px",
                  maxHeight: "80px",
                  overflowY: "auto",
                  fontSize: "12px",
                }}
              >
                {playersInLobby.length > 0 ? (
                  playersInLobby.map((player, idx) => (
                    <div key={idx} style={{ padding: "2px 0" }}>
                      {player}
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#888" }}>No players</div>
                )}
              </div>
            </div>

            <button
              onClick={handleReady}
              disabled={isReady}
              style={{
                width: "100%",
                padding: "8px",
                backgroundColor: isReady ? "#666" : "#44ff44",
                border: "none",
                borderRadius: "4px",
                color: isReady ? "#aaa" : "#000",
                fontSize: "14px",
                fontWeight: "bold",
                cursor: isReady ? "not-allowed" : "pointer",
              }}
            >
              {isReady ? "Ready!" : "Ready Up"}
            </button>
          </>
        )}
      </div>

      {/* Chat UI */}
      <div
        style={{
          position: "absolute",
          bottom: "20px",
          right: "20px",
          width: "300px",
          zIndex: 100,
        }}
      >
        <div
          style={{
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            padding: "10px",
            borderRadius: "4px",
            marginBottom: "10px",
            maxHeight: "200px",
            overflowY: "auto",
          }}
        >
          {chatMessages.length > 0 ? (
            chatMessages.slice(-10).map((msg, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: "6px",
                  fontSize: "12px",
                  color: "white",
                }}
              >
                <span style={{ color: "#4a9eff", fontWeight: "bold" }}>
                  {msg.username}:
                </span>{" "}
                <span>{msg.message}</span>
              </div>
            ))
          ) : (
            <div style={{ color: "#888", fontSize: "12px" }}>No messages</div>
          )}
        </div>

        <form onSubmit={handleSendChat} style={{ display: "flex" }}>
          <input
            ref={chatInputRef}
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Type a message..."
            disabled={!isConnected}
            style={{
              flex: 1,
              padding: "8px",
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              border: "1px solid #444",
              borderRadius: "4px 0 0 4px",
              color: "white",
              outline: "none",
              fontSize: "12px",
            }}
          />
          <button
            type="submit"
            disabled={!isConnected}
            style={{
              padding: "8px 12px",
              backgroundColor: isConnected ? "#4a9eff" : "#666",
              border: "none",
              borderRadius: "0 4px 4px 0",
              color: "white",
              cursor: isConnected ? "pointer" : "not-allowed",
              fontSize: "12px",
              fontWeight: "bold",
            }}
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
};

export default MultiplayerPhaserGame;
