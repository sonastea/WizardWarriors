package hub

import (
	"container/heap"
	"context"
	"fmt"
	"math"
	"math/rand"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/sonastea/WizardWarriors/pkg/logger"
)

const (
	BotCount             = 9
	BotPathUpdateMs      = 500  // Recompute path every 500ms (slower reactions)
	BotPotionCooldownMs  = 1000 // Potion cooldown (can throw more frequently)
	BotPotionRange       = 130.0
	BotDetectionRange    = 400.0 // Range to detect and chase targets
	BotRoamInterval      = 2000  // Pick new roam target every 2 seconds
	BotAloeSearchRange   = 400.0 // Range to search for aloe when roaming
	BotMinSeparation     = 250.0 // Minimum distance bots try to keep from each other when roaming
	BotClusterThreshold  = 200.0 // If this close to 2+ bots, consider dispersing
	BotSkirmishChance    = 0.20  // 20% chance to target other bot when no humans nearby
	BotLongRangeSkirmish = 0.15  // 15% chance to seek out distant bot across the map
	BotStuckThreshold    = 10    // Ticks without movement before considered stuck
	BotStuckMoveMin      = 3.0   // Minimum movement per tick to not be considered stuck
	RedisKeyBotGame      = "bot:game"
	RedisKeyBotNames     = "bot:usernames"
	RedisKeyBotNamePool  = "bot:names"
)

// BotState holds bot-specific state beyond PlayerState
type BotState struct {
	ID              string
	Name            string
	Path            []PathNode
	PathIndex       int
	LastPathUpdate  time.Time
	LastPotionThrow time.Time
	TargetID        string
	RoamTargetX     float32
	RoamTargetY     float32
	LastRoamUpdate  time.Time
	IsRoaming       bool
	SeekingAloe     bool   // true if currently pathing to aloe
	AloeTargetID    string // ID of aloe being targeted
	LastX           float32
	LastY           float32
	StuckTicks      int // count of consecutive ticks with no movement
}

// BotManager manages bot lifecycle and AI
type BotManager struct {
	mu      sync.RWMutex
	bots    map[string]*BotState
	redis   *redis.Client
	gsm     *GameStateManager
	gameMap *GameMap
}

// NewBotManager creates a new bot manager
func NewBotManager(redis *redis.Client, gsm *GameStateManager, gameMap *GameMap) *BotManager {
	return &BotManager{
		bots:    make(map[string]*BotState, BotCount),
		redis:   redis,
		gsm:     gsm,
		gameMap: gameMap,
	}
}

// Initialize ensures exactly 2 bots exist in Redis and in-memory
func (bm *BotManager) Initialize(ctx context.Context) error {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	namePool, _ := bm.redis.LRange(ctx, RedisKeyBotNamePool, 0, -1).Result()
	logger.Debug("[BotManager] Name pool has %d names", len(namePool))

	for len(bm.bots) < BotCount {
		id := fmt.Sprintf("bot-%d-%d", len(bm.bots)+1, rand.Intn(10000))
		name := bm.generateBotName(len(bm.bots)+1, namePool)

		bm.bots[id] = &BotState{
			ID:   id,
			Name: name,
		}

		if err := bm.redis.SAdd(ctx, RedisKeyBotGame, id).Err(); err != nil {
			logger.Error("Failed to add bot to Redis: %v", err)
		}
		if err := bm.redis.HSet(ctx, RedisKeyBotNames, id, name).Err(); err != nil {
			logger.Error("Failed to set bot name in Redis: %v", err)
		}
		logger.Info("[BotManager] Created bot: %s (%s)", name, id)
	}

	for id, bot := range bm.bots {
		bm.gsm.AddPlayer(id, bot.Name)
		logger.Info("[BotManager] Added bot %s to game state", id)
	}

	logger.Info("[BotManager] Initialized %d bots", len(bm.bots))
	return nil
}

// generateBotName creates a bot name from the bot name pool or fallback
func (bm *BotManager) generateBotName(index int, namePool []string) string {
	if len(namePool) >= index && namePool[index-1] != "" {
		return fmt.Sprintf("Bot-%s", namePool[index-1])
	}
	return fmt.Sprintf("Bot%d", index)
}

// GetBotIDs returns the set of bot IDs for quick membership checks
func (bm *BotManager) GetBotIDs() map[string]struct{} {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	ids := make(map[string]struct{}, len(bm.bots))
	for id := range bm.bots {
		ids[id] = struct{}{}
	}
	return ids
}

