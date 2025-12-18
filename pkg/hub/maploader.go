package hub

import (
	"encoding/json"
	"fmt"
	"os"
)

// TiledMap represents the root structure of a Tiled JSON map
type TiledMap struct {
	Width      int          `json:"width"`      // Map width in tiles
	Height     int          `json:"height"`     // Map height in tiles
	TileWidth  int          `json:"tilewidth"`  // Tile width in pixels
	TileHeight int          `json:"tileheight"` // Tile height in pixels
	Layers     []TiledLayer `json:"layers"`
}

// TiledLayer represents a layer in the Tiled map
type TiledLayer struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Data    []int  `json:"data"` // 1D array of tile IDs (row-major order)
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Visible bool   `json:"visible"`
}

// TileType represents different terrain types for gameplay
type TileType int

const (
	TileTypePassable   TileType = iota // Normal walkable terrain
	TileTypeImpassable                 // Blocked (water, walls, etc.)
	TileTypeSlowdown                   // Slows player movement (quicksand, mud)
)

// GameMap holds the processed map data for server-side collision detection
type GameMap struct {
	Width       int          // Map width in tiles
	Height      int          // Map height in tiles
	TileSize    int          // Size of each tile in pixels (assumes square tiles)
	PixelWidth  float32      // Total map width in pixels
	PixelHeight float32      // Total map height in pixels
	Collision   [][]TileType // 2D grid of tile types [y][x]
}

// Collision tile IDs from the Tiled map
// These match what's defined in Game.tsx for client-side collision
var (
	// Impassable tiles (rocks, obstacles, buildings, water)
	impassableTileIDs = map[int]bool{
		// Rocks and obstacles from collisions layer
		55: true, 56: true, 57: true, 58: true, 59: true,
		60: true, 61: true, 62: true, 63: true,
		// Water
		148: true, 149: true, 150: true,
		165: true, 166: true, 167: true,
		182: true, 183: true, 184: true,
	}

	// Elevation tiles that also block movement (boulders that could be a 2nd level)
	elevationTileIDs = map[int]bool{
		94: true, 95: true, 96: true,
		111: true, 112: true, 113: true,
		128: true, 129: true, 130: true,
	}

	// Slowdown tiles (quicksand,mud)
	slowdownTileIDs = map[int]bool{
		168: true, 169: true, 170: true,
		185: true, 186: true, 187: true,
		202: true, 203: true, 204: true,
	}
)

// LoadMapFromFile loads a Tiled JSON map from the given file path
func LoadMapFromFile(path string) (*GameMap, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read map file: %w", err)
	}

	return ParseTiledMap(data)
}

// ParseTiledMap parses Tiled JSON data into a GameMap
func ParseTiledMap(data []byte) (*GameMap, error) {
	var tiledMap TiledMap
	if err := json.Unmarshal(data, &tiledMap); err != nil {
		return nil, fmt.Errorf("failed to parse map JSON: %w", err)
	}

	if tiledMap.Width == 0 || tiledMap.Height == 0 {
		return nil, fmt.Errorf("invalid map dimensions: %dx%d", tiledMap.Width, tiledMap.Height)
	}

	// Initialize the game map
	gameMap := &GameMap{
		Width:       tiledMap.Width,
		Height:      tiledMap.Height,
		TileSize:    tiledMap.TileWidth, // Assuming square tiles
		PixelWidth:  float32(tiledMap.Width * tiledMap.TileWidth),
		PixelHeight: float32(tiledMap.Height * tiledMap.TileHeight),
		Collision:   make([][]TileType, tiledMap.Height),
	}

	// Initialize collision grid with passable tiles
	for y := range tiledMap.Height {
		gameMap.Collision[y] = make([]TileType, tiledMap.Width)
		// Default is TileTypePassable (0)
	}

	// Process each layer to build collision data
	for _, layer := range tiledMap.Layers {
		if layer.Type != "tilelayer" {
			continue
		}

		// Process layers that affect collision
		switch layer.Name {
		case "collisions":
			processCollisionLayer(gameMap, &layer, impassableTileIDs, TileTypeImpassable)
			// Also check for slowdown tiles in collision layer
			processCollisionLayer(gameMap, &layer, slowdownTileIDs, TileTypeSlowdown)
		case "elevation":
			// Elevation tiles are also impassable
			processCollisionLayer(gameMap, &layer, elevationTileIDs, TileTypeImpassable)
		}
		// "ground" and "terrain" layers are purely visual, ignored for collision
	}

	return gameMap, nil
}

// processCollisionLayer marks tiles from a layer with the given tile type
func processCollisionLayer(gameMap *GameMap, layer *TiledLayer, tileIDs map[int]bool, tileType TileType) {
	if len(layer.Data) != gameMap.Width*gameMap.Height {
		return // Invalid layer data
	}

	for i, tileID := range layer.Data {
		if tileID == 0 {
			continue // Empty tile
		}

		if tileIDs[tileID] {
			x := i % gameMap.Width
			y := i / gameMap.Width
			// Only upgrade tile type (don't downgrade impassable to slowdown)
			if tileType == TileTypeImpassable || gameMap.Collision[y][x] == TileTypePassable {
				gameMap.Collision[y][x] = tileType
			}
		}
	}
}

// GetTileType returns the tile type at the given pixel coordinates
func (gm *GameMap) GetTileType(x, y float32) TileType {
	// Convert pixel coordinates to tile coordinates
	tileX := int(x) / gm.TileSize
	tileY := int(y) / gm.TileSize

	// Bounds check
	if tileX < 0 || tileX >= gm.Width || tileY < 0 || tileY >= gm.Height {
		return TileTypeImpassable // Out of bounds is impassable
	}

	return gm.Collision[tileY][tileX]
}

// IsCollision checks if a point at (x, y) with given radius collides with impassable terrain
func (gm *GameMap) IsCollision(x, y, radius float32) bool {
	// Check all tiles that the player's bounding box overlaps
	minTileX := int(x-radius) / gm.TileSize
	maxTileX := int(x+radius) / gm.TileSize
	minTileY := int(y-radius) / gm.TileSize
	maxTileY := int(y+radius) / gm.TileSize

	// Clamp to valid range
	if minTileX < 0 {
		minTileX = 0
	}
	if minTileY < 0 {
		minTileY = 0
	}
	if maxTileX >= gm.Width {
		maxTileX = gm.Width - 1
	}
	if maxTileY >= gm.Height {
		maxTileY = gm.Height - 1
	}

	// Check all overlapping tiles
	for ty := minTileY; ty <= maxTileY; ty++ {
		for tx := minTileX; tx <= maxTileX; tx++ {
			if gm.Collision[ty][tx] == TileTypeImpassable {
				return true
			}
		}
	}

	return false
}

// IsInSlowdown checks if a point at (x, y) is in a slowdown zone
func (gm *GameMap) IsInSlowdown(x, y float32) bool {
	tileType := gm.GetTileType(x, y)
	return tileType == TileTypeSlowdown
}

// IsValidSpawnPoint checks if a position is valid for spawning (not in collision)
func (gm *GameMap) IsValidSpawnPoint(x, y, radius float32) bool {
	// Must be within map bounds
	if x-radius < 0 || x+radius > gm.PixelWidth || y-radius < 0 || y+radius > gm.PixelHeight {
		return false
	}

	// Must not collide with impassable terrain
	return !gm.IsCollision(x, y, radius)
}
