package hub

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
	"github.com/sonastea/WizardWarriors/pkg/config"
	"github.com/sonastea/WizardWarriors/pkg/logger"
	"google.golang.org/protobuf/proto"
)

type Space string

type PubSub struct {
	conn          *redis.Client
	subs          []Space
	subscriptions map[Space]*redis.PubSub
}

func NewPubSub(cfg *config.Config) (*PubSub, error) {
	rdsClient := redis.NewClient(cfg.RedisOpts)
	if rdsClient == nil {
		logger.Fatal("Unable to create redis client")
	}

	subs := []Space{
		"chat.lobby",
		"chat.game",
	}

	pubsub := &PubSub{
		conn:          rdsClient,
		subs:          subs,
		subscriptions: make(map[Space]*redis.PubSub),
	}

	return pubsub, nil
}

func (hub *Hub) ListenPubSub(ctx context.Context) {
	for _, sub := range hub.pubsub.subs {
		ch := hub.pubsub.conn.PSubscribe(ctx, string(sub))
		hub.pubsub.subscriptions[sub] = ch
	}

	for chName, pubsubCh := range hub.pubsub.subscriptions {
		go func(space Space, ch *redis.PubSub) {
			msgChan := ch.Channel()
			for {
				select {
				case <-ctx.Done():
					return
				case msg, ok := <-msgChan:
					if !ok {
						return
					}

					gameMsg := &multiplayerv1.GameMessage{}
					if err := proto.Unmarshal([]byte(msg.Payload), gameMsg); err != nil {
						logger.Error("Failed to unmarshal GameMessage: %v", err)
						continue
					}

					switch gameMsg.Type {
					case multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_CHAT_MESSAGE:
						if chatMsg := gameMsg.GetChatMessage(); chatMsg != nil {
							logger.Info("Chat from %v: %s", chatMsg.SenderId, chatMsg.Text)
							wire, _ := toWire(gameMsg)
							hub.broadcastToClients(wire)
						}

					case multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_PLAYER_EVENT:
						if playerEvent := gameMsg.GetPlayerEvent(); playerEvent != nil {
							logger.Debug("Player event: %v for player %v", playerEvent.Type, playerEvent.PlayerId)

							switch playerEvent.Type {
							case multiplayerv1.PlayerEventType_PLAYER_EVENT_TYPE_JOIN:
								if playerEvent.PlayerId != nil {
									// Look up the username from Redis using the user's ID
									userID := playerEvent.PlayerId.Value
									username, err := hub.redis.HGet(context.Background(), "lobby:usernames", userID).Result()
									if err != nil || username == "" {
										username = "Unknown"
									}

									// Server generates spawn position (ignores client suggestion)
									hub.gameStateManager.AddPlayer(
										userID,
										username,
									)

									// Move user from lobby to game in Redis
									if err := hub.MoveUserToGame(userID); err != nil {
										logger.Error("Failed to move user to game in Redis: %v", err)
									}

									// Get the server-assigned position to send back
									x, y, _ := hub.gameStateManager.GetPlayerPosition(userID)

									// Create a new join event with server-assigned position
									joinMsg := &multiplayerv1.GameMessage{
										Type: multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_PLAYER_EVENT,
										Payload: &multiplayerv1.GameMessage_PlayerEvent{
											PlayerEvent: &multiplayerv1.PlayerEvent{
												Type:     multiplayerv1.PlayerEventType_PLAYER_EVENT_TYPE_JOIN,
												PlayerId: playerEvent.PlayerId,
												Position: &multiplayerv1.Vector2{X: x, Y: y},
											},
										},
									}

									wire, _ := toWire(joinMsg)
									hub.broadcastToClients(wire)

									// Broadcast updated lobby state
									hub.broadcastLobbyState()
								}

							case multiplayerv1.PlayerEventType_PLAYER_EVENT_TYPE_INPUT:
								// Client sends single input change (key press/release)
								if playerEvent.PlayerId != nil && playerEvent.InputAction != nil {
									hub.gameStateManager.UpdatePlayerInputAction(
										playerEvent.PlayerId.Value,
										playerEvent.InputAction,
									)
								}

							case multiplayerv1.PlayerEventType_PLAYER_EVENT_TYPE_MOVE:
								// Deprecated: ignore position updates from clients
								// Server is authoritative - only INPUT events affect movement
								logger.Warn("Ignoring deprecated MOVE event from %v", playerEvent.PlayerId)

							case multiplayerv1.PlayerEventType_PLAYER_EVENT_TYPE_LEAVE:
								if playerEvent.PlayerId != nil {
									hub.gameStateManager.RemovePlayer(playerEvent.PlayerId.Value)

									// Remove user from game set in Redis (they'll be removed from lobby on disconnect)
									if err := hub.redis.SRem(context.Background(), RedisKeyGameUsers, playerEvent.PlayerId.Value).Err(); err != nil {
										logger.Error("Failed to remove user from game in Redis: %v", err)
									}

									wire, _ := toWire(gameMsg)
									hub.broadcastToClients(wire)

									// Broadcast updated lobby state
									hub.broadcastLobbyState()
								}

							case multiplayerv1.PlayerEventType_PLAYER_EVENT_TYPE_ACTION:
								// Handle game actions (fire, abilities, etc.)
								logger.Info("Received ACTION event from player %v", playerEvent.PlayerId)
								if playerEvent.PlayerId != nil && playerEvent.GameAction != nil {
									logger.Info("Processing game action: %v with target (%.1f, %.1f)",
										playerEvent.GameAction.Action,
										playerEvent.GameAction.Target.GetX(),
										playerEvent.GameAction.Target.GetY())
									hub.handleGameAction(
										playerEvent.PlayerId.Value,
										playerEvent.GameAction,
									)
								} else {
									logger.Warn("ACTION event missing PlayerId or GameAction")
								}
							}
						}

					case multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_GAME_STATE:
						if gameState := gameMsg.GetGameState(); gameState != nil {
							logger.Debug("Game state update with %d players", len(gameState.Players))
						}

					case multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_ANNOUNCEMENT:
						if announcement := gameMsg.GetChatAnnouncement(); announcement != nil {
							logger.Info("Announcement: %s", announcement.Text)
						}

					default:
						logger.Warn("Unknown message type: %v", gameMsg.Type)
					}
				}
			}
		}(chName, pubsubCh)
	}
}

func toWire(m *multiplayerv1.GameMessage) ([]byte, error) {
	wire, err := proto.Marshal(m)
	if err != nil {
		return nil, fmt.Errorf("Failed to marshal message to the wire format")
	}

	return wire, nil
}

// handleGameAction processes game actions like throwing potions
func (hub *Hub) handleGameAction(playerID string, action *multiplayerv1.GameAction) {
	if action == nil {
		return
	}

	switch action.Action {
	case multiplayerv1.ActionType_ACTION_TYPE_THROW_POTION:
		hub.gameStateManager.SpawnFreezePotion(
			playerID,
			action.Target.X,
			action.Target.Y,
		)
		logger.Debug("Player %s threw potion toward (%.1f, %.1f)",
			playerID, action.Target.X, action.Target.Y)

	case multiplayerv1.ActionType_ACTION_TYPE_INTERACT:
		// TODO: Implement interact action
		logger.Debug("Player %s used interact (not implemented)", playerID)

	default:
		logger.Warn("Unknown action type: %v from player %s", action.Action, playerID)
	}
}