// GetBots returns bot info for lobby state broadcasting
func (bm *BotManager) GetBots() []BotState {
	bm.mu.RLock()
	defer bm.mu.RUnlock()

	bots := make([]BotState, 0, len(bm.bots))
	for _, bot := range bm.bots {
		bots = append(bots, *bot)
	}
	return bots
}

// IsBot checks if a player ID is a bot
func (bm *BotManager) IsBot(playerID string) bool {
	bm.mu.RLock()
	defer bm.mu.RUnlock()
	_, exists := bm.bots[playerID]
	return exists
}

// BotAction represents an action a bot wants to perform
type BotAction struct {
	BotID   string
	TargetX float32
	TargetY float32
}

// Update runs bot AI for all bots and returns actions to perform (like throwing potions)
// Actions are returned separately to avoid deadlocks with gsm mutex
func (bm *BotManager) Update(now time.Time, players map[string]*PlayerState) []BotAction {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	var actions []BotAction

	// Track which targets are already claimed by other bots this tick
	claimedTargets := make(map[string]string) // targetID -> botID that claimed it

	// First pass: collect current bot targets
	for botID, bot := range bm.bots {
		if bot.TargetID != "" && !bot.IsRoaming {
			claimedTargets[bot.TargetID] = botID
		}
	}

	for botID, bot := range bm.bots {
		player, exists := players[botID]
		if !exists {
			continue
		}
		if player.IsFrozen {
			player.MoveUp = false
			player.MoveDown = false
			player.MoveLeft = false
			player.MoveRight = false
			continue
		}

		// Stuck detection, check if bot has barely moved since last tick
		movedDist := distance(player.X, player.Y, bot.LastX, bot.LastY)
		if movedDist < BotStuckMoveMin && (player.MoveUp || player.MoveDown || player.MoveLeft || player.MoveRight) {
			bot.StuckTicks++
		} else {
			bot.StuckTicks = 0
		}
		bot.LastX = player.X
		bot.LastY = player.Y

		// If stuck for too long, force a new random roam target away from current position
		if bot.StuckTicks >= BotStuckThreshold {
			bot.StuckTicks = 0
			bot.TargetID = ""
			bot.IsRoaming = true
			bot.SeekingAloe = false
			bot.AloeTargetID = ""
			bm.pickSmartRoamTarget(bot, botID, players)
			bot.Path = bm.computePath(player.X, player.Y, bot.RoamTargetX, bot.RoamTargetY)
			bot.PathIndex = 0
			bot.LastPathUpdate = now
			bot.LastRoamUpdate = now
		}

		// If current target is frozen, clear it and immediately pick a new roam destination
		if bot.TargetID != "" {
			if targetPlayer, exists := players[bot.TargetID]; exists && targetPlayer.IsFrozen {
				bot.TargetID = ""
				bot.IsRoaming = true
				bot.SeekingAloe = false
				// Immediately pick a new destination away from frozen target
				bm.pickSmartRoamTarget(bot, botID, players)
				bot.Path = bm.computePath(player.X, player.Y, bot.RoamTargetX, bot.RoamTargetY)
				bot.PathIndex = 0
				bot.LastPathUpdate = now
				bot.LastRoamUpdate = now
			}
		}

		// Check if bot is in a cluster (too close to multiple other bots), disperse if so
		if bot.IsRoaming && bm.isInCluster(botID, players) {
			bm.pickSmartRoamTarget(bot, botID, players)
			bot.SeekingAloe = false
			bot.Path = bm.computePath(player.X, player.Y, bot.RoamTargetX, bot.RoamTargetY)
			bot.PathIndex = 0
			bot.LastPathUpdate = now
			bot.LastRoamUpdate = now
		}

		// Find target within detection range, considering already claimed targets
		targetID, targetX, targetY, targetDist := bm.findBestTarget(botID, players, claimedTargets)

		if targetID != "" {
			// Target found, chase mode
			bot.TargetID = targetID
			bot.IsRoaming = false
			bot.SeekingAloe = false
			claimedTargets[targetID] = botID // Claim this target

			// Recompute path periodically or if path is empty/exhausted
			needsNewPath := now.Sub(bot.LastPathUpdate) >= BotPathUpdateMs*time.Millisecond
			pathExhausted := len(bot.Path) == 0 || bot.PathIndex >= len(bot.Path)

			if needsNewPath || pathExhausted {
				bot.Path = bm.computePath(player.X, player.Y, targetX, targetY)
				bot.PathIndex = 0
				bot.LastPathUpdate = now
			}

			// Follow path, use direct movement as fallback
			if !bm.followPath(bot, player) {
				// Path failed, move directly toward target
				bm.moveDirectlyToward(player, targetX, targetY)
			}

			// Queue potion throw if in range (will be executed after mutex released)
			if targetDist <= BotPotionRange && now.Sub(bot.LastPotionThrow) >= BotPotionCooldownMs*time.Millisecond {
				actions = append(actions, BotAction{
					BotID:   botID,
					TargetX: targetX,
					TargetY: targetY,
				})
				bot.LastPotionThrow = now
			}
		} else {
			// No target in range, roam mode with aloe seeking and occasional skirmishes
			bot.TargetID = ""
			bot.IsRoaming = true

			// Occasionally decide to target another bot for a skirmish (makes map feel lively)
			skirmishRoll := rand.Float32()
			if skirmishRoll < BotSkirmishChance {
				// Try nearby skirmish first
				skirmishTarget, sx, sy, sDist := bm.findNearestBot(botID, players)
				if skirmishTarget != "" && sDist <= BotDetectionRange*1.5 {
					bot.TargetID = skirmishTarget
					bot.IsRoaming = false
					bot.SeekingAloe = false
					bot.Path = bm.computePath(player.X, player.Y, sx, sy)
					bot.PathIndex = 0
					bot.LastPathUpdate = now
					bm.followPath(bot, player)
					continue
				}
			} else if skirmishRoll < BotSkirmishChance+BotLongRangeSkirmish {
				// Long-range skirmish: find any bot on the map (even far away)
				skirmishTarget, sx, sy, _ := bm.findFarthestBot(botID, players)
				if skirmishTarget != "" {
					bot.TargetID = skirmishTarget
					bot.IsRoaming = false
					bot.SeekingAloe = false
					bot.Path = bm.computePath(player.X, player.Y, sx, sy)
					bot.PathIndex = 0
					bot.LastPathUpdate = now
					bm.followPath(bot, player)
					continue
				}
			}

			// Try to find nearby aloe to collect
			aloeX, aloeY, aloeID, foundAloe := bm.findNearestAloe(player.X, player.Y)
			if foundAloe && !bot.SeekingAloe {
				bot.SeekingAloe = true
				bot.AloeTargetID = aloeID
				bot.RoamTargetX = aloeX
				bot.RoamTargetY = aloeY
				bot.Path = bm.computePath(player.X, player.Y, aloeX, aloeY)
				bot.PathIndex = 0
				bot.LastPathUpdate = now
				bot.LastRoamUpdate = now
			}

			// Pick new roam target periodically (avoid other bots)
			if now.Sub(bot.LastRoamUpdate) >= BotRoamInterval*time.Millisecond || bot.RoamTargetX == 0 {
				bm.pickSmartRoamTarget(bot, botID, players)
				bot.SeekingAloe = false
				bot.AloeTargetID = ""
				bot.LastRoamUpdate = now
				bot.Path = bm.computePath(player.X, player.Y, bot.RoamTargetX, bot.RoamTargetY)
				bot.PathIndex = 0
				bot.LastPathUpdate = now
			}

			// Check if reached roam target
			roamDist := distance(player.X, player.Y, bot.RoamTargetX, bot.RoamTargetY)
			if roamDist < float32(bm.gameMap.TileSize) {
				// Pick new roam target
				bm.pickSmartRoamTarget(bot, botID, players)
				bot.SeekingAloe = false
				bot.AloeTargetID = ""
				bot.LastRoamUpdate = now
				bot.Path = bm.computePath(player.X, player.Y, bot.RoamTargetX, bot.RoamTargetY)
				bot.PathIndex = 0
				bot.LastPathUpdate = now
			}

			// Follow roam path, if not moving, force new target
			if !bm.followPath(bot, player) {
				// Bot is stuck or path exhausted, pick new target immediately
				bm.pickSmartRoamTarget(bot, botID, players)
				bot.SeekingAloe = false
				bot.AloeTargetID = ""
				bot.LastRoamUpdate = now
				bot.Path = bm.computePath(player.X, player.Y, bot.RoamTargetX, bot.RoamTargetY)
				bot.PathIndex = 0
				bot.LastPathUpdate = now

				bm.followPath(bot, player)
			}
		}
	}

	return actions
}

