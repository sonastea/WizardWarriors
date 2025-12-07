package hub

import (
	"context"
	"fmt"
	"log"

	"github.com/redis/go-redis/v9"
	"github.com/sonastea/WizardWarriors/pkg/config"
	"github.com/sonastea/WizardWarriors/pkg/store"
	"google.golang.org/protobuf/proto"

	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
)

type Stores struct {
	UserStore store.UserStore
}

type Space string

type PubSub struct {
	conn          *redis.Client
	subs          []Space
	subscriptions map[Space]*redis.PubSub

	userStore store.UserStore
}

func NewPubSub(cfg *config.Config, stores *Stores, pool *redis.Client) (*PubSub, error) {
	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		log.Fatalf("RedisUrl Error: %s\n", err)
	}

	conn := redis.NewClient(opt)

	subs := []Space{
		"chat.lobby",
		"chat.game",
	}

	var userStore store.UserStore
	if stores != nil {
		userStore = stores.UserStore
	}

	pubsub := &PubSub{
		conn:          conn,
		subs:          subs,
		subscriptions: make(map[Space]*redis.PubSub),

		userStore: userStore,
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

					// Handle based on message type
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
