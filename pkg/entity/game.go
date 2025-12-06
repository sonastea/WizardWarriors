package entity

import "time"

type GameStats struct {
	ID                 int       `json:"id"`
	Username           string    `json:"username"`
	UserID             int       `json:"user_id"`
	TeamDeaths         int       `json:"team_deaths"`
	TeamKills          int       `json:"team_kills"`
	PlayerLevel        int       `json:"player_level"`
	PlayerKills        int       `json:"player_kills"`
	PlayerKillsAtLevel int       `json:"player_kills_at_level"`
	TotalAllies        int       `json:"total_allies"`
	TotalEnemies       int       `json:"total_enemies"`
	IsGameOver         bool      `json:"is_game_over"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}

type PlayerSave struct {
	ID                 int       `json:"id"`
	UserID             int       `json:"user_id"`
	MaxLevel           int       `json:"max_level"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
	GameStatID         int       `json:"game_id"`
	TeamDeaths         int       `json:"team_deaths"`
	TeamKills          int       `json:"team_kills"`
	PlayerLevel        int       `json:"player_level"`
	PlayerKills        int       `json:"player_kills"`
	PlayerKillsAtLevel int       `json:"player_kills_at_level"`
	TotalAllies        int       `json:"total_allies"`
	TotalEnemies       int       `json:"total_enemies"`
	IsGameOver         bool      `json:"is_game_over"`
	GameStatCreatedAt  time.Time `json:"game_created_at"`
	GameStatUpdatedAt  time.Time `json:"game_updated_at"`
	GameStatIsActive   bool      `json:"game_is_active"`
}
