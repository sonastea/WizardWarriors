.PHONY: api game dev help

help:
	@echo "Available commands:"
	@echo "  make api   - Run the API server with air hot reload"
	@echo "  make game  - Run the game client with air hot reload"
	@echo "  make dev   - Run both API server and game client concurrently"
	@echo ""
	@echo "For more control, set environment variables:"
	@echo "  DATABASE_URL=postgresql://... make api"
	@echo "  REDIS_URL=redis://... make api"
	@echo ""
	@echo "Or run the binary directly with arguments:"
	@echo "  go run ./cmd/ww-srv --ADDR=:8080 --debug"

api:
	@echo "Starting API server..."
	air -c ./cmd/ww-srv/.air.toml

game:
	@echo "Starting game client..."
	air -c ./cmd/ww-game/.air.toml

dev:
	@echo "Starting both API server and game client..."
	@trap 'kill 0' EXIT; \
	air -c ./cmd/ww-srv/.air.toml & \
	air -c ./cmd/ww-game/.air.toml & \
	wait
