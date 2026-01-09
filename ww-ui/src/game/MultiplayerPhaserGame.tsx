import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ChatMessageSchema,
  GameMessageSchema,
  GameMessageType,
} from "@common/gen/multiplayer/v1/messages_pb";
import {
  ActionType,
  GameActionSchema,
  InputActionSchema,
  InputType,
  PlayerEventSchema,
  PlayerEventType,
} from "@common/gen/multiplayer/v1/player_pb";
import { useSocket } from "@contexts/Socket";
import usePhaserGame from "@hooks/usePhaserGame";
import { logger } from "@utils/logger";
import { useAtomValue } from "jotai";
import Phaser, { Types } from "phaser";
import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import LoginModal from "src/components/LoginModal";
import { gameStatsAtom } from "src/state";
import { EventBus } from "./EventBus";

import MultiplayerGameScene from "./scenes/MultiplayerGame";
import MultiplayerLobbyScene from "./scenes/MultiplayerLobby";
import MultiplayerPreloadScene from "./scenes/MultiplayerPreloadScene";

export interface IRefPhaserGame {
  game: Phaser.Game | null;
  scene: Phaser.Scene | null;
}

interface MultiplayerPhaserGameProps {
  currentActiveScene?: (scene_instance: Phaser.Scene) => void;
  token: string;
  isGuest?: boolean;
  guestId?: string | null;
  onLoginSuccess?: (
    userInfo: { id: number; username: string },
    reconnect: (newToken: string) => Promise<void>
  ) => void;
  onLeave?: () => void;
}

const multiplayerConfig: Types.Core.GameConfig = {
  type: Phaser.AUTO,
  title: "WizardWarriors - Multiplayer",
  parent: "game-content",
  backgroundColor: "#1a1a1a",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
    parent: "game-content",
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
  scene: [MultiplayerPreloadScene, MultiplayerLobbyScene, MultiplayerGameScene],
};

interface ChatMessageDisplay {
  username: string;
  message: string;
  timestamp: number;
}

interface LobbyUserDisplay {
  odId: string;
  name: string;
  isReady: boolean;
}

