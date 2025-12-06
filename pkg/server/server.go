package server

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	"github.com/rs/cors"
	"github.com/sonastea/WizardWarriors/pkg/config"
	"github.com/sonastea/WizardWarriors/pkg/handler"
	"github.com/sonastea/WizardWarriors/pkg/hub"
)

type Server struct {
	cfg        *config.Config
	server     *http.Server
	redis      *redis.Client
	hub        *hub.Hub
	serverName string
}

// Option is a functional option for configuring the Server
type Option func(*Server) error

// WithRedis adds Redis client to the server
func WithRedis(client *redis.Client) Option {
	return func(s *Server) error {
		s.redis = client
		return nil
	}
}

// WithHub enables the WebSocket hub for real-time communication
func WithHub(h *hub.Hub) Option {
	return func(s *Server) error {
		s.hub = h
		return nil
	}
}

// WithApiHandler configures the server with REST API handlers
func WithApiHandler(apiHandler *handler.ApiHandler) Option {
	return func(s *Server) error {
		router := s.server.Handler.(*http.ServeMux)
		api := http.NewServeMux()

		router.HandleFunc("/healthcheck", healthcheckHandler)

		api.HandleFunc("/leaderboard", apiHandler.GetLeaderboard)
		api.HandleFunc("/player-save", apiHandler.GetPlayerSave)
		api.HandleFunc("/save-game", apiHandler.SaveGame)
		api.HandleFunc("/register", apiHandler.Register)
		api.HandleFunc("/login", apiHandler.Login)

		router.Handle("/api/", enableCors(http.StripPrefix("/api", api), s.cfg.AllowedOrigins, s.cfg.Debug))
		return nil
	}
}

// WithWebSocket configures the server with WebSocket endpoint
func WithWebSocket(path string, upgrader websocket.Upgrader) Option {
	return func(s *Server) error {
		if s.hub == nil {
			return nil
		}

		router := s.server.Handler.(*http.ServeMux)
		router.HandleFunc(path, func(w http.ResponseWriter, r *http.Request) {
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				log.Println(err)
				return
			}

			err = hub.NewClient(s.hub, conn)
			if err != nil {
				log.Println(err)
				return
			}
		})
		return nil
	}
}

// NewServer creates a new server with functional options
func NewServer(cfg *config.Config, opts ...Option) (*Server, error) {
	router := http.NewServeMux()
	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      router,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	s := &Server{
		cfg:        cfg,
		server:     srv,
		serverName: "WizardWarriors server",
	}

	// Apply all options
	for _, opt := range opts {
		if err := opt(s); err != nil {
			return nil, err
		}
	}

	return s, nil
}

func enableCors(h http.Handler, origins []string, debug bool) http.Handler {
	c := cors.New(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{http.MethodGet, http.MethodPost, http.MethodOptions},
		AllowedHeaders:   []string{"Content-Type", "Authorization"},
		AllowCredentials: true,
		Debug:            debug,
	})

	return c.Handler(h)
}

func healthcheckHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK\n"))
}

// Start starts the server with optional hub context
func (s *Server) Start() {
	var hubCtx context.Context
	var hubCancel context.CancelFunc

	cleanup := make(chan os.Signal, 1)
	signal.Notify(cleanup, syscall.SIGINT, syscall.SIGTERM)

	if s.hub != nil {
		hubCtx, hubCancel = context.WithCancel(context.Background())
		go s.hub.Run(hubCtx)
		s.serverName = "WizardWarriors game server"
	} else {
		s.serverName = "WizardWarriors api server"
	}

	go func() {
		<-cleanup
		log.Println("Received quit signal . . .")

		if hubCancel != nil {
			hubCancel()
		}

		if s.redis != nil {
			if err := s.redis.Close(); err != nil {
				log.Printf("Error closing Redis connection: %v\n", err)
			}
		}

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()

		if err := s.server.Shutdown(shutdownCtx); err != nil {
			log.Printf("Error during server shutdown: %v\n", err)
		}

		log.Printf("%s shutdown complete.\n", s.serverName)
	}()

	id := time.Now().Format("20060102-150405")

	resetColor := "\033[0m"
	blueColor := "\033[94m"
	boldText := "\033[1m"

	log.Printf("[ID: %s%s%s%s] %s listening on %s \n",
		boldText, blueColor, id, resetColor, s.serverName, s.server.Addr)

	if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("HTTP server ListenAndServe: %v [ID: %s%s%s%s]\n",
			err, boldText, blueColor, id, resetColor)
	}
}
