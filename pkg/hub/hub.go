package hub

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
	"github.com/sonastea/WizardWarriors/pkg/config"
	"github.com/sonastea/WizardWarriors/pkg/logger"
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
	botManager       *BotManager
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
		// Clean up bot keys only on game server startup
		hub.redis.Del(ctx, RedisKeyBotGame, RedisKeyBotNames)
		gameMap, err := LoadMapFromFile(cfg.MapPath)
		if err != nil {
			return nil, fmt.Errorf("failed to load game map: %w", err)
		}
		logger.Info("Loaded game map: %dx%d tiles (%dx%d pixels)",
			gameMap.Width, gameMap.Height, int(gameMap.PixelWidth), int(gameMap.PixelHeight))

		// Initialize game state manager with 30ms tick rate (33 updates/sec)
		hub.gameStateManager = NewGameStateManager(hub, gameMap, 30*time.Millisecond)

		// Initialize bot manager and spawn bots
		hub.botManager = NewBotManager(hub.redis, hub.gameStateManager, gameMap)
		if err := hub.botManager.Initialize(ctx); err != nil {
			logger.Error("Failed to initialize bots: %v", err)
		}

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
		logger.Error("Failed to add user to lobby in Redis: %v", err)
	}

	// Store the username mapping in Redis so we can look it up later
	if err := hub.redis.HSet(ctx, "lobby:usernames", client.UserID, client.Username).Err(); err != nil {
		logger.Error("Failed to store username in Redis: %v", err)
	}

	logger.Info("%s (%s) connected - connection pool size: %d", client.Username, client.UserID, hub.getTotalClients())
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
		logger.Error("Failed to remove user from lobby in Redis: %v", err)
	}
	// Remove username mapping
	if err := hub.redis.HDel(ctx, "lobby:usernames", client.UserID).Err(); err != nil {
		logger.Error("Failed to remove username from Redis: %v", err)
	}
	// Also remove from game users set
	if err := hub.redis.SRem(ctx, RedisKeyGameUsers, client.UserID).Err(); err != nil {
		logger.Error("Failed to remove user from game in Redis: %v", err)
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

// RefreshSession extends the TTL of a game session token
func (hub *Hub) RefreshSession(token string) error {
	ctx := context.Background()
	key := "gamesession:token:" + token
	// Check if the session exists before refreshing
	exists, err := hub.redis.Exists(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("failed to check session existence: %w", err)
	}
	if exists == 0 {
		return fmt.Errorf("session not found or expired")
	}

	// Extend the TTL to 30 minutes
	if err := hub.redis.Expire(ctx, key, 30*time.Minute).Err(); err != nil {
		return fmt.Errorf("failed to refresh session: %w", err)
	}

	return nil
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
	// Skip if no clients connected
	hub.clientsMu.RLock()
	clientCount := len(hub.clients)
	hub.clientsMu.RUnlock()
	if clientCount == 0 {
		return
	}

	logger.Info("broadcastLobbyState: broadcasting to %d clients (pubsub=%v, botMgr=%v)", clientCount, hub.pubsubEnabled, hub.botManager != nil)
	ctx := context.Background()

	// Get lobby and game users from Redis
	lobbyUserIds, err := hub.redis.SMembers(ctx, RedisKeyLobbyUsers).Result()
	if err != nil {
		logger.Error("Failed to get lobby users from Redis: %v", err)
		return
	}

	gameUserIds, err := hub.redis.SMembers(ctx, RedisKeyGameUsers).Result()
	if err != nil {
		logger.Error("Failed to get game users from Redis: %v", err)
		return
	}

	// Get username mappings from Redis
	usernames, err := hub.redis.HGetAll(ctx, "lobby:usernames").Result()
	if err != nil {
		logger.Error("Failed to get usernames from Redis: %v", err)
		usernames = make(map[string]string)
	}

	// Build lobby user list (humans only)
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

	// Build game user list (humans + bots)
	gameUsers := make([]*multiplayerv1.LobbyUser, 0, len(gameUserIds)+BotCount)
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

	// Add bots to game user list (read from Redis so both API and game servers see them)
	botIDs, err := hub.redis.SMembers(ctx, RedisKeyBotGame).Result()
	if err != nil {
		logger.Error("Failed to get bot IDs from Redis: %v", err)
		botIDs = []string{}
	}
	botNames, err := hub.redis.HGetAll(ctx, RedisKeyBotNames).Result()
	if err != nil {
		logger.Error("Failed to get bot names from Redis: %v", err)
		botNames = make(map[string]string)
	}
	logger.Info("broadcastLobbyState: adding %d bots to game users", len(botIDs))
	for _, botID := range botIDs {
		name := botNames[botID]
		if name == "" {
			name = "Bot"
		}
		gameUsers = append(gameUsers, &multiplayerv1.LobbyUser{
			UserId:  &multiplayerv1.ID{Value: botID},
			Name:    name,
			IsReady: true,
		})
	}

	lobbyState := &multiplayerv1.LobbyState{
		LobbyUsers: lobbyUsers,
		GameUsers:  gameUsers,
	}

	logger.Info("broadcastLobbyState: lobbyUsers=%d, gameUsers=%d", len(lobbyUsers), len(gameUsers))

	gameMsg := &multiplayerv1.GameMessage{
		Type: multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_LOBBY_STATE,
		Payload: &multiplayerv1.GameMessage_LobbyState{
			LobbyState: lobbyState,
		},
	}
	logger.Debug("broadcastLobbyState: sent %+v", gameMsg)

	wire, err := proto.Marshal(gameMsg)
	if err != nil {
		logger.Error("broadcastLobbyState: failed to marshal: %v", err)
		return
	}

	hub.broadcastToClients(wire)
}