// pickRoamTarget selects a random passable location for the bot to roam to
func (bm *BotManager) pickRoamTarget(bot *BotState) {
	tileX, tileY, ok := bm.gameMap.RandomPassableTile()
	if ok {
		bot.RoamTargetX = float32(tileX*bm.gameMap.TileSize) + float32(bm.gameMap.TileSize)/2
		bot.RoamTargetY = float32(tileY*bm.gameMap.TileSize) + float32(bm.gameMap.TileSize)/2
	}
}

// pickSmartRoamTarget selects a roam location that avoids other bots
func (bm *BotManager) pickSmartRoamTarget(bot *BotState, botID string, players map[string]*PlayerState) {
	// Try multiple times to find a location away from other bots
	bestX, bestY := float32(0), float32(0)
	bestMinDist := float32(0)

	for range 10 {
		tileX, tileY, ok := bm.gameMap.RandomPassableTile()
		if !ok {
			continue
		}

		candidateX := float32(tileX*bm.gameMap.TileSize) + float32(bm.gameMap.TileSize)/2
		candidateY := float32(tileY*bm.gameMap.TileSize) + float32(bm.gameMap.TileSize)/2

		// Find minimum distance to any other bot
		minDistToBot := float32(math.MaxFloat32)
		for otherID := range bm.bots {
			if otherID == botID {
				continue
			}
			if otherPlayer, exists := players[otherID]; exists {
				dist := distance(candidateX, candidateY, otherPlayer.X, otherPlayer.Y)
				if dist < minDistToBot {
					minDistToBot = dist
				}
			}
		}

		// Keep the candidate that maximizes distance from other bots
		if minDistToBot > bestMinDist {
			bestMinDist = minDistToBot
			bestX = candidateX
			bestY = candidateY
		}

		// Good enough if we're at least BotMinSeparation away
		if minDistToBot >= BotMinSeparation {
			break
		}
	}

	if bestX != 0 || bestY != 0 {
		bot.RoamTargetX = bestX
		bot.RoamTargetY = bestY
	} else {
		// Fallback to simple random
		bm.pickRoamTarget(bot)
	}
}

