package hub

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
	"github.com/sonastea/WizardWarriors/pkg/config"
	"google.golang.org/protobuf/proto"
)

// Redis keys for lobby state
const (
	RedisKeyLobbyUsers = "lobby:users"
	RedisKeyGameUsers  = "game:users"
)

type Hub struct {
	register   chan *Client
	unregister chan *Client

	// users     []models.User
	clientsMu sync.RWMutex
	clients   map[*Client]bool
	// rooms     map[*Room]bool
	// roomsLive map[string]*Room

	redis            *redis.Client
	pubsub           *PubSub
	pubsubEnabled    bool
	gameStateManager *GameStateManager
}

func New(cfg *config.Config) (*Hub, error) {
	pubsub, err := NewPubSub(cfg)
	if err != nil {
		return nil, err
	}

	hub := &Hub{
		register:   make(chan *Client),
		unregister: make(chan *Client),

		clients: make(map[*Client]bool),

		redis:         pubsub.conn,
		pubsub:        pubsub,
		pubsubEnabled: !cfg.IsAPIServer,
	}

	ctx := context.Background()
	hub.redis.Del(ctx, RedisKeyLobbyUsers, RedisKeyGameUsers, "lobby:usernames")

	if !cfg.IsAPIServer {
		gameMap, err := LoadMapFromFile(cfg.MapPath)
		if err != nil {
			return nil, fmt.Errorf("failed to load game map: %w", err)
		}
		log.Printf("Loaded game map: %dx%d tiles (%dx%d pixels)",
			gameMap.Width, gameMap.Height, int(gameMap.PixelWidth), int(gameMap.PixelHeight))

		// Initialize game state manager with 30ms tick rate (33 updates/sec)
		hub.gameStateManager = NewGameStateManager(hub, gameMap, 30*time.Millisecond)
		hub.gameStateManager.Start()
	}

	return hub, nil
}

func (hub *Hub) Run(ctx context.Context) {
	if hub.pubsubEnabled {
		go hub.ListenPubSub(ctx)
	}

	for {
		select {

		case client := <-hub.register:
			hub.addClient(client)

		case client := <-hub.unregister:
			hub.removeClient(client)
		}
	}
}

func (h *Hub) getTotalClients() int {
	return len(h.clients)
}

func (hub *Hub) addClient(client *Client) {
	hub.clientsMu.Lock()
	hub.clients[client] = true
	hub.clientsMu.Unlock()

	// Add user to lobby set in Redis
	ctx := context.Background()
	if err := hub.redis.SAdd(ctx, RedisKeyLobbyUsers, client.UserID).Err(); err != nil {
		log.Printf("Failed to add user to lobby in Redis: %v", err)
	}

	// Store the username mapping in Redis so we can look it up later
	if err := hub.redis.HSet(ctx, "lobby:usernames", client.UserID, client.Username).Err(); err != nil {
		log.Printf("Failed to store username in Redis: %v", err)
	}

	log.Printf("%s (%s) connected - connection pool size: %d", client.Username, client.UserID, hub.getTotalClients())
	hub.broadcastLobbyState()
}

func (hub *Hub) removeClient(client *Client) {
	hub.clientsMu.Lock()
	if _, ok := hub.clients[client]; ok {
		delete(hub.clients, client)
		fmt.Println("Remaining size of connection pool: ", len(hub.clients))
	}
	hub.clientsMu.Unlock()

	// Remove user from both lobby and game sets in Redis
	ctx := context.Background()
	if err := hub.redis.SRem(ctx, RedisKeyLobbyUsers, client.UserID).Err(); err != nil {
		log.Printf("Failed to remove user from lobby in Redis: %v", err)
	}
	// Remove username mapping
	if err := hub.redis.HDel(ctx, "lobby:usernames", client.UserID).Err(); err != nil {
		log.Printf("Failed to remove username from Redis: %v", err)
	}
	// Also remove from game users set
	if err := hub.redis.SRem(ctx, RedisKeyGameUsers, client.UserID).Err(); err != nil {
		log.Printf("Failed to remove user from game in Redis: %v", err)
	}

	hub.broadcastLobbyState()
}

