package hub

import (
	"math/rand"
	"sync"
	"time"

	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
	"google.golang.org/protobuf/proto"
)

// Map constants - server is authoritative over these
const (
	MapWidth     float32 = 2000
	MapHeight    float32 = 2000
	PlayerRadius float32 = 16
	PlayerSpeed  float32 = 200 // pixels per second
)

type PlayerState struct {
	PlayerId string
	Username string
	X        float32
	Y        float32

	MoveUp    bool
	MoveDown  bool
	MoveLeft  bool
	MoveRight bool
}

type GameStateManager struct {
	mu       sync.RWMutex
	players  map[string]*PlayerState
	hub      *Hub
	tickRate time.Duration
	lastTick time.Time
}

func NewGameStateManager(hub *Hub, tickRate time.Duration) *GameStateManager {
	return &GameStateManager{
		players:  make(map[string]*PlayerState),
		hub:      hub,
		tickRate: tickRate,
		lastTick: time.Now(),
	}
}

// AddPlayer spawns a player at a random valid position within map bounds
func (gsm *GameStateManager) AddPlayer(playerId string, username string) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	// Server generates spawn position (client suggestion is ignored for security)
	spawnX := PlayerRadius + rand.Float32()*(MapWidth-2*PlayerRadius)
	spawnY := PlayerRadius + rand.Float32()*(MapHeight-2*PlayerRadius)

	gsm.players[playerId] = &PlayerState{
		PlayerId: playerId,
		Username: username,
		X:        spawnX,
		Y:        spawnY,
	}
}

// GetPlayerPosition returns the server-authoritative position for a player
func (gsm *GameStateManager) GetPlayerPosition(playerId string) (float32, float32, bool) {
	gsm.mu.RLock()
	defer gsm.mu.RUnlock()

	if player, exists := gsm.players[playerId]; exists {
		return player.X, player.Y, true
	}
	return 0, 0, false
}

func (gsm *GameStateManager) RemovePlayer(playerId string) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	delete(gsm.players, playerId)
}

// UpdatePlayerInputAction updates a single input state based on key press/release event
func (gsm *GameStateManager) UpdatePlayerInputAction(playerId string, inputAction *multiplayerv1.InputAction) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	if player, exists := gsm.players[playerId]; exists && inputAction != nil {
		switch inputAction.Input {
		case multiplayerv1.InputType_INPUT_TYPE_MOVE_UP:
			player.MoveUp = inputAction.Pressed
		case multiplayerv1.InputType_INPUT_TYPE_MOVE_DOWN:
			player.MoveDown = inputAction.Pressed
		case multiplayerv1.InputType_INPUT_TYPE_MOVE_LEFT:
			player.MoveLeft = inputAction.Pressed
		case multiplayerv1.InputType_INPUT_TYPE_MOVE_RIGHT:
			player.MoveRight = inputAction.Pressed
		}
	}
}

// clamp restricts a value to be within [min, max]
func clamp(value, min, max float32) float32 {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

// simulateMovement processes all player inputs and updates positions
func (gsm *GameStateManager) simulateMovement(deltaSeconds float32) {
	for _, player := range gsm.players {
		var velocityX, velocityY float32 = 0, 0

		if player.MoveUp {
			velocityY = -PlayerSpeed
		}
		if player.MoveDown {
			velocityY = PlayerSpeed
		}
		if player.MoveLeft {
			velocityX = -PlayerSpeed
		}
		if player.MoveRight {
			velocityX = PlayerSpeed
		}

		// Update position
		player.X += velocityX * deltaSeconds
		player.Y += velocityY * deltaSeconds

		// Clamp to map boundaries (server enforces this)
		player.X = clamp(player.X, PlayerRadius, MapWidth-PlayerRadius)
		player.Y = clamp(player.Y, PlayerRadius, MapHeight-PlayerRadius)
	}
}

func (gsm *GameStateManager) GetPlayers() []*PlayerState {
	gsm.mu.RLock()
	defer gsm.mu.RUnlock()

	players := make([]*PlayerState, 0, len(gsm.players))
	for _, player := range gsm.players {
		players = append(players, player)
	}
	return players
}

func (gsm *GameStateManager) Start() {
	ticker := time.NewTicker(gsm.tickRate)
	go func() {
		for range ticker.C {
			gsm.tick()
		}
	}()
}

// tick runs the game simulation and broadcasts state
func (gsm *GameStateManager) tick() {
	gsm.mu.Lock()

	// Calculate delta time since last tick
	now := time.Now()
	deltaSeconds := float32(now.Sub(gsm.lastTick).Seconds())
	gsm.lastTick = now

	// Simulate all player movement based on their inputs
	gsm.simulateMovement(deltaSeconds)

	// Skip broadcast if no players
	if len(gsm.players) == 0 {
		gsm.mu.Unlock()
		return
	}

	// Build game state message
	playerStates := make([]*multiplayerv1.PlayerState, 0, len(gsm.players))
	for _, player := range gsm.players {
		playerStates = append(playerStates, &multiplayerv1.PlayerState{
			PlayerId: &multiplayerv1.ID{Value: player.PlayerId},
			Position: &multiplayerv1.Vector2{
				X: player.X,
				Y: player.Y,
			},
		})
	}

	gsm.mu.Unlock()

	gameState := &multiplayerv1.GameState{
		Players: playerStates,
	}

	gameMsg := &multiplayerv1.GameMessage{
		Type: multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_GAME_STATE,
		Payload: &multiplayerv1.GameMessage_GameState{
			GameState: gameState,
		},
	}

	wire, err := proto.Marshal(gameMsg)
	if err != nil {
		return
	}

	gsm.hub.broadcastToClients(wire)
}
