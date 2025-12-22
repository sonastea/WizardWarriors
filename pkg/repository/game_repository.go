package repository

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/sonastea/WizardWarriors/pkg/entity"
)

type GameSessionToken string

// GameSessionInfo contains user information associated with a game session
type GameSessionInfo struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
}

// GameRepository defines the interface for game storage operations
type GameRepository interface {
	JoinMultiplayer(ctx context.Context, userID uint64, username string) (GameSessionToken, error)
	JoinMultiplayerAsGuest(ctx context.Context, guestID string) (GameSessionToken, string, error)
	GetSessionInfo(ctx context.Context, token string) (*GameSessionInfo, error)
	RefreshSession(ctx context.Context, token string) error
	GetPlayerSave(ctx context.Context, gameID int) (*entity.PlayerSave, error)
	GetPlayerSavesByUserID(ctx context.Context, userID int) ([]entity.PlayerSave, error)
	GetLeaderboard(ctx context.Context) ([]entity.GameStats, error)
	SaveGame(ctx context.Context, gameStats *entity.GameStats) (*entity.GameStats, error)
}

// gameRepository implements GameRepository with postgresql pooling
type gameRepository struct {
	pool  *pgxpool.Pool
	redis *redis.Client
}

// NewGameRepository creates a new PostgreSQL game repository
func NewGameRepository(pool *pgxpool.Pool, redis *redis.Client) GameRepository {
	return &gameRepository{pool: pool, redis: redis}
}

// GetPlayerSave retrieves a player save by game ID
func (r *gameRepository) GetPlayerSave(ctx context.Context, gameID int) (*entity.PlayerSave, error) {
	query := `
		SELECT DISTINCT ON (ps.id)
			ps.id,
			ps.user_id,
			ps.max_level,
			ps.created_at,
			ps.updated_at,
			gs.id AS game_id,
			gs.team_deaths,
			gs.team_kills,
			gs.player_level,
			gs.player_kills,
			gs.player_kills_at_level,
			gs.total_allies,
			gs.total_enemies,
			gs.is_game_over,
			gs.created_at AS game_created_at,
			gs.updated_at AS game_updated_at,
			gs.is_active AS game_is_active
		FROM player_saves ps
		INNER JOIN game_stats gs ON gs.user_id = ps.user_id
		WHERE gs.id = $1
	`

	var save entity.PlayerSave
	err := r.pool.QueryRow(ctx, query, gameID).Scan(
		&save.ID,
		&save.UserID,
		&save.MaxLevel,
		&save.CreatedAt,
		&save.UpdatedAt,
		&save.GameStatID,
		&save.TeamDeaths,
		&save.TeamKills,
		&save.PlayerLevel,
		&save.PlayerKills,
		&save.PlayerKillsAtLevel,
		&save.TotalAllies,
		&save.TotalEnemies,
		&save.IsGameOver,
		&save.GameStatCreatedAt,
		&save.GameStatUpdatedAt,
		&save.GameStatIsActive,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get player save: %w", err)
	}

	return &save, nil
}

