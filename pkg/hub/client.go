package hub

import (
	"context"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/lithammer/shortuuid"
	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
	"google.golang.org/protobuf/proto"
)

const (
	// Time allowed to write a message to the peer.
	writeWait = 10 * time.Second

	// Time allowed to read the next pong message from the peer.
	pongWait = 60 * time.Second

	// Send pings to peer with this period. Must be less than pongWait.
	pingPeriod = (pongWait * 9) / 10

	// Maximum message size allowed from peer.
	maxMessageSize = 1000
)

type Client struct {
	sync.RWMutex
	Id       int    `json:"id,string,omitempty"`
	Xid      string `json:"xid"`
	Username string `json:"username,omitempty"`
	Email    string `json:"email,omitempty"`
	Password string `json:"password,omitempty"`
	conn     *websocket.Conn

	hub *Hub

	sendChan chan []byte
	playerId string
}

func NewClient(hub *Hub, conn *websocket.Conn) error {
	newId := shortuuid.New()
	client := &Client{
		Xid:      newId,
		Username: newId,
		Email:    newId + "@example.com",
		Password: "",
		hub:      hub,
		conn:     conn,
		sendChan: make(chan []byte),
	}

	hub.register <- client

	go client.writePump()
	go client.readPump()

	return nil
}

func (client *Client) GetId() int {
	return client.Id
}

func (client *Client) GetXid() string {
	return client.Xid
}

func (client *Client) GetName() string {
	return client.Username
}

func (client *Client) GetEmail() string {
	return client.Email
}

func (client *Client) GetPassword() string {
	return client.Password
}

func (client *Client) readPump() {
	defer func() {
		close(client.sendChan)
		client.hub.unregister <- client
		client.conn.Close()
	}()

	client.conn.SetReadLimit(maxMessageSize)
	client.conn.SetReadDeadline(time.Now().Add(pongWait))
	client.conn.SetPongHandler(func(string) error { client.conn.SetReadDeadline(time.Now().Add(pongWait)); return nil })

	client.conn.SetCloseHandler(func(code int, text string) error {
		message := websocket.FormatCloseMessage(code, "Goodbye! Connection closing.")
		client.conn.WriteControl(websocket.CloseMessage, message, time.Now().Add(writeWait))
		return nil
	})

	for {
		_, message, err := client.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseGoingAway,
				websocket.CloseAbnormalClosure,
				websocket.CloseNormalClosure) {
				log.Printf("error: %v", err)
			}
			log.Printf("Client %s (%s) disconnected", client.Username, client.Xid)

			// Handle player leaving - notify game state
			if client.playerId != "" {
				client.hub.gameStateManager.RemovePlayer(client.playerId)
			}
			break
		}

		// Try to extract player ID from incoming messages for tracking
		// This helps us associate the client with their in-game player
		client.extractPlayerIdFromMessage(message)

		client.hub.pubsub.conn.Publish(context.Background(), "chat.lobby", message)
	}
}

func (client *Client) extractPlayerIdFromMessage(message []byte) {
	// Parse the protobuf message to extract player ID
	gameMsg := &multiplayerv1.GameMessage{}
	if err := proto.Unmarshal(message, gameMsg); err != nil {
		return
	}

	// Check if it's a player event with a player ID
	if gameMsg.Type == multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_PLAYER_EVENT {
		if playerEvent := gameMsg.GetPlayerEvent(); playerEvent != nil && playerEvent.PlayerId != nil {
			client.playerId = playerEvent.PlayerId.Value
		}
	}
}

func (client *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		client.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-client.sendChan:
			client.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// The hub closed the channel.
				client.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := client.conn.NextWriter(websocket.BinaryMessage)
			if err != nil {
				return
			}

			w.Write(msg)

			for range len(client.sendChan) {
				w.Write(<-client.sendChan)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			client.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := client.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