// findNearestAloe finds the nearest aloe item within search range
func (bm *BotManager) findNearestAloe(botX, botY float32) (float32, float32, string, bool) {
	items := bm.gsm.itemManager.GetActiveItems()

	var nearestX, nearestY float32
	var nearestID string
	nearestDist := float32(math.MaxFloat32)

	for _, item := range items {
		if item.Position == nil {
			continue
		}
		dist := distance(botX, botY, item.Position.X, item.Position.Y)
		if dist <= BotAloeSearchRange && dist < nearestDist {
			nearestDist = dist
			nearestX = item.Position.X
			nearestY = item.Position.Y
			nearestID = item.ItemId
		}
	}

	if nearestID != "" {
		return nearestX, nearestY, nearestID, true
	}
	return 0, 0, "", false
}

// findNearestBot finds the nearest other bot for potential skirmishes
func (bm *BotManager) findNearestBot(botID string, players map[string]*PlayerState) (string, float32, float32, float32) {
	botPlayer, exists := players[botID]
	if !exists {
		return "", 0, 0, 0
	}

	var nearestID string
	var nearestDist float32 = math.MaxFloat32

	for otherID := range bm.bots {
		if otherID == botID {
			continue
		}
		if otherPlayer, exists := players[otherID]; exists {
			// Skip frozen bots
			if otherPlayer.IsFrozen {
				continue
			}
			dist := distance(botPlayer.X, botPlayer.Y, otherPlayer.X, otherPlayer.Y)
			if dist < nearestDist {
				nearestDist = dist
				nearestID = otherID
			}
		}
	}

	if nearestID != "" {
		p := players[nearestID]
		return nearestID, p.X, p.Y, nearestDist
	}
	return "", 0, 0, 0
}

