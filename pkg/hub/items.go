package hub

import (
	"fmt"
	"sync"
	"time"

	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
	"github.com/sonastea/WizardWarriors/pkg/logger"
)

const (
	MaxActiveAloe     = 20
	AloeSpawnInterval = 2 * time.Second
	AloePickupRadius  = PlayerRadius
)

type ItemType int

const (
	ItemTypeAloe ItemType = iota
)

type Item struct {
	ID        string
	Type      ItemType
	X         float32
	Y         float32
	Active    bool
	CreatedAt time.Time
}

type ItemManager struct {
	mu        sync.RWMutex
	items     map[string]*Item
	gsm       *GameStateManager
	idCounter int
	lastSpawn time.Time
}

func NewItemManager(gsm *GameStateManager) *ItemManager {
	return &ItemManager{
		items:     make(map[string]*Item),
		gsm:       gsm,
		lastSpawn: time.Now().Add(-AloeSpawnInterval),
	}
}

func (im *ItemManager) Update(now time.Time, players map[string]*PlayerState) {
	im.mu.Lock()
	defer im.mu.Unlock()

	im.spawnAloe(now)
	im.handlePickups(players)
}

func (im *ItemManager) GetActiveItems() []*multiplayerv1.ItemState {
	im.mu.RLock()
	defer im.mu.RUnlock()

	items := make([]*multiplayerv1.ItemState, 0, len(im.items))
	for _, item := range im.items {
		if !item.Active {
			continue
		}

		items = append(items, &multiplayerv1.ItemState{
			ItemId: item.ID,
			Type:   multiplayerv1.ItemType_ITEM_TYPE_ALOE,
			Position: &multiplayerv1.Vector2{
				X: item.X,
				Y: item.Y,
			},
			Active: true,
		})
	}

	return items
}

func (im *ItemManager) spawnAloe(now time.Time) {
	if now.Sub(im.lastSpawn) < AloeSpawnInterval {
		return
	}

	activeCount := 0
	for _, item := range im.items {
		if item.Active {
			activeCount++
		}
	}

	spawnedCount := 0
	for activeCount < MaxActiveAloe {
		x, y, ok := im.randomAloePosition()
		if !ok {
			break
		}

		im.idCounter++
		itemID := fmt.Sprintf("aloe-%d", im.idCounter)
		im.items[itemID] = &Item{
			ID:        itemID,
			Type:      ItemTypeAloe,
			X:         x,
			Y:         y,
			Active:    true,
			CreatedAt: now,
		}
		activeCount++
		spawnedCount++
	}

	if spawnedCount > 0 {
		logger.Debug("[ItemManager] Spawned %d aloe, total active: %d", spawnedCount, activeCount)
	}

	im.lastSpawn = now
}

func (im *ItemManager) randomAloePosition() (float32, float32, bool) {
	tileX, tileY, ok := im.gsm.gameMap.RandomPassableTile()
	if !ok {
		return 0, 0, false
	}

	halfTile := float32(im.gsm.gameMap.TileSize) / 2
	return float32(tileX*im.gsm.gameMap.TileSize) + halfTile,
		float32(tileY*im.gsm.gameMap.TileSize) + halfTile,
		true
}

func (im *ItemManager) handlePickups(players map[string]*PlayerState) {
	pickupRadiusSq := AloePickupRadius * AloePickupRadius

	for itemID, item := range im.items {
		if !item.Active {
			continue
		}

		for _, player := range players {
			if player.IsFrozen {
				continue
			}

			dx := item.X - player.X
			dy := item.Y - player.Y
			distanceSq := dx*dx + dy*dy
			if distanceSq <= pickupRadiusSq {
				item.Active = false
				player.AloeCount++
				delete(im.items, itemID)
				break
			}
		}
	}
}
