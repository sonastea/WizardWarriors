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
	"github.com/sonastea/WizardWarriors/pkg/repository"
	"github.com/sonastea/WizardWarriors/pkg/server"
	"github.com/sonastea/WizardWarriors/pkg/service"
)

func main() {
	ctx := context.Background()

	cfg := &config.Config{}
	cfg.Load(os.Args[1:])
	cfg.RedisOpts = config.NewRedisOpts(cfg.RedisURL)

	_, err := pgxpool.New(context.Background(), cfg.DBConnURI)
	if err != nil {
		panic(err)
	}

	pool := db.NewConnPool(ctx, cfg.DBConnURI)

	userRepo := repository.NewPostgresUserRepository(pool)
	gameRepo := repository.NewPostgresGameRepository(pool)

	apiService := service.NewApiService(userRepo, gameRepo)

	apiHandler := handler.NewApiHandler(apiService)

	redisClient := redis.NewClient(cfg.RedisOpts)

	apiSrv, err := server.NewServer(
		cfg,
		server.WithRedis(redisClient),
		server.WithApiHandler(apiHandler),
	)
	if err != nil {
		log.Fatalln("Unable to create server:", err)
	}

	apiSrv.Start()
}