// findFarthestBot finds the farthest bot (for long-range skirmishes to spread action across map)
func (bm *BotManager) findFarthestBot(botID string, players map[string]*PlayerState) (string, float32, float32, float32) {
	botPlayer, exists := players[botID]
	if !exists {
		return "", 0, 0, 0
	}

	var farthestID string
	var farthestDist float32 = 0

	for otherID := range bm.bots {
		if otherID == botID {
			continue
		}
		if otherPlayer, exists := players[otherID]; exists {
			// Skip frozen bots
			if otherPlayer.IsFrozen {
				continue
			}
			dist := distance(botPlayer.X, botPlayer.Y, otherPlayer.X, otherPlayer.Y)
			if dist > farthestDist {
				farthestDist = dist
				farthestID = otherID
			}
		}
	}

	if farthestID != "" {
		p := players[farthestID]
		return farthestID, p.X, p.Y, farthestDist
	}
	return "", 0, 0, 0
}

// isInCluster returns true if the bot is close to 2+ other bots (should disperse)
func (bm *BotManager) isInCluster(botID string, players map[string]*PlayerState) bool {
	botPlayer, exists := players[botID]
	if !exists {
		return false
	}

	nearbyCount := 0
	for otherID := range bm.bots {
		if otherID == botID {
			continue
		}
		if otherPlayer, exists := players[otherID]; exists {
			dist := distance(botPlayer.X, botPlayer.Y, otherPlayer.X, otherPlayer.Y)
			if dist < BotClusterThreshold {
				nearbyCount++
			}
		}
	}

	// In a cluster if 2+ bots are very close
	return nearbyCount >= 2
}

// findBestTarget finds the best target for a bot, avoiding targets already claimed by other bots
// Priority: unclaimed humans > unclaimed bots > claimed humans > claimed bots
// Returns targetID, targetX, targetY, distance (empty string if no target in range)
func (bm *BotManager) findBestTarget(botID string, players map[string]*PlayerState, claimedTargets map[string]string) (string, float32, float32, float32) {
	botPlayer, exists := players[botID]
	if !exists {
		return "", 0, 0, 0
	}

	type candidate struct {
		id      string
		dist    float32
		isBot   bool
		claimed bool
	}

	var candidates []candidate

	for id, p := range players {
		if id == botID {
			continue
		}

		// Skip frozen players - no point chasing them
		if p.IsFrozen {
			continue
		}

		dist := distance(botPlayer.X, botPlayer.Y, p.X, p.Y)
		if dist > BotDetectionRange {
			continue
		}

		_, isBot := bm.bots[id]
		claimedBy, isClaimed := claimedTargets[id]
		// Not claimed if we already have it claimed
		if claimedBy == botID {
			isClaimed = false
		}

		candidates = append(candidates, candidate{
			id:      id,
			dist:    dist,
			isBot:   isBot,
			claimed: isClaimed,
		})
	}

	// Find best target by priority:
	// 1. Unclaimed human (nearest)
	// 2. Unclaimed bot (nearest)
	// 3. Claimed human (nearest) - fallback if only one target
	// 4. Claimed bot (nearest) - fallback
	var bestUnclaimed *candidate
	var bestClaimed *candidate

	for i := range candidates {
		c := &candidates[i]
		if !c.claimed {
			if bestUnclaimed == nil {
				bestUnclaimed = c
			} else {
				// Prefer humans over bots, then by distance
				if !c.isBot && bestUnclaimed.isBot {
					bestUnclaimed = c
				} else if c.isBot == bestUnclaimed.isBot && c.dist < bestUnclaimed.dist {
					bestUnclaimed = c
				}
			}
		} else {
			if bestClaimed == nil {
				bestClaimed = c
			} else {
				if !c.isBot && bestClaimed.isBot {
					bestClaimed = c
				} else if c.isBot == bestClaimed.isBot && c.dist < bestClaimed.dist {
					bestClaimed = c
				}
			}
		}
	}

	// Return unclaimed target if available, otherwise fall back to claimed
	if bestUnclaimed != nil {
		p := players[bestUnclaimed.id]
		return bestUnclaimed.id, p.X, p.Y, bestUnclaimed.dist
	}
	if bestClaimed != nil {
		p := players[bestClaimed.id]
		return bestClaimed.id, p.X, p.Y, bestClaimed.dist
	}

	return "", 0, 0, 0
}

