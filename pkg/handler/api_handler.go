package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/sonastea/WizardWarriors/pkg/entity"
	"github.com/sonastea/WizardWarriors/pkg/logger"
	"github.com/sonastea/WizardWarriors/pkg/service"
)

type ApiHandler struct {
	apiService    service.ApiService
	sessionMaxAge int
}

func NewApiHandler(apiService service.ApiService, sessionMaxAge int) *ApiHandler {
	return &ApiHandler{
		apiService:    apiService,
		sessionMaxAge: sessionMaxAge,
	}
}

type APIResponse struct {
	Success bool   `json:"success"`
	Data    any    `json:"data,omitempty"`
	Error   string `json:"error,omitempty"`
}

type UserCredentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type PlayerSaveRequest struct {
	GameID uint64 `json:"game_id"`
}

type JoinMultiplayerRequest struct {
	GuestID string `json:"guestId,omitempty"`
}

func errorResponse(err string) APIResponse {
	return APIResponse{
		Success: false,
		Error:   err,
	}
}

func successResponse(data any) APIResponse {
	return APIResponse{
		Success: true,
		Data:    data,
	}
}

func writeJSON(w http.ResponseWriter, status int, response APIResponse) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(response)
}

func getDomain(r *http.Request) string {
	if isProduction() {
		return ".wizardwarriors.com"
	}
	host := r.Host
	if strings.Contains(host, ".ww.local") || strings.Contains(host, "ww.local") {
		return ".ww.local"
	}
	return ""
}

func getSameSite() http.SameSite {
	if isProduction() {
		return http.SameSiteNoneMode
	}
	return http.SameSiteLaxMode
}

func isProduction() bool {
	return os.Getenv("ENV") == "production"
}

func (h *ApiHandler) setUserCookie(w http.ResponseWriter, r *http.Request, userID uint64) {
	http.SetCookie(w, &http.Cookie{
		Name:     "ww-userId",
		Value:    fmt.Sprintf("%d", userID),
		Path:     "/",
		Domain:   getDomain(r),
		Secure:   isProduction(),
		HttpOnly: false,
		SameSite: getSameSite(),
		MaxAge:   h.sessionMaxAge,
	})
}

// Register handles user registration
func (h *ApiHandler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("Method not allowed"))
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse("Error reading request body"))
		return
	}
	defer r.Body.Close()

	var credentials UserCredentials
	if err := json.Unmarshal(body, &credentials); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("Invalid JSON format"))
		return
	}

	userID, err := h.apiService.Register(r.Context(), credentials.Username, credentials.Password)
	if err != nil {
		logger.Warn("Registration error: %v", err)
		if strings.Contains(err.Error(), "already exists") {
			writeJSON(w, http.StatusConflict, errorResponse(err.Error()))
		} else if strings.Contains(err.Error(), "cannot be empty") || strings.Contains(err.Error(), "must be at least") {
			writeJSON(w, http.StatusBadRequest, errorResponse(err.Error()))
		} else {
			writeJSON(w, http.StatusInternalServerError, errorResponse("Failed to create user"))
		}
		return
	}

	h.setUserCookie(w, r, userID)

	writeJSON(w, http.StatusCreated, successResponse(map[string]uint64{"id": userID}))
}

// Login handles user authentication
func (h *ApiHandler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("Method not allowed"))
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse("Error reading request body"))
		return
	}
	defer r.Body.Close()

	var credentials UserCredentials
	if err := json.Unmarshal(body, &credentials); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("Invalid JSON format"))
		return
	}

	userID, err := h.apiService.Login(r.Context(), credentials.Username, credentials.Password)
	if err != nil {
		logger.Debug("Login error: %v", err)
		writeJSON(w, http.StatusUnauthorized, errorResponse("Invalid username or password"))
		return
	}

	saves, err := h.apiService.GetPlayerSaves(r.Context(), userID)
	if err != nil {
		logger.Error("Error getting player saves: %v", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse("Failed to get player saves"))
		return
	}

	h.setUserCookie(w, r, userID)

	writeJSON(w, http.StatusOK, successResponse(saves))
}

// GetPlayerSaves handles retrieving all player saves for the authenticated user
func (h *ApiHandler) GetPlayerSaves(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("Method not allowed"))
		return
	}

	cookie, err := r.Cookie("ww-userId")
	if err != nil {
		if err == http.ErrNoCookie {
			writeJSON(w, http.StatusUnauthorized, errorResponse("Not authenticated"))
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorResponse("Error retrieving authentication"))
		return
	}

	userID, err := strconv.ParseUint(cookie.Value, 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("Invalid authentication cookie"))
		return
	}

	saves, err := h.apiService.GetPlayerSaves(r.Context(), userID)
	if err != nil {
		logger.Error("Error getting player saves: %v", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse("Failed to get player saves"))
		return
	}

	writeJSON(w, http.StatusOK, successResponse(saves))
}