// GetPlayerSavesByUserID retrieves all player saves for a user
func (r *gameRepository) GetPlayerSavesByUserID(ctx context.Context, userID int) ([]entity.PlayerSave, error) {
	query := `
		SELECT DISTINCT ON (gs.id, gs.is_game_over)
			ps.id,
			ps.user_id,
			ps.max_level,
			ps.created_at,
			ps.updated_at,
			gs.id AS game_id,
			gs.team_deaths,
			gs.team_kills,
			gs.player_level,
			gs.player_kills,
			gs.player_kills_at_level,
			gs.total_allies,
			gs.total_enemies,
			gs.is_game_over,
			gs.created_at AS game_created_at,
			gs.updated_at AS game_updated_at,
			gs.is_active AS game_is_active
		FROM player_saves ps
		INNER JOIN game_stats gs ON gs.user_id = ps.user_id
		WHERE ps.user_id = $1
	`

	rows, err := r.pool.Query(ctx, query, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get player saves: %w", err)
	}
	defer rows.Close()

	var saves []entity.PlayerSave
	for rows.Next() {
		var save entity.PlayerSave
		err := rows.Scan(
			&save.ID,
			&save.UserID,
			&save.MaxLevel,
			&save.CreatedAt,
			&save.UpdatedAt,
			&save.GameStatID,
			&save.TeamDeaths,
			&save.TeamKills,
			&save.PlayerLevel,
			&save.PlayerKills,
			&save.PlayerKillsAtLevel,
			&save.TotalAllies,
			&save.TotalEnemies,
			&save.IsGameOver,
			&save.GameStatCreatedAt,
			&save.GameStatUpdatedAt,
			&save.GameStatIsActive,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		saves = append(saves, save)
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("failed to iterate rows: %w", rows.Err())
	}

	return saves, nil
}

// GetLeaderboard retrieves the top 20 game stats
func (r *gameRepository) GetLeaderboard(ctx context.Context) ([]entity.GameStats, error) {
	query := `
		SELECT
			eGS.id,
			eU.username AS login,
			eGS.user_id,
			eGS.team_deaths,
			eGS.team_kills,
			eGS.player_level,
			eGS.player_kills,
			eGS.player_kills_at_level,
			eGS.total_allies,
			eGS.total_enemies,
			eGS.is_game_over,
			eGS.updated_at
		FROM game_stats AS eGS
		INNER JOIN users AS eU ON eGS.user_id = eU.id
		WHERE eGS.is_active = TRUE
		ORDER BY eGS.player_level DESC, eGS.player_kills DESC
		LIMIT 20;
	`

	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("failed to execute query: %w", err)
	}
	defer rows.Close()

	var results []entity.GameStats
	for rows.Next() {
		var stats entity.GameStats
		err := rows.Scan(
			&stats.ID,
			&stats.Username,
			&stats.UserID,
			&stats.TeamDeaths,
			&stats.TeamKills,
			&stats.PlayerLevel,
			&stats.PlayerKills,
			&stats.PlayerKillsAtLevel,
			&stats.TotalAllies,
			&stats.TotalEnemies,
			&stats.IsGameOver,
			&stats.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan row: %w", err)
		}
		results = append(results, stats)
	}

	if rows.Err() != nil {
		return nil, fmt.Errorf("row iteration error: %w", rows.Err())
	}

	return results, nil
}