// followPath sets movement inputs based on current path
// Returns true if bot is actively moving, false if path is exhausted
func (bm *BotManager) followPath(bot *BotState, player *PlayerState) bool {
	player.MoveUp = false
	player.MoveDown = false
	player.MoveLeft = false
	player.MoveRight = false

	if len(bot.Path) == 0 || bot.PathIndex >= len(bot.Path) {
		// No path, try direct movement toward roam target as fallback
		if bot.RoamTargetX != 0 || bot.RoamTargetY != 0 {
			return bm.moveDirectlyToward(player, bot.RoamTargetX, bot.RoamTargetY)
		}
		return false
	}

	// Get next waypoint
	next := bot.Path[bot.PathIndex]
	targetX := float32(next.X*bm.gameMap.TileSize) + float32(bm.gameMap.TileSize)/2
	targetY := float32(next.Y*bm.gameMap.TileSize) + float32(bm.gameMap.TileSize)/2

	dx := targetX - player.X
	dy := targetY - player.Y
	dist := float32(math.Sqrt(float64(dx*dx + dy*dy)))

	// Move to next waypoint if close enough
	if dist < float32(bm.gameMap.TileSize)/2 {
		bot.PathIndex++
		if bot.PathIndex >= len(bot.Path) {
			return false
		}
		next = bot.Path[bot.PathIndex]
		targetX = float32(next.X*bm.gameMap.TileSize) + float32(bm.gameMap.TileSize)/2
		targetY = float32(next.Y*bm.gameMap.TileSize) + float32(bm.gameMap.TileSize)/2
		dx = targetX - player.X
		dy = targetY - player.Y
	}

	// Set movement direction
	if dx > 5 {
		player.MoveRight = true
	} else if dx < -5 {
		player.MoveLeft = true
	}
	if dy > 5 {
		player.MoveDown = true
	} else if dy < -5 {
		player.MoveUp = true
	}

	return player.MoveUp || player.MoveDown || player.MoveLeft || player.MoveRight
}

// moveDirectlyToward sets movement inputs to move directly toward a target (fallback when no path)
func (bm *BotManager) moveDirectlyToward(player *PlayerState, targetX, targetY float32) bool {
	dx := targetX - player.X
	dy := targetY - player.Y

	if dx > 5 {
		player.MoveRight = true
	} else if dx < -5 {
		player.MoveLeft = true
	}
	if dy > 5 {
		player.MoveDown = true
	} else if dy < -5 {
		player.MoveUp = true
	}

	return player.MoveUp || player.MoveDown || player.MoveLeft || player.MoveRight
}

func distance(x1, y1, x2, y2 float32) float32 {
	dx := x2 - x1
	dy := y2 - y1
	return float32(math.Sqrt(float64(dx*dx + dy*dy)))
}

// ============================================================================
// A* Pathfinding
// ============================================================================

// PathNode represents a tile coordinate in a path
type PathNode struct {
	X, Y int
}

// aStarNode is used internally for A* algorithm
type aStarNode struct {
	x, y   int
	g, h   float64 // g = cost from start, h = heuristic to goal
	parent *aStarNode
	index  int // for heap
}

func (n *aStarNode) f() float64 {
	return n.g + n.h
}

// priorityQueue implements heap.Interface for A*
type priorityQueue []*aStarNode

func (pq priorityQueue) Len() int           { return len(pq) }
func (pq priorityQueue) Less(i, j int) bool { return pq[i].f() < pq[j].f() }
func (pq priorityQueue) Swap(i, j int) {
	pq[i], pq[j] = pq[j], pq[i]
	pq[i].index = i
	pq[j].index = j
}

func (pq *priorityQueue) Push(x any) {
	n := x.(*aStarNode)
	n.index = len(*pq)
	*pq = append(*pq, n)
}

func (pq *priorityQueue) Pop() any {
	old := *pq
	n := len(old)
	node := old[n-1]
	old[n-1] = nil
	node.index = -1
	*pq = old[0 : n-1]
	return node
}