const MultiplayerPhaserGame = ({
  currentActiveScene,
  token,
  isGuest = false,
  guestId,
  onLoginSuccess,
  onLeave,
}: MultiplayerPhaserGameProps) => {
  const gameRef = useRef<HTMLDivElement>(null);
  const gameInstanceRef = useRef<IRefPhaserGame>({ game: null, scene: null });
  const chatInputRef = useRef<HTMLInputElement>(null);

  const {
    ws,
    isConnected,
    isConnecting,
    error,
    connect,
    disconnect,
    reconnectWithToken,
  } = useSocket();
  const gameStats = useAtomValue(gameStatsAtom);

  const [isReady, setIsReady] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessageDisplay[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [lobbyUsers, setLobbyUsers] = useState<LobbyUserDisplay[]>([]);
  const [gameUsers, setGameUsers] = useState<LobbyUserDisplay[]>([]);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isChatFocused, setIsChatFocused] = useState(false);

  // Get player ID - use guestId for guests, otherwise use gameStats.user_id
  const getPlayerId = () => {
    if (isGuest && guestId) {
      return guestId;
    }
    return gameStats.user_id.toString();
  };

  const focusChat = useCallback(() => {
    chatInputRef.current?.focus();
    setIsChatFocused(true);
  }, []);

  // Return focus to the game (blur chat input)
  const focusGame = useCallback(() => {
    chatInputRef.current?.blur();
    setIsChatFocused(false);
    // Focus the game canvas to ensure keyboard inputs register
    const canvas = gameRef.current?.querySelector("canvas");
    canvas?.focus();
  }, []);

  // Global keyboard handler for Enter key to toggle chat
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (showLoginModal) return;

      if (e.key === "Enter" && !isChatFocused) {
        e.preventDefault();
        focusChat();
      } else if (e.key === "Escape" && isChatFocused) {
        e.preventDefault();
        focusGame();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [isChatFocused, showLoginModal, focusChat, focusGame]);

  useEffect(() => {
    if (token && !isConnected && !isConnecting) {
      connect(token);
    }
  }, [token]);

  // Reset state when disconnecting (e.g., after guest logs in and reconnects)
  useEffect(() => {
    if (!isConnected) {
      setIsReady(false);
      setLobbyUsers([]);
      setGameUsers([]);
    }
  }, [isConnected]);

  useEffect(() => {
    if (!ws) return;

    const handleMessage = (event: MessageEvent) => {
      try {
        const bytes = new Uint8Array(event.data);
        const msg = fromBinary(GameMessageSchema, bytes);

        switch (msg.type) {
          case GameMessageType.CHAT_MESSAGE:
            if (msg.payload.case === "chatMessage") {
              const chatMsg = msg.payload.value;
              setChatMessages((prev) => [
                ...prev,
                {
                  username: chatMsg.senderName || "Unknown",
                  message: chatMsg.text,
                  timestamp: Number(chatMsg.sentAtUnix),
                },
              ]);
            }
            break;

          case GameMessageType.PLAYER_EVENT:
            if (msg.payload.case === "playerEvent") {
              const playerEvent = msg.payload.value;
              switch (playerEvent.type) {
                case PlayerEventType.JOIN:
                  if (playerEvent.playerId && playerEvent.position) {
                    const joinedPlayerId = playerEvent.playerId.value;
                    EventBus.emit("multiplayer-player-joined", {
                      playerId: joinedPlayerId,
                      username: joinedPlayerId,
                      x: playerEvent.position.x,
                      y: playerEvent.position.y,
                    });
                  }
                  break;

                case PlayerEventType.LEAVE:
                  if (playerEvent.playerId) {
                    const leftPlayerId = playerEvent.playerId.value;
                    EventBus.emit("multiplayer-player-left", {
                      playerId: leftPlayerId,
                    });
                  }
                  break;

                case PlayerEventType.MOVE:
                  if (playerEvent.playerId && playerEvent.position) {
                    EventBus.emit("multiplayer-player-move", {
                      playerId: playerEvent.playerId.value,
                      x: playerEvent.position.x,
                      y: playerEvent.position.y,
                    });
                  }
                  break;
              }
            }
            break;

          case GameMessageType.GAME_STATE:
            if (msg.payload.case === "gameState") {
              const gameState = msg.payload.value;
              EventBus.emit("multiplayer-game-state", gameState);
            }
            break;

          case GameMessageType.LOBBY_STATE:
            if (msg.payload.case === "lobbyState") {
              const lobbyState = msg.payload.value;
              setLobbyUsers(
                lobbyState.lobbyUsers.map((u) => ({
                  odId: u.userId?.value || "",
                  name: u.name || u.userId?.value || "Unknown",
                  isReady: u.isReady,
                }))
              );
              setGameUsers(
                lobbyState.gameUsers.map((u) => ({
                  odId: u.userId?.value || "",
                  name: u.name || u.userId?.value || "Unknown",
                  isReady: u.isReady,
                }))
              );
            }
            break;

          case GameMessageType.ANNOUNCEMENT:
            if (msg.payload.case === "chatAnnouncement") {
              const announcement = msg.payload.value;
              logger.info("Announcement:", announcement.text);
            }
            break;

          default:
            logger.warn("Unknown message type:", msg.type);
        }
      } catch (err) {
        logger.error("Failed to parse websocket message:", err);
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
    const handleSendInputChange = (data: {
      input: string;
      pressed: boolean;
    }) => {
      if (!ws || !isConnected) return;

      let inputType: (typeof InputType)[keyof typeof InputType];
      switch (data.input) {
        case "moveUp":
          inputType = InputType.MOVE_UP;
          break;
        case "moveDown":
          inputType = InputType.MOVE_DOWN;
          break;
        case "moveLeft":
          inputType = InputType.MOVE_LEFT;
          break;
        case "moveRight":
          inputType = InputType.MOVE_RIGHT;
          break;
        default:
          return;
      }

      const playerEvent = create(PlayerEventSchema, {
        type: PlayerEventType.INPUT,
        playerId: { value: getPlayerId() },
        inputAction: create(InputActionSchema, {
          input: inputType,
          pressed: data.pressed,
        }),
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

    const handleSendJoin = () => {
      if (!ws || !isConnected) return;

      const playerId = getPlayerId();
      EventBus.emit("set-local-player-id", {
        playerId: playerId,
      });

      const playerEvent = create(PlayerEventSchema, {
        type: PlayerEventType.JOIN,
        playerId: { value: playerId },
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

    const handleSendGameAction = (data: {
      action: "throwPotion";
      targetX: number;
      targetY: number;
    }) => {
      if (!ws || !isConnected) return;

      let actionType: (typeof ActionType)[keyof typeof ActionType];
      switch (data.action) {
        case "throwPotion":
          actionType = ActionType.THROW_POTION;
          break;
        default:
          return;
      }

      const playerEvent = create(PlayerEventSchema, {
        type: PlayerEventType.ACTION,
        playerId: { value: getPlayerId() },
        gameAction: create(GameActionSchema, {
          action: actionType,
          target: { x: data.targetX, y: data.targetY },
        }),
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

    EventBus.on("send-input-change", handleSendInputChange);
    EventBus.on("send-player-join", handleSendJoin);
    EventBus.on("send-game-action", handleSendGameAction);

    return () => {
      EventBus.removeListener("send-input-change");
      EventBus.removeListener("send-player-join");
      EventBus.removeListener("send-game-action");
    };
  }, [ws, isConnected]);

  const handleReady = () => {
    if (!ws || !isConnected) return;

    setIsReady(true);

    EventBus.emit("multiplayer-game-start");

    const playerEvent = create(PlayerEventSchema, {
      type: PlayerEventType.READY,
      playerId: { value: getPlayerId() },
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

    focusGame();
  };

  return (
    <div
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        backgroundColor: "#1a1a1a",
      }}
    >
      <div
        id="game-content"
        ref={gameRef}
        onClick={focusGame}
        style={{ width: "100%", height: "100%" }}
      />

      {/* Lobby UI Overlay - only show when not ready */}
      {!isReady && (
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
                  Waiting ({lobbyUsers.length}):{" "}
                </div>
                <div
                  style={{
                    backgroundColor: "#1a1a1a",
                    padding: "8px",
                    borderRadius: "4px",
                    maxHeight: "60px",
                    overflowY: "auto",
                    fontSize: "12px",
                  }}
                >
                  {lobbyUsers.length > 0 ? (
                    lobbyUsers.map((user, idx) => (
                      <div
                        key={idx}
                        style={{ padding: "2px 0", color: "#aaa" }}
                      >
                        {user.name}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#888" }}>No players waiting</div>
                  )}
                </div>
              </div>

              <div style={{ marginBottom: "15px" }}>
                <div style={{ fontSize: "14px", marginBottom: "5px" }}>
                  Gaming ({gameUsers.length}):
                </div>
                <div
                  style={{
                    backgroundColor: "#1a1a1a",
                    padding: "8px",
                    borderRadius: "4px",
                    maxHeight: "60px",
                    overflowY: "auto",
                    fontSize: "12px",
                  }}
                >
                  {gameUsers.length > 0 ? (
                    gameUsers.map((user, idx) => (
                      <div
                        key={idx}
                        style={{ padding: "2px 0", color: "#44ff44" }}
                      >
                        {user.name}
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#888" }}>No players in game</div>
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
                {isReady ? "Ready!" : isGuest ? "Ready as Guest" : "Ready"}
              </button>

              {isGuest && (
                <button
                  onClick={() => setShowLoginModal(true)}
                  style={{
                    width: "100%",
                    padding: "8px",
                    marginTop: "8px",
                    backgroundColor: "#4a9eff",
                    border: "none",
                    borderRadius: "4px",
                    color: "white",
                    fontSize: "14px",
                    fontWeight: "bold",
                    cursor: "pointer",
                  }}
                >
                  Sign In
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  disconnect();
                  onLeave?.();
                }}
                style={{
                  width: "100%",
                  padding: "8px",
                  marginTop: "8px",
                  backgroundColor: "#666",
                  border: "none",
                  borderRadius: "4px",
                  color: "white",
                  fontSize: "14px",
                  fontWeight: "bold",
                  cursor: "pointer",
                }}
              >
                Leave
              </button>
            </>
          )}
        </div>
      )}

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
            onFocus={() => setIsChatFocused(true)}
            onBlur={() => setIsChatFocused(false)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                e.preventDefault();
                focusGame();
              }
            }}
            onKeyUp={(e) => e.stopPropagation()}
            placeholder="Press Enter to chat..."
            disabled={!isConnected}
            style={{
              flex: 1,
              padding: "8px",
              backgroundColor: "rgba(0, 0, 0, 0.8)",
              border: isChatFocused ? "1px solid #4a9eff" : "1px solid #444",
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

      {/* Login Modal for guests */}
      <LoginModal
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        onLoginSuccess={(userInfo) => {
          setShowLoginModal(false);
          if (onLoginSuccess) {
            onLoginSuccess(userInfo, reconnectWithToken);
          }
        }}
      />
    </div>
  );
};

export default MultiplayerPhaserGame;
