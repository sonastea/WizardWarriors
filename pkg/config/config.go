package config

import (
	"flag"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type Config struct {
	Addr          string
	ReadTimeout   time.Duration
	WriteTimeout  time.Duration
	IdleTimeout   time.Duration
	SessionMaxAge int

	AllowedOrigins []string
	Debug          bool
	LogLevel       string
	DBConnURI      string
	RedisURL       string
	RedisOpts      *redis.Options
	MapPath        string
	IsAPIServer    bool
}

// Load parses the command-line arguments into the Config struct
func (c *Config) Load(args []string) error {
	fs := flag.NewFlagSet("ww", flag.ContinueOnError)

	addrDefault := envOrDefault("ADDR", ":8080")
	debugDefault := envOrDefaultBool("DEBUG", false)
	dbConnDefault := envOrDefault("DATABASE_URL", "postgresql://postgres:postgres@db/wizardwarriors")
	redisURLDefault := envOrDefault("REDIS_URL", "redis://localhost:6379/0")
	sessionMaxAgeDefault := envOrDefaultInt("SESSION_MAX_AGE", 86400)
	mapPathDefault := envOrDefault("MAP_PATH", "pkg/hub/assets/multiplayer_map.json")
	apiServerDefault := envOrDefaultBool("API_SERVER", false)
	allowedOriginsDefault := envOrDefault("ALLOWED_ORIGINS", "http://ww.dev.localhost,http://localhost:3000")

	fs.StringVar(&c.Addr, "ADDR", addrDefault, "binding server address")
	fs.BoolVar(&c.Debug, "debug", debugDefault, "enable debug mode for detailed logging")
	fs.StringVar(&c.DBConnURI, "DATABASE_URL", dbConnDefault, "database connection uri")
	fs.StringVar(&c.RedisURL, "REDIS_URL", redisURLDefault, "redis url")
	fs.IntVar(&c.SessionMaxAge, "SESSION_MAX_AGE", sessionMaxAgeDefault, "session cookie max age in seconds (default: 86400 = 24 hours)")
	fs.StringVar(&c.MapPath, "MAP_PATH", mapPathDefault, "path to the game map JSON file")
	fs.BoolVar(&c.IsAPIServer, "API_SERVER", apiServerDefault, "run as API server (disables game-specific features like pub/sub and game state)")

	var allowedOrigins string
	fs.StringVar(&allowedOrigins, "ALLOWED_ORIGINS", allowedOriginsDefault, "comma-separated list of allowed origins for CORS")

	if err := fs.Parse(args); err != nil {
		return err
	}

	c.AllowedOrigins = parseOrigins(allowedOrigins)

	c.LogLevel = os.Getenv("LOG_LEVEL")
	if c.LogLevel == "" {
		c.LogLevel = "info"
	}

	return nil
}

func envOrDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	return value
}

func envOrDefaultBool(key string, fallback bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}

	return parsed
}

func envOrDefaultInt(key string, fallback int) int {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}

	return parsed
}

// parseOrigins parses the allowed origins flag or uses a default value if none is provided
func parseOrigins(allowedOrigins string) []string {
	if allowedOrigins == "" {
		return []string{"http://localhost:3000"}
	}

	origins := strings.Split(allowedOrigins, ",")
	for i, origin := range origins {
		origins[i] = strings.TrimSpace(origin)
	}

	return origins
}
