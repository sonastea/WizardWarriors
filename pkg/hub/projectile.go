package hub

import (
	"fmt"
	"math"
	"sync"
	"time"

	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
	"github.com/sonastea/WizardWarriors/pkg/logger"
)

const (
	FreezePotionSpeed   float32 = 200 // pixels per second
	FreezePotionRadius  float32 = 64  // splash radius
	FreezeDuration      float64 = 3.5 // seconds
	MaxProjectiles      int     = 100
	ProjectileHitRadius float32 = 20 // collision radius for hitting players
)

type ProjectileType int

const (
	ProjectileTypeFireball ProjectileType = iota
	ProjectileTypeFreezePotion
)

type Projectile struct {
	ID        string
	Type      ProjectileType
	OwnerID   string
	X         float32
	Y         float32
	TargetX   float32
	TargetY   float32
	Speed     float32
	Active    bool
	CreatedAt time.Time
}

type ProjectileManager struct {
	mu          sync.RWMutex
	projectiles map[string]*Projectile
	gsm         *GameStateManager
	idCounter   int
}

func NewProjectileManager(gsm *GameStateManager) *ProjectileManager {
	return &ProjectileManager{
		projectiles: make(map[string]*Projectile),
		gsm:         gsm,
		idCounter:   0,
	}
}

// SpawnFreezePotion creates a new freeze potion projectile
func (pm *ProjectileManager) SpawnFreezePotion(ownerID string, startX, startY, targetX, targetY float32) string {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	// Limit total projectiles
	if len(pm.projectiles) >= MaxProjectiles {
		var oldestID string
		var oldestTime time.Time
		for id, p := range pm.projectiles {
			if !p.Active {
				if oldestID == "" || p.CreatedAt.Before(oldestTime) {
					oldestID = id
					oldestTime = p.CreatedAt
				}
			}
		}
		if oldestID != "" {
			delete(pm.projectiles, oldestID)
		}
	}

	pm.idCounter++
	id := fmt.Sprintf("%s-fp-%d", ownerID, pm.idCounter)

	projectile := &Projectile{
		ID:        id,
		Type:      ProjectileTypeFreezePotion,
		OwnerID:   ownerID,
		X:         startX,
		Y:         startY,
		TargetX:   targetX,
		TargetY:   targetY,
		Speed:     FreezePotionSpeed,
		Active:    true,
		CreatedAt: time.Now(),
	}

	pm.projectiles[id] = projectile
	logger.Debug("Spawned freeze potion %s from player %s at (%.1f, %.1f) targeting (%.1f, %.1f)",
		id, ownerID, startX, startY, targetX, targetY)

	return id
}

// Update moves all projectiles and checks for collisions/reaching target
func (pm *ProjectileManager) Update(deltaSeconds float32, players map[string]*PlayerState) {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	for _, p := range pm.projectiles {
		if !p.Active {
			continue
		}

		dx := p.TargetX - p.X
		dy := p.TargetY - p.Y
		distance := float32(math.Sqrt(float64(dx*dx + dy*dy)))

		if distance < 10 {
			p.X = p.TargetX
			p.Y = p.TargetY
			pm.detonateProjectile(p, players)
			continue
		}

		moveDistance := p.Speed * deltaSeconds
		if moveDistance > distance {
			moveDistance = distance
		}

		p.X += (dx / distance) * moveDistance
		p.Y += (dy / distance) * moveDistance

		if pm.checkPlayerCollision(p, players) {
			pm.detonateProjectile(p, players)
		}
	}
}

// checkPlayerCollision checks if projectile hit any player (except owner)
func (pm *ProjectileManager) checkPlayerCollision(p *Projectile, players map[string]*PlayerState) bool {
	for _, player := range players {
		if player.UserID == p.OwnerID {
			continue // Don't hit self
		}

		dx := p.X - player.X
		dy := p.Y - player.Y
		distSq := dx*dx + dy*dy

		if distSq < ProjectileHitRadius*ProjectileHitRadius {
			return true
		}
	}

	return false
}

// detonateProjectile handles projectile impact (freeze players in radius)
func (pm *ProjectileManager) detonateProjectile(p *Projectile, players map[string]*PlayerState) {
	p.Active = false
	p.Active = false

	if p.Type == ProjectileTypeFreezePotion {
		pm.freezePlayersInRadius(p.X, p.Y, FreezePotionRadius, p.OwnerID, players)
	}

	logger.Debug("Projectile %s detonated at (%.1f, %.1f)", p.ID, p.X, p.Y)
}

// freezePlayersInRadius freezes all players within radius
func (pm *ProjectileManager) freezePlayersInRadius(x, y, radius float32, excludeOwner string, players map[string]*PlayerState) {
	radiusSq := radius * radius
	now := time.Now()

	for _, player := range players {
		if player.UserID == excludeOwner {
			continue // Don't freeze self
		}

		if player.IsFrozen {
			continue
		}

		if now.Before(player.FreezeImmunity) {
			logger.Debug("Player %s has freeze immunity, skipping", player.UserID)
			continue
		}

		dx := x - player.X
		dy := y - player.Y
		distSq := dx*dx + dy*dy

		if distSq <= radiusSq {
			player.IsFrozen = true
			player.FrozenUntil = now.Add(time.Duration(FreezeDuration * float64(time.Second)))
			player.AloeCount = 0
			player.SpeedBoostUntil = time.Time{}

			logger.Info("Player %s frozen by freeze potion", player.UserID)
		}
	}
}

// GetActiveProjectiles returns all projectiles for broadcasting
func (pm *ProjectileManager) GetActiveProjectiles() []*multiplayerv1.ProjectileState {
	pm.mu.RLock()
	defer pm.mu.RUnlock()

	states := make([]*multiplayerv1.ProjectileState, 0, len(pm.projectiles))

	for _, p := range pm.projectiles {
		var pType multiplayerv1.ProjectileType
		switch p.Type {
		case ProjectileTypeFireball:
			pType = multiplayerv1.ProjectileType_PROJECTILE_TYPE_FIREBALL
		case ProjectileTypeFreezePotion:
			pType = multiplayerv1.ProjectileType_PROJECTILE_TYPE_FREEZE_POTION
		}

		states = append(states, &multiplayerv1.ProjectileState{
			ProjectileId: p.ID,
			Type:         pType,
			Position:     &multiplayerv1.Vector2{X: p.X, Y: p.Y},
			Target:       &multiplayerv1.Vector2{X: p.TargetX, Y: p.TargetY},
			OwnerId:      &multiplayerv1.ID{Value: p.OwnerID},
			Active:       p.Active,
		})
	}

	return states
}

// CleanupInactiveProjectiles removes old inactive projectiles
func (pm *ProjectileManager) CleanupInactiveProjectiles() {
	pm.mu.Lock()
	defer pm.mu.Unlock()

	cutoff := time.Now().Add(-5 * time.Second) // Remove after 5 seconds

	for id, p := range pm.projectiles {
		if !p.Active && p.CreatedAt.Before(cutoff) {
			delete(pm.projectiles, id)
		}
	}
}
