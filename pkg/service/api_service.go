package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/sonastea/WizardWarriors/pkg/entity"
	"github.com/sonastea/WizardWarriors/pkg/repository"
)

// UserInfo represents basic user information for session validation
type UserInfo struct {
	ID       uint64 `json:"id"`
	Username string `json:"username"`
}

// JoinMultiplayerResponse contains token and guest status
type JoinMultiplayerResponse struct {
	Token   repository.GameSessionToken `json:"token"`
	IsGuest bool                        `json:"isGuest"`
	GuestID string                      `json:"guestId,omitempty"`
}

// ApiService defines the interface for API business logic (users and games)
type ApiService interface {
	Register(ctx context.Context, username, password string) (uint64, error)
	Login(ctx context.Context, username, password string) (uint64, error)
	ValidateSession(ctx context.Context, userID uint64) (*UserInfo, error)
	JoinMultiplayer(ctx context.Context, userID uint64) (*JoinMultiplayerResponse, error)
	JoinMultiplayerAsGuest(ctx context.Context, guestID string) (*JoinMultiplayerResponse, error)
	GetPlayerSave(ctx context.Context, gameID uint64) (*entity.PlayerSave, error)
	GetPlayerSaves(ctx context.Context, userID uint64) ([]entity.PlayerSave, error)
	GetLeaderboard(ctx context.Context) ([]entity.GameStats, error)
	SaveGame(ctx context.Context, userID uint64, gameStats *entity.GameStats) (*entity.GameStats, error)
}

// apiService implements ApiService
type apiService struct {
	userRepo repository.UserRepository
	gameRepo repository.GameRepository
}

// NewApiService creates a new API service
func NewApiService(userRepo repository.UserRepository, gameRepo repository.GameRepository) ApiService {
	return &apiService{
		userRepo: userRepo,
		gameRepo: gameRepo,
	}
}

// Register creates a new user account
func (s *apiService) Register(ctx context.Context, username, password string) (uint64, error) {
	// Validate input
	if strings.TrimSpace(username) == "" {
		return 0, fmt.Errorf("username cannot be empty")
	}
	if strings.TrimSpace(password) == "" {
		return 0, fmt.Errorf("password cannot be empty")
	}
	if len(username) < 3 {
		return 0, fmt.Errorf("username must be at least 3 characters long")
	}
	if len(password) < 6 {
		return 0, fmt.Errorf("password must be at least 6 characters long")
	}

	// Create user
	userID, err := s.userRepo.Create(ctx, username, password)
	if err != nil {
		if strings.Contains(err.Error(), "23505") {
			return 0, fmt.Errorf("username already exists")
		}
		return 0, fmt.Errorf("failed to create user: %w", err)
	}

	return userID, nil
}

// Login authenticates a user and returns their user ID
func (s *apiService) Login(ctx context.Context, username, password string) (uint64, error) {
	// Validate input
	if strings.TrimSpace(username) == "" {
		return 0, fmt.Errorf("username cannot be empty")
	}
	if strings.TrimSpace(password) == "" {
		return 0, fmt.Errorf("password cannot be empty")
	}

	// Get user by credentials
	user, err := s.userRepo.GetByCredentials(ctx, username, password)
	if err != nil {
		return 0, fmt.Errorf("invalid username or password")
	}

	if !user.IsActive {
		return 0, fmt.Errorf("user account is inactive")
	}

	return user.ID, nil
}

// GetPlayerSave retrieves a player save by game ID
func (s *apiService) GetPlayerSave(ctx context.Context, gameID uint64) (*entity.PlayerSave, error) {
	if gameID <= 0 {
		return nil, fmt.Errorf("invalid game ID")
	}

	save, err := s.gameRepo.GetPlayerSave(ctx, int(gameID))
	if err != nil {
		return nil, fmt.Errorf("failed to get player save: %w", err)
	}

	return save, nil
}

// GetPlayerSaves retrieves all player saves for a user
func (s *apiService) GetPlayerSaves(ctx context.Context, userID uint64) ([]entity.PlayerSave, error) {
	if userID <= 0 {
		return nil, fmt.Errorf("invalid user ID")
	}

	saves, err := s.gameRepo.GetPlayerSavesByUserID(ctx, int(userID))
	if err != nil {
		return nil, fmt.Errorf("failed to get player saves: %w", err)
	}

	return saves, nil
}

// GetLeaderboard retrieves the top 20 game stats
func (s *apiService) GetLeaderboard(ctx context.Context) ([]entity.GameStats, error) {
	stats, err := s.gameRepo.GetLeaderboard(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get leaderboard: %w", err)
	}

	return stats, nil
}

// SaveGame saves or updates a game stats entry
func (s *apiService) SaveGame(ctx context.Context, userID uint64, gameStats *entity.GameStats) (*entity.GameStats, error) {
	// Validate user owns this game
	if gameStats.UserID != userID {
		return nil, fmt.Errorf("unauthorized: user does not own this game")
	}

	// Validate game stats
	if gameStats.PlayerLevel < 0 {
		return nil, fmt.Errorf("invalid player level")
	}

	// Save game
	saved, err := s.gameRepo.SaveGame(ctx, gameStats)
	if err != nil {
		return nil, fmt.Errorf("failed to save game: %w", err)
	}

	return saved, nil
}

// ValidateSession validates a user session and returns user info
func (s *apiService) ValidateSession(ctx context.Context, userID uint64) (*UserInfo, error) {
	if userID <= 0 {
		return nil, fmt.Errorf("invalid user ID")
	}

	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("invalid session: user not found")
	}

	if !user.IsActive {
		return nil, fmt.Errorf("user account is inactive")
	}

	return &UserInfo{
		ID:       user.ID,
		Username: user.Username,
	}, nil
}

func (s *apiService) JoinMultiplayer(ctx context.Context, userID uint64) (*JoinMultiplayerResponse, error) {
	user, err := s.userRepo.GetByID(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get user")
	}

	token, err := s.gameRepo.JoinMultiplayer(ctx, user.ID, user.Username)
	if err != nil {
		return nil, fmt.Errorf("failed to connect user to multiplayer")
	}

	return &JoinMultiplayerResponse{
		Token:   token,
		IsGuest: false,
	}, nil
}

func (s *apiService) JoinMultiplayerAsGuest(ctx context.Context, guestID string) (*JoinMultiplayerResponse, error) {
	token, finalGuestID, err := s.gameRepo.JoinMultiplayerAsGuest(ctx, guestID)
	if err != nil {
		return nil, fmt.Errorf("failed to create guest session")
	}

	return &JoinMultiplayerResponse{
		Token:   token,
		IsGuest: true,
		GuestID: finalGuestID,
	}, nil
}
