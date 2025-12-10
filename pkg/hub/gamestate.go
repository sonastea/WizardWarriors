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
	MapWidth      float32 = 2000
	MapHeight     float32 = 2000
	PlayerRadius  float32 = 16
	PlayerSpeed   float32 = 200 // pixels per second
	SlowdownSpeed float32 = 80  // speed in slowdown zones
)

// TerrainZone represents an area with special properties
type TerrainZone struct {
	X      float32
	Y      float32
	Width  float32
	Height float32
	Type   string // "water" or "slowdown"
}

// Terrain zones - must match client-side terrain
var TerrainZones = []TerrainZone{
	// Water ponds (impassable)
	{X: 150, Y: 300, Width: 200, Height: 150, Type: "water"},
	{X: 1600, Y: 200, Width: 250, Height: 180, Type: "water"},
	{X: 800, Y: 1500, Width: 300, Height: 200, Type: "water"},
	{X: 100, Y: 1700, Width: 180, Height: 150, Type: "water"},

	// Quicksand/mud areas (slowdown)
	{X: 500, Y: 100, Width: 250, Height: 200, Type: "slowdown"},
	{X: 1200, Y: 600, Width: 300, Height: 250, Type: "slowdown"},
	{X: 300, Y: 1000, Width: 200, Height: 300, Type: "slowdown"},
	{X: 1500, Y: 1300, Width: 280, Height: 220, Type: "slowdown"},
	{X: 900, Y: 400, Width: 180, Height: 150, Type: "slowdown"},
}

type PlayerState struct {
	UserID   string
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
func (gsm *GameStateManager) AddPlayer(userID string, username string) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	// Server generates spawn position (client suggestion is ignored for security)
	// Keep trying until we find a position not in water
	var spawnX, spawnY float32
	maxAttempts := 100
	for range maxAttempts {
		spawnX = PlayerRadius + rand.Float32()*(MapWidth-2*PlayerRadius)
		spawnY = PlayerRadius + rand.Float32()*(MapHeight-2*PlayerRadius)
		if !isInWater(spawnX, spawnY) {
			break
		}
	}

	gsm.players[userID] = &PlayerState{
		UserID:   userID,
		Username: username,
		X:        spawnX,
		Y:        spawnY,
	}
}

// GetPlayerPosition returns the server-authoritative position for a player
func (gsm *GameStateManager) GetPlayerPosition(userID string) (float32, float32, bool) {
	gsm.mu.RLock()
	defer gsm.mu.RUnlock()

	if player, exists := gsm.players[userID]; exists {
		return player.X, player.Y, true
	}
	return 0, 0, false
}

func (gsm *GameStateManager) RemovePlayer(userID string) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	delete(gsm.players, userID)
}

// UpdatePlayerInputAction updates a single input state based on key press/release event
func (gsm *GameStateManager) UpdatePlayerInputAction(userID string, inputAction *multiplayerv1.InputAction) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	if player, exists := gsm.players[userID]; exists && inputAction != nil {
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

// isInZone checks if a point is inside a terrain zone
func isInZone(x, y float32, zone TerrainZone) bool {
	return x >= zone.X && x <= zone.X+zone.Width &&
		y >= zone.Y && y <= zone.Y+zone.Height
}

// isInWater checks if a position is inside any water zone
func isInWater(x, y float32) bool {
	for _, zone := range TerrainZones {
		if zone.Type == "water" && isInZone(x, y, zone) {
			return true
		}
	}
	return false
}

// isInSlowdown checks if a position is inside any slowdown zone
func isInSlowdown(x, y float32) bool {
	for _, zone := range TerrainZones {
		if zone.Type == "slowdown" && isInZone(x, y, zone) {
			return true
		}
	}
	return false
}

// simulateMovement processes all player inputs and updates positions
func (gsm *GameStateManager) simulateMovement(deltaSeconds float32) {
	for _, player := range gsm.players {
		// Determine speed based on terrain
		speed := PlayerSpeed
		if isInSlowdown(player.X, player.Y) {
			speed = SlowdownSpeed
		}

		var velocityX, velocityY float32 = 0, 0

		if player.MoveUp {
			velocityY = -speed
		}
		if player.MoveDown {
			velocityY = speed
		}
		if player.MoveLeft {
			velocityX = -speed
		}
		if player.MoveRight {
			velocityX = speed
		}

		// Calculate new position
		newX := player.X + velocityX*deltaSeconds
		newY := player.Y + velocityY*deltaSeconds

		// Clamp to map boundaries (server enforces this)
		newX = clamp(newX, PlayerRadius, MapWidth-PlayerRadius)
		newY = clamp(newY, PlayerRadius, MapHeight-PlayerRadius)

		// Check water collision - only update if new position is not in water
		if !isInWater(newX, newY) {
			player.X = newX
			player.Y = newY
		} else {
			// Try moving in X direction only
			if !isInWater(newX, player.Y) {
				player.X = newX
			}
			// Try moving in Y direction only
			if !isInWater(player.X, newY) {
				player.Y = newY
			}
		}
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

// GetPlayerIds returns a list of all player IDs currently in the game
func (gsm *GameStateManager) GetPlayerIds() []string {
	gsm.mu.RLock()
	defer gsm.mu.RUnlock()

	ids := make([]string, 0, len(gsm.players))
	for id := range gsm.players {
		ids = append(ids, id)
	}
	return ids
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
			PlayerId: &multiplayerv1.ID{Value: player.UserID},
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
