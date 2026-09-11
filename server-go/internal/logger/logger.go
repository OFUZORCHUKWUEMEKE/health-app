// Package logger provides the shared structured zap logger.
package logger

import (
	"sync"

	"go.uber.org/zap"
)

var (
	mu  sync.RWMutex
	log *zap.Logger = zap.NewNop()
)

// Init builds the global logger: JSON in production, console otherwise.
func Init(production bool) error {
	var (
		l   *zap.Logger
		err error
	)
	if production {
		l, err = zap.NewProduction()
	} else {
		l, err = zap.NewDevelopment()
	}
	if err != nil {
		return err
	}
	mu.Lock()
	log = l
	mu.Unlock()
	return nil
}

// L returns the global logger.
func L() *zap.Logger {
	mu.RLock()
	defer mu.RUnlock()
	return log
}

// Sync flushes buffered logs; safe to defer in main.
func Sync() {
	_ = L().Sync()
}
