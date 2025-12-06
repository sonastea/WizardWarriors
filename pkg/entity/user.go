package entity

import (
	"sync"
	"time"
)

type User struct {
	sync.RWMutex

	ID uint `json:"id"`

	UUID      string    `json:"uuid"`
	Username  string    `json:"username"`
	Password  string    `json:"password"`
	Email     string    `json:"email"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	IsActive  bool      `json:"is_active"`
}