// SaveGame creates or updates a game stats entry and player save
func (r *gameRepository) SaveGame(ctx context.Context, gameStats *entity.GameStats) (*entity.GameStats, error) {
	gameStatsQuery := `
		INSERT INTO game_stats (
			user_id, team_deaths, team_kills, player_level,
			player_kills, player_kills_at_level, total_allies, total_enemies,
			is_game_over, created_at, updated_at, is_active
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		RETURNING id, user_id, team_deaths, team_kills, player_level,
			player_kills, player_kills_at_level, total_allies, total_enemies,
			is_game_over, created_at, updated_at;
	`

	playerSaveQuery := `
		INSERT INTO player_saves (
			user_id, max_level, created_at, created_by,
			updated_at, updated_by, is_active
		)
		VALUES ($1, $2, CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP, $3, TRUE)
		RETURNING user_id, max_level, created_at, updated_at;
	`

	updateGameStatsQuery := `
		UPDATE game_stats
		SET team_deaths = $1, team_kills = $2, player_level = $3,
			player_kills = $4, player_kills_at_level = $5, total_allies = $6,
			total_enemies = $7, is_game_over = $8, updated_at = CURRENT_TIMESTAMP
		WHERE id = $9 AND is_game_over = false
		RETURNING id, user_id, team_deaths, team_kills, player_level,
			player_kills, player_kills_at_level, total_allies, total_enemies,
			is_game_over, created_at, updated_at;
	`

	updatePlayerSaveQuery := `
		UPDATE player_saves
		SET max_level = $2, updated_at = CURRENT_TIMESTAMP, updated_by = $3
		WHERE id = $1 AND is_active = TRUE
		RETURNING user_id, max_level, created_at, updated_at;
	`

	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	var gs entity.GameStats
	if gameStats.ID == 0 {
		// Create new game stats
		err = tx.QueryRow(ctx, gameStatsQuery,
			gameStats.UserID, gameStats.TeamDeaths, gameStats.TeamKills,
			gameStats.PlayerLevel, gameStats.PlayerKills, gameStats.PlayerKillsAtLevel,
			gameStats.TotalAllies, gameStats.TotalEnemies, gameStats.IsGameOver,
			gameStats.CreatedAt, gameStats.UpdatedAt, true,
		).Scan(
			&gs.ID, &gs.UserID, &gs.TeamDeaths, &gs.TeamKills, &gs.PlayerLevel,
			&gs.PlayerKills, &gs.PlayerKillsAtLevel, &gs.TotalAllies, &gs.TotalEnemies,
			&gs.IsGameOver, &gs.CreatedAt, &gs.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to create game stats: %w", err)
		}

		// Create player save
		var ps entity.PlayerSave
		err = tx.QueryRow(ctx, playerSaveQuery,
			gameStats.UserID, gameStats.PlayerLevel, gameStats.Username,
		).Scan(&ps.UserID, &ps.MaxLevel, &ps.CreatedAt, &ps.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to create player save: %w", err)
		}
	} else {
		// Update existing game stats
		err = tx.QueryRow(ctx, updateGameStatsQuery,
			gameStats.TeamDeaths, gameStats.TeamKills, gameStats.PlayerLevel,
			gameStats.PlayerKills, gameStats.PlayerKillsAtLevel, gameStats.TotalAllies,
			gameStats.TotalEnemies, gameStats.IsGameOver, gameStats.ID,
		).Scan(
			&gs.ID, &gs.UserID, &gs.TeamDeaths, &gs.TeamKills, &gs.PlayerLevel,
			&gs.PlayerKills, &gs.PlayerKillsAtLevel, &gs.TotalAllies, &gs.TotalEnemies,
			&gs.IsGameOver, &gs.CreatedAt, &gs.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to update game stats: %w", err)
		}

		// Update player save
		var ps entity.PlayerSave
		err = tx.QueryRow(ctx, updatePlayerSaveQuery,
			gameStats.ID, gameStats.PlayerLevel, gameStats.Username,
		).Scan(&ps.UserID, &ps.MaxLevel, &ps.CreatedAt, &ps.UpdatedAt)
		if err != nil {
			return nil, fmt.Errorf("failed to update player save: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	gs.Username = gameStats.Username
	return &gs, nil
}

// JoinMultiplayer handles authenticating the user and returns a GameSessionToken
func (r *gameRepository) JoinMultiplayer(ctx context.Context, userID uint64, username string) (GameSessionToken, error) {
	// some function that will be called to do the following
	// 1. generate and retrieve the token for the user
	// 2. save to redis cache: token -> {userID, username}
	// gen token (len = 32)
	len := 32
	b := make([]byte, len)
	_, err := rand.Read(b)
	if err != nil {
		panic(err)
	}
	token := hex.EncodeToString(b)

	// save to redis with token as key (so we can look up user info from token)
	// Store userID and username as a hash
	pipe := r.redis.Pipeline()
	pipe.HSet(ctx, "gamesession:token:"+token, "user_id", userID, "username", username)
	pipe.Expire(ctx, "gamesession:token:"+token, 30*time.Minute)
	_, err = pipe.Exec(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to store session: %w", err)
	}

	return GameSessionToken(token), nil
}

// JoinMultiplayerAsGuest creates a guest session and returns a GameSessionToken
// If guestID is empty, generates a new one. Returns the token and the guestID used.
func (r *gameRepository) JoinMultiplayerAsGuest(ctx context.Context, guestID string) (GameSessionToken, string, error) {
	// Generate guest ID if not provided
	if guestID == "" {
		randBytes := make([]byte, 4)
		_, err := rand.Read(randBytes)
		if err != nil {
			return "", "", fmt.Errorf("failed to generate guest ID: %w", err)
		}
		guestID = "Guest-" + hex.EncodeToString(randBytes)
	}

	// Generate session token
	tokenLen := 32
	b := make([]byte, tokenLen)
	_, err := rand.Read(b)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate token: %w", err)
	}
	token := hex.EncodeToString(b)

	// Store guest session in Redis
	pipe := r.redis.Pipeline()
	pipe.HSet(ctx, "gamesession:token:"+token, "user_id", guestID, "username", guestID, "is_guest", "true")
	pipe.Expire(ctx, "gamesession:token:"+token, 30*time.Minute)
	_, err = pipe.Exec(ctx)
	if err != nil {
		return "", "", fmt.Errorf("failed to store guest session: %w", err)
	}

	return GameSessionToken(token), guestID, nil
}

// GetSessionInfo retrieves user information from a game session token
func (r *gameRepository) GetSessionInfo(ctx context.Context, token string) (*GameSessionInfo, error) {
	result, err := r.redis.HGetAll(ctx, "gamesession:token:"+token).Result()
	if err != nil {
		return nil, fmt.Errorf("failed to get session info: %w", err)
	}

	if len(result) == 0 {
		return nil, fmt.Errorf("session not found or expired")
	}

	return &GameSessionInfo{
		UserID:   result["user_id"],
		Username: result["username"],
	}, nil
}

// RefreshSession extends the TTL of a game session token
func (r *gameRepository) RefreshSession(ctx context.Context, token string) error {
	key := "gamesession:token:" + token
	exists, err := r.redis.Exists(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("failed to check session existence: %w", err)
	}
	if exists == 0 {
		return fmt.Errorf("session not found or expired")
	}

	// Extend the TTL
	if err := r.redis.Expire(ctx, key, 30*time.Minute).Err(); err != nil {
		return fmt.Errorf("failed to refresh session: %w", err)
	}

	return nil
}
