import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ChatMessageSchema,
  GameMessageSchema,
  GameMessageType,
  type LobbyUser,
  type GameMessage,
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
import styles from "./MultiplayerPhaserGame.module.css";

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
    reconnect,
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
        const msg = fromBinary(GameMessageSchema, bytes) as GameMessage;

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
                lobbyState.lobbyUsers.map((u: LobbyUser) => ({
                  odId: u.userId?.value || "",
                  name: u.name || u.userId?.value || "Unknown",
                  isReady: u.isReady,
                }))
              );
              setGameUsers(
                lobbyState.gameUsers.map((u: LobbyUser) => ({
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
    <div className={styles.container}>
      <div
        id="game-content"
        ref={gameRef}
        onClick={focusGame}
        className={styles.gameContent}
      />

      {/* Lobby UI Overlay - only show when not ready */}
      {!isReady && (
        <div className={styles.lobbyOverlay}>
          {/* Corner accents */}
          <span className={`${styles.cornerAccent} ${styles.cornerTopLeft}`} />
          <span className={`${styles.cornerAccent} ${styles.cornerTopRight}`} />
          <span
            className={`${styles.cornerAccent} ${styles.cornerBottomLeft}`}
          />
          <span
            className={`${styles.cornerAccent} ${styles.cornerBottomRight}`}
          />

          {/* Status */}
          <div
            className={`${styles.statusText} ${error || (!isConnected && !isConnecting) ? styles.statusError : ""}`}
          >
            {error
              ? error
              : isConnecting
                ? "Connecting..."
                : isConnected
                  ? "Not Ready"
                  : "Disconnected"}
          </div>

          {/* Disconnected state - show reconnect button */}
          {!isConnected && !isConnecting && (
            <div className={styles.disconnectedActions}>
              <button
                onClick={() => reconnect()}
                className={styles.reconnectButton}
              >
                Reconnect
              </button>
              <button
                onClick={() => window.location.reload()}
                className={styles.refreshButton}
              >
                Refresh Page
              </button>
            </div>
          )}

          {isConnected && (
            <>
              {/* Player lists */}
              <div className={styles.playerListsContainer}>
                {/* Waiting */}
                <div className={styles.playerListColumn}>
                  <div
                    className={`${styles.playerListLabel} ${styles.playerListLabelWaiting}`}
                  >
                    Waiting ({lobbyUsers.length})
                  </div>
                  <div className={styles.playerList}>
                    {lobbyUsers.length > 0 ? (
                      lobbyUsers.map((user, idx) => (
                        <div
                          key={idx}
                          className={`${styles.playerItem} ${
                            user.name === gameStats.username
                              ? styles.playerItemSelf
                              : styles.playerItemWaiting
                          }`}
                        >
                          {user.name}
                          {user.name === gameStats.username && (
                            <span className={styles.playerYouTag}>(You)</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className={styles.emptyList}>—</div>
                    )}
                  </div>
                </div>

                {/* In Game */}
                <div className={styles.playerListColumn}>
                  <div
                    className={`${styles.playerListLabel} ${styles.playerListLabelInGame}`}
                  >
                    In Game ({gameUsers.length})
                  </div>
                  <div className={styles.playerList}>
                    {gameUsers.length > 0 ? (
                      gameUsers.map((user, idx) => (
                        <div
                          key={idx}
                          className={`${styles.playerItem} ${
                            user.name === gameStats.username
                              ? styles.playerItemSelf
                              : styles.playerItemInGame
                          }`}
                        >
                          {user.name}
                          {user.name === gameStats.username && (
                            <span className={styles.playerYouTag}>(You)</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className={styles.emptyList}>—</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Action buttons - horizontal */}
              <div className={styles.actionButtonsContainer}>
                <button
                  onClick={handleReady}
                  disabled={isReady}
                  className={styles.playButton}
                >
                  {isReady ? "Ready!" : "Play"}
                </button>

                {isGuest && (
                  <button
                    onClick={() => setShowLoginModal(true)}
                    className={styles.signInButton}
                  >
                    Sign In
                  </button>
                )}
              </div>

              {/* Leave button */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  disconnect();
                  onLeave?.();
                }}
                className={styles.leaveButton}
              >
                Leave Lobby
              </button>
            </>
          )}
        </div>
      )}

      {/* Chat UI */}
      <div className={styles.chatContainer}>
        <span className={styles.chatUsername}>{gameStats.username}:</span>
        <div className={styles.chatBox}>
          <div className={styles.chatMessages}>
            {chatMessages.length > 0 ? (
              chatMessages.slice(-10).map((msg, idx) => (
                <div key={idx} className={styles.chatMessage}>
                  <span className={styles.chatMessageUsername}>
                    {msg.username}:
                  </span>{" "}
                  <span>{msg.message}</span>
                </div>
              ))
            ) : (
              <div className={styles.chatNoMessages}>No messages</div>
            )}
          </div>

          <form onSubmit={handleSendChat} className={styles.chatForm}>
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
              className={styles.chatInput}
            />
            <button
              type="submit"
              disabled={!isConnected}
              className={styles.chatSendButton}
            >
              Send
            </button>
          </form>
        </div>
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
