package main

import (
	"context"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/sonastea/WizardWarriors/pkg/config"
	db "github.com/sonastea/WizardWarriors/pkg/database"
	"github.com/sonastea/WizardWarriors/pkg/handler"
	"github.com/sonastea/WizardWarriors/pkg/hub"
	"github.com/sonastea/WizardWarriors/pkg/repository"
	"github.com/sonastea/WizardWarriors/pkg/server"
	"github.com/sonastea/WizardWarriors/pkg/service"
)

func main() {
	ctx := context.Background()

	cfg := &config.Config{}
	cfg.Load(os.Args[1:])
	cfg.RedisOpts = config.NewRedisOpts(cfg.RedisURL)
	cfg.IsAPIServer = true

	redisClient := redis.NewClient(cfg.RedisOpts)

	h, err := hub.New(cfg)
	if err != nil {
		panic(err)
	}

	_, err = pgxpool.New(context.Background(), cfg.DBConnURI)
	if err != nil {
		panic(err)
	}

	pool := db.NewConnPool(ctx, cfg.DBConnURI)

	userRepo := repository.NewUserRepository(pool, redisClient)
	gameRepo := repository.NewGameRepository(pool, redisClient)

	apiService := service.NewApiService(userRepo, gameRepo)

	apiHandler := handler.NewApiHandler(apiService, cfg.SessionMaxAge)

	apiSrv, err := server.NewServer(
		cfg,
		server.WithHub(h),
		server.WithRedis(redisClient),
		server.WithApiHandler(apiHandler),
	)
	if err != nil {
		log.Fatalln("Unable to create server:", err)
	}

	apiSrv.Start()
}
