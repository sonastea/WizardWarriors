package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/sonastea/WizardWarriors/pkg/entity"
)

// UserRepository defines the interface for user storage operations
type UserRepository interface {
	Create(ctx context.Context, username, password string) (int, error)
	GetByCredentials(ctx context.Context, username, password string) (*entity.User, error)
	GetByID(ctx context.Context, userID int) (*entity.User, error)
}

// PostgresUserRepository implements UserRepository for PostgreSQL
type PostgresUserRepository struct {
	pool *pgxpool.Pool
}

// NewPostgresUserRepository creates a new PostgreSQL user repository
func NewPostgresUserRepository(pool *pgxpool.Pool) *PostgresUserRepository {
	return &PostgresUserRepository{pool: pool}
}

// Create adds a new user and returns the user id
func (r *PostgresUserRepository) Create(ctx context.Context, username, password string) (int, error) {
	query := `
		INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id;
	`

	var userID int
	err := r.pool.QueryRow(ctx, query, username, password).Scan(&userID)
	if err != nil {
		return 0, fmt.Errorf("failed to create user: %w", err)
	}

	return userID, nil
}

// GetByCredentials retrieves a user by username and password
func (r *PostgresUserRepository) GetByCredentials(ctx context.Context, username, password string) (*entity.User, error) {
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
func (r *PostgresUserRepository) GetByID(ctx context.Context, userID int) (*entity.User, error) {
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
