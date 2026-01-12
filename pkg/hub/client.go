package hub

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	multiplayerv1 "github.com/sonastea/WizardWarriors/common/gen/multiplayer/v1"
	"github.com/sonastea/WizardWarriors/pkg/logger"
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
	// UserID is the user's database ID (as string for proto compatibility)
	UserID   string `json:"user_id"`
	Username string `json:"username,omitempty"`
	conn     *websocket.Conn

	hub   *Hub
	token string

	sendChan chan []byte
}

func NewClient(hub *Hub, conn *websocket.Conn, token string) error {
	// Require a valid token for WebSocket connections
	if token == "" {
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "Missing session token"))
		conn.Close()
		return fmt.Errorf("missing session token")
	}

	sessionInfo, err := hub.GetSessionInfo(token)
	if err != nil || sessionInfo == nil {
		logger.Warn("Failed to get session info for token: %v", err)
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "Invalid or expired session"))
		conn.Close()
		return fmt.Errorf("invalid or expired session: %w", err)
	}

	client := &Client{
		UserID:   sessionInfo.UserID,
		Username: sessionInfo.Username,
		hub:      hub,
		conn:     conn,
		token:    token,
		sendChan: make(chan []byte),
	}

	hub.register <- client

	go client.writePump()
	go client.readPump()

	return nil
}

func (client *Client) GetUserID() string {
	return client.UserID
}

func (client *Client) GetName() string {
	return client.Username
}

func (client *Client) readPump() {
	defer func() {
		close(client.sendChan)
		client.hub.unregister <- client
		client.conn.Close()
	}()

	client.conn.SetReadLimit(maxMessageSize)
	client.conn.SetReadDeadline(time.Now().Add(pongWait))
	client.conn.SetPongHandler(func(string) error {
		client.conn.SetReadDeadline(time.Now().Add(pongWait))
		if client.token != "" {
			if err := client.hub.RefreshSession(client.token); err != nil {
				logger.Debug("Failed to refresh session for %s: %v", client.Username, err)
			}
		}
		return nil
	})

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
				logger.Error("WebSocket error: %v", err)
			}
			logger.Info("%s (%s) disconnected", client.Username, client.UserID)

			// Handle player leaving - notify game state using their UserID
			client.hub.gameStateManager.RemovePlayer(client.UserID)
			break
		}

		// Inject sender info into chat messages before publishing
		message = client.injectSenderInfo(message)

		client.hub.pubsub.conn.Publish(context.Background(), "chat.lobby", message)
	}
}

// injectSenderInfo adds sender ID and username to chat messages
func (client *Client) injectSenderInfo(message []byte) []byte {
	gameMsg := &multiplayerv1.GameMessage{}
	if err := proto.Unmarshal(message, gameMsg); err != nil {
		return message
	}

	// Only inject sender info for chat messages
	if gameMsg.Type == multiplayerv1.GameMessageType_GAME_MESSAGE_TYPE_CHAT_MESSAGE {
		if chatMsg := gameMsg.GetChatMessage(); chatMsg != nil {
			// Set sender ID and name from client info
			chatMsg.SenderId = &multiplayerv1.ID{Value: client.UserID}
			chatMsg.SenderName = client.Username

			// Re-marshal the modified message
			modified, err := proto.Marshal(gameMsg)
			if err != nil {
				logger.Error("Failed to marshal modified chat message: %v", err)
				return message
			}
			return modified
		}
	}

	return message
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
