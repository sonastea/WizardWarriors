package logger

import (
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
)

// Level represents log verbosity levels
// Higher levels include all lower level logs
// ERROR (0) - Only critical errors
// WARN (1) - Warnings and errors
// INFO (2) - Important events (connections, chat, announcements) + warn/error
// DEBUG (3) - Everything including high-frequency events (player_input, game_state)
type Level int

const (
	LevelError Level = iota
	LevelWarn
	LevelInfo
	LevelDebug
)

var levelNames = map[Level]string{
	LevelError: "ERROR",
	LevelWarn:  "WARN",
	LevelInfo:  "INFO",
	LevelDebug: "DEBUG",
}

var levelFromString = map[string]Level{
	"error": LevelError,
	"warn":  LevelWarn,
	"info":  LevelInfo,
	"debug": LevelDebug,
}

type Logger struct {
	mu     sync.RWMutex
	level  Level
	stdLog *log.Logger
	errLog *log.Logger
}

var defaultLogger = &Logger{
	level:  LevelInfo,
	stdLog: log.New(os.Stdout, "", log.LstdFlags),
	errLog: log.New(os.Stderr, "", log.LstdFlags),
}

// SetLevel sets the global log level
func SetLevel(level Level) {
	defaultLogger.mu.Lock()
	defer defaultLogger.mu.Unlock()
	defaultLogger.level = level
}

// SetLevelFromString sets log level from a string (error, warn, info, debug)
func SetLevelFromString(levelStr string) error {
	level, ok := levelFromString[strings.ToLower(levelStr)]
	if !ok {
		return fmt.Errorf("invalid log level: %s (valid: error, warn, info, debug)", levelStr)
	}
	SetLevel(level)
	return nil
}

// GetLevel returns the current log level
func GetLevel() Level {
	defaultLogger.mu.RLock()
	defer defaultLogger.mu.RUnlock()
	return defaultLogger.level
}

// GetLevelName returns the name of the current log level
func GetLevelName() string {
	return levelNames[GetLevel()]
}

// shouldLog returns true if the given level should be logged
func shouldLog(level Level) bool {
	defaultLogger.mu.RLock()
	defer defaultLogger.mu.RUnlock()
	return level <= defaultLogger.level
}

// Debug logs debug-level messages (high frequency, verbose)
// Use for: player_input, game_state updates, internal state changes
func Debug(format string, args ...any) {
	if shouldLog(LevelDebug) {
		defaultLogger.stdLog.Printf("[DEBUG] "+format, args...)
	}
}

// Info logs info-level messages (important events)
// Ex: player connect/disconnect, chat messages, announcements
func Info(format string, args ...any) {
	if shouldLog(LevelInfo) {
		defaultLogger.stdLog.Printf("[INFO] "+format, args...)
	}
}

// Warn logs warning-level messages
// Ex: deprecated API usage, recoverable errors, unknown message types
func Warn(format string, args ...any) {
	if shouldLog(LevelWarn) {
		defaultLogger.stdLog.Printf("[WARN] "+format, args...)
	}
}

// Error logs error-level messages
// Ex: failures that need attention, unrecoverable errors
func Error(format string, args ...any) {
	if shouldLog(LevelError) {
		defaultLogger.errLog.Printf("[ERROR] "+format, args...)
	}
}

// Fatal logs an error and exits
func Fatal(format string, args ...any) {
	defaultLogger.errLog.Printf("[FATAL] "+format, args...)
	os.Exit(1)
}

// ParseLevel converts a string to a Level
func ParseLevel(s string) (Level, error) {
	level, ok := levelFromString[strings.ToLower(s)]
	if !ok {
		return LevelInfo, fmt.Errorf("invalid log level: %s", s)
	}
	return level, nil
}