func (hub *Hub) broadcastToClients(message []byte) {
	hub.clientsMu.RLock()
	defer hub.clientsMu.RUnlock()
	for client := range hub.clients {
		client.sendChan <- message
	}
}

// SessionInfo contains user information associated with a game session
type SessionInfo struct {
	UserID   string
	Username string
}

// GetSessionInfo retrieves user information from a game session token
func (hub *Hub) GetSessionInfo(token string) (*SessionInfo, error) {
	ctx := context.Background()
	result, err := hub.redis.HGetAll(ctx, "gamesession:token:"+token).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get session info: %w", err)
	}

	if len(result) == 0 {
		return nil, fmt.Errorf("session not found or expired")
	}

	return &SessionInfo{
		UserID:   result["user_id"],
		Username: result["username"],
	}, nil
}

// MoveUserToGame moves a user from the lobby set to the game set in Redis
func (hub *Hub) MoveUserToGame(userId string) error {
	ctx := context.Background()
	pipe := hub.redis.Pipeline()
	pipe.SRem(ctx, RedisKeyLobbyUsers, userId)
	pipe.SAdd(ctx, RedisKeyGameUsers, userId)
	_, err := pipe.Exec(ctx)
	return err
}

// MoveUserToLobby moves a user from the game set back to the lobby set in Redis
func (hub *Hub) MoveUserToLobby(userId string) error {
	ctx := context.Background()
	pipe := hub.redis.Pipeline()
	pipe.SRem(ctx, RedisKeyGameUsers, userId)
	pipe.SAdd(ctx, RedisKeyLobbyUsers, userId)
	_, err := pipe.Exec(ctx)
	return err
}

// broadcastLobbyState sends the current lobby and game user state to all clients
func (hub *Hub) broadcastLobbyState() {
	ctx := context.Background()

	// Get lobby and game users from Redis
	lobbyUserIds, err := hub.redis.SMembers(ctx, RedisKeyLobbyUsers).Result()
	if err != nil {
		log.Printf("Failed to get lobby users from Redis: %v", err)
		return
	}

	gameUserIds, err := hub.redis.SMembers(ctx, RedisKeyGameUsers).Result()
	if err != nil {
		log.Printf("Failed to get game users from Redis: %v", err)
		return
	}

	// Get username mappings from Redis
	usernames, err := hub.redis.HGetAll(ctx, "lobby:usernames").Result()
	if err != nil {
		log.Printf("Failed to get usernames from Redis: %v", err)
		usernames = make(map[string]string)
	}

	// Build lobby user list
	lobbyUsers := make([]*multiplayerv1.LobbyUser, 0, len(lobbyUserIds))
	for _, id := range lobbyUserIds {
		username := usernames[id]
		if username == "" {
			username = "Unknown"
		}
		lobbyUsers = append(lobbyUsers, &multiplayerv1.LobbyUser{
			UserId:  &multiplayerv1.ID{Value: id},
			Name:    username,
			IsReady: false,
		})
	}

	// Build game user list
	gameUsers := make([]*multiplayerv1.LobbyUser, 0, len(gameUserIds))
	for _, id := range gameUserIds {
		username := usernames[id]
		if username == "" {
			username = "Unknown"
		}
		gameUsers = append(gameUsers, &multiplayerv1.LobbyUser{
			UserId:  &multiplayerv1.ID{Value: id},
			Name:    username,
			IsReady: true,
		})
	}

	lobbyState := &multiplayerv1.LobbyState{
		LobbyUsers: lobbyUsers,
		GameUsers:  gameUsers,
	}

	gameMsg := &multiplayerv1.GameMessage{
		Type: multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_LOBBY_STATE,
		Payload: &multiplayerv1.GameMessage_LobbyState{
			LobbyState: lobbyState,
		},
	}

	wire, err := proto.Marshal(gameMsg)
	if err != nil {
		return
	}

	hub.broadcastToClients(wire)
}
