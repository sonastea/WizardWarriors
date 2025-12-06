package main

import (
	"log"
	"net/http"
	"os"

	"github.com/gorilla/websocket"
	"github.com/sonastea/WizardWarriors/pkg/config"
	"github.com/sonastea/WizardWarriors/pkg/hub"
	"github.com/sonastea/WizardWarriors/pkg/server"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Returning true for now, but should check origin.
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func main() {
	cfg := &config.Config{}
	cfg.Load(os.Args[1:])
	cfg.RedisOpts = config.NewRedisOpts(cfg.RedisURL)

	h, err := hub.New(cfg, nil, nil)
	if err != nil {
		panic(err)
	}

	gameSrv, err := server.NewServer(
		cfg,
		server.WithHub(h),
		server.WithWebSocket("/game", upgrader),
	)
	if err != nil {
		log.Fatalln("Unable to create server:", err)
	}

	gameSrv.Start()
}