// GetPlayerSave handles retrieving a player save by game ID
func (h *ApiHandler) GetPlayerSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("Method not allowed"))
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("Invalid request"))
		return
	}
	defer r.Body.Close()

	var req PlayerSaveRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("Invalid JSON format"))
		return
	}

	save, err := h.apiService.GetPlayerSave(r.Context(), req.GameID)
	if err != nil {
		logger.Error("Error getting player save: %v", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse(err.Error()))
		return
	}

	writeJSON(w, http.StatusOK, successResponse(save))
}

// SaveGame handles saving or updating a game
func (h *ApiHandler) SaveGame(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("Method not allowed"))
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("Invalid request"))
		return
	}
	defer r.Body.Close()

	var gameStats entity.GameStats
	if err := json.Unmarshal(body, &gameStats); err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("Invalid JSON format"))
		return
	}

	cookie, err := r.Cookie("ww-userId")
	if err != nil {
		if err == http.ErrNoCookie {
			writeJSON(w, http.StatusUnauthorized, errorResponse("Not authenticated"))
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorResponse("Error retrieving authentication"))
		return
	}

	userID, err := strconv.ParseUint(cookie.Value, 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("Invalid authentication cookie"))
		return
	}

	saved, err := h.apiService.SaveGame(r.Context(), userID, &gameStats)
	if err != nil {
		logger.Error("Error saving game: %v", err)
		if strings.Contains(err.Error(), "unauthorized") {
			writeJSON(w, http.StatusForbidden, errorResponse("You are not authorized to save this game"))
		} else {
			writeJSON(w, http.StatusInternalServerError, errorResponse("Failed to save game"))
		}
		return
	}

	writeJSON(w, http.StatusOK, successResponse(saved))
}

// GetLeaderboard handles retrieving the leaderboard
func (h *ApiHandler) GetLeaderboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("Method not allowed"))
		return
	}

	leaderboard, err := h.apiService.GetLeaderboard(context.Background())
	if err != nil {
		logger.Error("Error getting leaderboard: %v", err)
		writeJSON(w, http.StatusInternalServerError, errorResponse("Failed to get leaderboard"))
		return
	}

	writeJSON(w, http.StatusOK, successResponse(leaderboard))
}

// JoinMultiplayer handles authenticating the user or creating a guest session for the game server
func (h *ApiHandler) JoinMultiplayer(w http.ResponseWriter, r *http.Request) {
	// Try to get authenticated user from cookie
	cookie, err := r.Cookie("ww-userId")
	if err == nil {
		// User has a cookie, try to authenticate
		userID, parseErr := strconv.ParseUint(cookie.Value, 10, 64)
		if parseErr == nil {
			token, joinErr := h.apiService.JoinMultiplayer(r.Context(), userID)
			if joinErr == nil {
				writeJSON(w, http.StatusOK, successResponse(token))
				return
			}
			// If join fails, fall through to guest flow
			logger.Debug("Authenticated join failed, falling back to guest: %v", joinErr)
		}
	}

	// No valid cookie or auth failed - handle as guest
	var req JoinMultiplayerRequest
	if r.Body != nil {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && err.Error() != "EOF" {
			writeJSON(w, http.StatusBadRequest, errorResponse("Invalid request body"))
			return
		}
	}

	token, err := h.apiService.JoinMultiplayerAsGuest(r.Context(), req.GuestID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorResponse("Failed to create guest session"))
		return
	}

	writeJSON(w, http.StatusOK, successResponse(token))
}

// ValidateSession checks if the current session is valid and returns user info
func (h *ApiHandler) ValidateSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("Method not allowed"))
		return
	}

	cookie, err := r.Cookie("ww-userId")
	if err != nil {
		if err == http.ErrNoCookie {
			writeJSON(w, http.StatusUnauthorized, errorResponse("Not authenticated"))
			return
		}
		writeJSON(w, http.StatusInternalServerError, errorResponse("Error retrieving authentication"))
		return
	}

	userID, err := strconv.ParseUint(cookie.Value, 10, 64)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errorResponse("Invalid authentication cookie"))
		return
	}

	userInfo, err := h.apiService.ValidateSession(r.Context(), userID)
	if err != nil {
		logger.Debug("Session validation error: %v", err)
		writeJSON(w, http.StatusUnauthorized, errorResponse("Session invalid"))
		return
	}

	writeJSON(w, http.StatusOK, successResponse(userInfo))
}

// Logout handles user logout
func (h *ApiHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errorResponse("Method not allowed"))
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     "ww-userId",
		Value:    "",
		Path:     "/",
		Domain:   getDomain(r),
		Secure:   isProduction(),
		HttpOnly: false,
		SameSite: getSameSite(),
		MaxAge:   -1,
	})

	writeJSON(w, http.StatusOK, successResponse(map[string]string{"message": "Logged out successfully"}))
}
