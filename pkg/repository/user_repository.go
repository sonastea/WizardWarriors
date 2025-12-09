package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/sonastea/WizardWarriors/pkg/entity"
)

// UserRepository defines the interface for user storage operations
type UserRepository interface {
	Create(ctx context.Context, username, password string) (uint64, error)
	GetByCredentials(ctx context.Context, username, password string) (*entity.User, error)
	GetByID(ctx context.Context, userID uint64) (*entity.User, error)
}

// userRepository implements UserRepository with postgresql pooling
type userRepository struct {
	pool  *pgxpool.Pool
	redis *redis.Client
}

// NewUserRepository creates a new PostgreSQL user repository
func NewUserRepository(pool *pgxpool.Pool, redis *redis.Client) UserRepository {
	return &userRepository{pool: pool, redis: redis}
}

// Create adds a new user and returns the user id
func (r *userRepository) Create(ctx context.Context, username, password string) (uint64, error) {
	query := `
		INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id;
	`

	var userID uint64
	err := r.pool.QueryRow(ctx, query, username, password).Scan(&userID)
	if err != nil {
		return 0, fmt.Errorf("failed to create user: %w", err)
	}

	return userID, nil
}

// GetPlayerByID retrieves a user by their user id (not uuid)
func (r *userRepository) GetPlayerByID(ctx context.Context, userID uint64) (*entity.User, error) {
	query := `
		SELECT id, username, created_at, updated_at, is_active
		FROM users
		WHERE id = $1
	`

	var user entity.User
	err := r.pool.QueryRow(ctx, query, userID).Scan(
		&user.ID,
		&user.Username,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.IsActive,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get user by their id: %w", err)
	}

	return &user, nil
}

// GetByCredentials retrieves a user by username and password
func (r *userRepository) GetByCredentials(ctx context.Context, username, password string) (*entity.User, error) {
	query := `
		SELECT id, username, password, created_at, updated_at, is_active
		FROM users
		WHERE username = $1 AND password = $2
	`

	var user entity.User
	err := r.pool.QueryRow(ctx, query, username, password).Scan(
		&user.ID,
		&user.Username,
		&user.Password,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.IsActive,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get user by credentials: %w", err)
	}

	return &user, nil
}

// GetByID retrieves a user by ID
func (r *userRepository) GetByID(ctx context.Context, userID uint64) (*entity.User, error) {
	query := `
		SELECT id, username, password, created_at, updated_at, is_active
		FROM users
		WHERE id = $1
	`

	var user entity.User
	err := r.pool.QueryRow(ctx, query, userID).Scan(
		&user.ID,
		&user.Username,
		&user.Password,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.IsActive,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to get user by id: %w", err)
	}

	return &user, nil
}
