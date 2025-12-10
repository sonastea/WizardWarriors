package hub

import (
	"context"
	"fmt"
	"log"

	"github.com/redis/go-redis/v9"
	"github.com/sonastea/WizardWarriors/pkg/config"
	"google.golang.org/protobuf/proto"

	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
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
		log.Fatalln("Unable to create redis client")
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
			for {
				select {
				case <-ctx.Done():
					return
				case msg, ok := <-ch.Channel():
					if !ok {
						return
					}

					gameMsg := &multiplayerv1.GameMessage{}
					if err := proto.Unmarshal([]byte(msg.Payload), gameMsg); err != nil {
						log.Printf("Failed to unmarshal GameMessage: %v", err)
						continue
					}

					switch gameMsg.Type {
					case multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_CHAT_MESSAGE:
						if chatMsg := gameMsg.GetChatMessage(); chatMsg != nil {
							log.Printf("Chat from %v: %s", chatMsg.SenderId, chatMsg.Text)
							wire, _ := toWire(gameMsg)
							hub.broadcastToClients(wire)
						}

					case multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_PLAYER_EVENT:
						if playerEvent := gameMsg.GetPlayerEvent(); playerEvent != nil {
							log.Printf("Player event: %v for player %v", playerEvent.Type, playerEvent.PlayerId)

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
										log.Printf("Failed to move user to game in Redis: %v", err)
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
								log.Printf("Ignoring deprecated MOVE event from %v", playerEvent.PlayerId)

							case multiplayerv1.PlayerEventType_PLAYER_EVENT_TYPE_LEAVE:
								if playerEvent.PlayerId != nil {
									hub.gameStateManager.RemovePlayer(playerEvent.PlayerId.Value)

									// Remove user from game set in Redis (they'll be removed from lobby on disconnect)
									if err := hub.redis.SRem(context.Background(), RedisKeyGameUsers, playerEvent.PlayerId.Value).Err(); err != nil {
										log.Printf("Failed to remove user from game in Redis: %v", err)
									}

									wire, _ := toWire(gameMsg)
									hub.broadcastToClients(wire)

									// Broadcast updated lobby state
									hub.broadcastLobbyState()
								}
							}
						}

					case multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_GAME_STATE:
						if gameState := gameMsg.GetGameState(); gameState != nil {
							log.Printf("Game state update with %d players", len(gameState.Players))
						}

					case multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_ANNOUNCEMENT:
						if announcement := gameMsg.GetChatAnnouncement(); announcement != nil {
							log.Printf("Announcement: %s", announcement.Text)
						}

					default:
						log.Printf("Unknown message type: %v", gameMsg.Type)
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