// computePath uses A* to find a path from start to goal (in pixels)
func (bm *BotManager) computePath(startX, startY, goalX, goalY float32) []PathNode {
	// Convert to tile coordinates
	startTileX := int(startX) / bm.gameMap.TileSize
	startTileY := int(startY) / bm.gameMap.TileSize
	goalTileX := int(goalX) / bm.gameMap.TileSize
	goalTileY := int(goalY) / bm.gameMap.TileSize

	// Clamp to map bounds
	startTileX = clampInt(startTileX, 0, bm.gameMap.Width-1)
	startTileY = clampInt(startTileY, 0, bm.gameMap.Height-1)
	goalTileX = clampInt(goalTileX, 0, bm.gameMap.Width-1)
	goalTileY = clampInt(goalTileY, 0, bm.gameMap.Height-1)

	// If goal is impassable, find nearest passable tile
	if bm.gameMap.Collision[goalTileY][goalTileX] == TileTypeImpassable {
		goalTileX, goalTileY = bm.findNearestPassable(goalTileX, goalTileY)
	}

	// A* algorithm
	openSet := &priorityQueue{}
	heap.Init(openSet)

	startNode := &aStarNode{
		x: startTileX,
		y: startTileY,
		g: 0,
		h: heuristic(startTileX, startTileY, goalTileX, goalTileY),
	}
	heap.Push(openSet, startNode)

	closedSet := make(map[int]bool)
	nodeMap := make(map[int]*aStarNode)
	nodeMap[startTileY*bm.gameMap.Width+startTileX] = startNode

	// Limit iterations for performance
	maxIterations := bm.gameMap.Width * bm.gameMap.Height
	iterations := 0

	for openSet.Len() > 0 && iterations < maxIterations {
		iterations++

		current := heap.Pop(openSet).(*aStarNode)
		key := current.y*bm.gameMap.Width + current.x

		if current.x == goalTileX && current.y == goalTileY {
			return reconstructPath(current)
		}

		closedSet[key] = true

		// Check neighbors (4-directional)
		neighbors := []struct{ dx, dy int }{
			{0, -1}, {0, 1}, {-1, 0}, {1, 0},
		}

		for _, n := range neighbors {
			nx, ny := current.x+n.dx, current.y+n.dy

			// Bounds check
			if nx < 0 || nx >= bm.gameMap.Width || ny < 0 || ny >= bm.gameMap.Height {
				continue
			}

			// Skip impassable
			if bm.gameMap.Collision[ny][nx] == TileTypeImpassable {
				continue
			}

			nKey := ny*bm.gameMap.Width + nx
			if closedSet[nKey] {
				continue
			}

			// Cost: 1 for passable, 2 for slowdown
			moveCost := 1.0
			if bm.gameMap.Collision[ny][nx] == TileTypeSlowdown {
				moveCost = 2.0
			}

			tentativeG := current.g + moveCost

			neighbor, exists := nodeMap[nKey]
			if !exists {
				neighbor = &aStarNode{
					x:      nx,
					y:      ny,
					g:      tentativeG,
					h:      heuristic(nx, ny, goalTileX, goalTileY),
					parent: current,
				}
				nodeMap[nKey] = neighbor
				heap.Push(openSet, neighbor)
			} else if tentativeG < neighbor.g {
				neighbor.g = tentativeG
				neighbor.parent = current
				heap.Fix(openSet, neighbor.index)
			}
		}
	}

	// No path found, return empty
	return nil
}

func heuristic(x1, y1, x2, y2 int) float64 {
	// Manhattan distance
	dx := x2 - x1
	dy := y2 - y1
	if dx < 0 {
		dx = -dx
	}
	if dy < 0 {
		dy = -dy
	}
	return float64(dx + dy)
}

func reconstructPath(node *aStarNode) []PathNode {
	var path []PathNode
	for node != nil {
		path = append([]PathNode{{X: node.x, Y: node.y}}, path...)
		node = node.parent
	}
	// Skip the first node (current position)
	if len(path) > 1 {
		return path[1:]
	}
	return nil
}

func (bm *BotManager) findNearestPassable(tileX, tileY int) (int, int) {
	// Spiral outward to find nearest passable tile
	for radius := 1; radius < 10; radius++ {
		for dy := -radius; dy <= radius; dy++ {
			for dx := -radius; dx <= radius; dx++ {
				nx, ny := tileX+dx, tileY+dy
				if nx >= 0 && nx < bm.gameMap.Width && ny >= 0 && ny < bm.gameMap.Height {
					if bm.gameMap.Collision[ny][nx] != TileTypeImpassable {
						return nx, ny
					}
				}
			}
		}
	}
	return tileX, tileY
}

func clampInt(value, min, max int) int {
	if value < min {
		return min
	}
	if value > max {
		return max
	}
	return value
}

// Cleanup removes bots from Redis (call on server shutdown)
func (bm *BotManager) Cleanup(ctx context.Context) {
	bm.mu.Lock()
	defer bm.mu.Unlock()

	for id := range bm.bots {
		bm.redis.SRem(ctx, RedisKeyBotGame, id)
		bm.redis.HDel(ctx, RedisKeyBotNames, id)
	}
	bm.bots = make(map[string]*BotState, BotCount)
}
