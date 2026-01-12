package hub

import (
	"math/rand"
	"sync"
	"time"

	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
	"google.golang.org/protobuf/proto"
)

const (
	PlayerRadius  float32 = 16
	PlayerSpeed   float32 = 200 // pixels per second
	SlowdownSpeed float32 = 80  // speed in slowdown zones
)

type PlayerState struct {
	UserID   string
	Username string
	X        float32
	Y        float32

	MoveUp    bool
	MoveDown  bool
	MoveLeft  bool
	MoveRight bool

	IsFrozen    bool
	FrozenUntil time.Time
}

type GameStateManager struct {
	mu                sync.RWMutex
	players           map[string]*PlayerState
	hub               *Hub
	gameMap           *GameMap
	tickRate          time.Duration
	lastTick          time.Time
	projectileManager *ProjectileManager
}

func NewGameStateManager(hub *Hub, gameMap *GameMap, tickRate time.Duration) *GameStateManager {
	gsm := &GameStateManager{
		players:  make(map[string]*PlayerState),
		hub:      hub,
		gameMap:  gameMap,
		tickRate: tickRate,
		lastTick: time.Now(),
	}
	gsm.projectileManager = NewProjectileManager(gsm)
	return gsm
}

// AddPlayer spawns a player at a random valid position within map bounds
func (gsm *GameStateManager) AddPlayer(userID string, username string) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	// Server generates spawn position (client suggestion is ignored for security)
	// Keep trying until we find a position not in collision
	var spawnX, spawnY float32
	maxAttempts := 100
	for range maxAttempts {
		spawnX = PlayerRadius + rand.Float32()*(gsm.gameMap.PixelWidth-2*PlayerRadius)
		spawnY = PlayerRadius + rand.Float32()*(gsm.gameMap.PixelHeight-2*PlayerRadius)
		if gsm.gameMap.IsValidSpawnPoint(spawnX, spawnY, PlayerRadius) {
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

// FreezePlayer freezes a player for the specified duration in seconds
func (gsm *GameStateManager) FreezePlayer(userID string, duration float64) {
	gsm.mu.Lock()
	defer gsm.mu.Unlock()

	if player, exists := gsm.players[userID]; exists {
		player.IsFrozen = true
		player.FrozenUntil = time.Now().Add(time.Duration(duration * float64(time.Second)))
	}
}

// updateFreezeStates checks and unfreezes players whose freeze duration has expired
func (gsm *GameStateManager) updateFreezeStates() {
	now := time.Now()
	for _, player := range gsm.players {
		if player.IsFrozen && now.After(player.FrozenUntil) {
			player.IsFrozen = false
		}
	}
}

// SpawnFreezePotion spawns a freeze potion projectile from the given player
func (gsm *GameStateManager) SpawnFreezePotion(ownerID string, targetX, targetY float32) string {
	gsm.mu.RLock()
	player, exists := gsm.players[ownerID]
	gsm.mu.RUnlock()

	if !exists {
		return ""
	}

	return gsm.projectileManager.SpawnFreezePotion(ownerID, player.X, player.Y, targetX, targetY)
}

// GetProjectileManager returns the projectile manager
func (gsm *GameStateManager) GetProjectileManager() *ProjectileManager {
	return gsm.projectileManager
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
		// Skip movement if frozen
		if player.IsFrozen {
			continue
		}

		// Determine speed based on terrain
		speed := PlayerSpeed
		if gsm.gameMap.IsInSlowdown(player.X, player.Y) {
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
		newX = clamp(newX, PlayerRadius, gsm.gameMap.PixelWidth-PlayerRadius)
		newY = clamp(newY, PlayerRadius, gsm.gameMap.PixelHeight-PlayerRadius)

		// Check collision - only update if new position doesn't collide
		if !gsm.gameMap.IsCollision(newX, newY, PlayerRadius) {
			player.X = newX
			player.Y = newY
		} else {
			// Try moving in X direction only (allows sliding along walls)
			if !gsm.gameMap.IsCollision(newX, player.Y, PlayerRadius) {
				player.X = newX
			}
			// Try moving in Y direction only
			if !gsm.gameMap.IsCollision(player.X, newY, PlayerRadius) {
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

// GetMapDimensions returns the map width and height in pixels
func (gsm *GameStateManager) GetMapDimensions() (float32, float32) {
	return gsm.gameMap.PixelWidth, gsm.gameMap.PixelHeight
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

	// Update freeze states (unfreeze expired)
	gsm.updateFreezeStates()

	// Update projectiles
	gsm.projectileManager.Update(deltaSeconds, gsm.players)

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
		frozenUntilUnix := float32(0)
		if player.IsFrozen {
			frozenUntilUnix = float32(player.FrozenUntil.Unix())
		}

		playerStates = append(playerStates, &multiplayerv1.PlayerState{
			PlayerId: &multiplayerv1.ID{Value: player.UserID},
			Position: &multiplayerv1.Vector2{
				X: player.X,
				Y: player.Y,
			},
			IsFrozen:    player.IsFrozen,
			FrozenUntil: frozenUntilUnix,
		})
	}

	// Get projectile states
	projectileStates := gsm.projectileManager.GetActiveProjectiles()

	gsm.mu.Unlock()

	gameState := &multiplayerv1.GameState{
		Players:     playerStates,
		Projectiles: projectileStates,
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

	gsm.projectileManager.CleanupInactiveProjectiles()
}
