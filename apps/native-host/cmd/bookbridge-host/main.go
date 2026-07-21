package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/host"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/httpserver"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/nativemessaging"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/protocol"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/transfer"
)

const shutdownTimeout = 5 * time.Second

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		_ = os.Stdin.Close()
	}()

	if err := run(ctx, os.Stdin, os.Stdout, os.Stderr); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "bookbridge: %v\n", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, input io.Reader, output io.Writer, diagnostics io.Writer) error {
	return runWithServerStarter(ctx, input, output, diagnostics, func(config httpserver.Config) (localServer, error) {
		return httpserver.Listen(config)
	})
}

type localServer interface {
	URL(string) string
	Close(context.Context) error
}

type serverStarter func(httpserver.Config) (localServer, error)

func runWithServerStarter(ctx context.Context, input io.Reader, output io.Writer, diagnostics io.Writer, startServer serverStarter) error {
	logger := log.New(diagnostics, "bookbridge: ", log.LstdFlags)
	store := transfer.NewStore(transfer.Options{})
	emitter := nativemessaging.NewEmitter(output)

	server, startupErr := startServer(httpserver.Config{
		Store: store,
		OnCompleted: func(session transfer.Session) {
			if err := emitter.Emit(protocol.CompletedEvent(session.TransferID)); err != nil && !errors.Is(err, nativemessaging.ErrEmitterClosed) {
				logger.Printf("emit transfer completion: %v", err)
			}
		},
	})
	if startupErr != nil {
		logger.Printf("local HTTP server unavailable: %v", startupErr)
	}

	serviceOptions := host.ServiceOptions{Store: store, StartupError: startupErr}
	if server != nil {
		serviceOptions.URL = server.URL
	}
	service, err := host.NewService(serviceOptions)
	if err != nil {
		_ = store.Close()
		return err
	}
	runner, err := host.NewRunner(host.RunnerOptions{Service: service, Emitter: emitter})
	if err != nil {
		_ = store.Close()
		return err
	}

	runErr := runner.Run(ctx, input)
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	var serverErr error
	if server != nil {
		serverErr = server.Close(shutdownCtx)
	}
	storeErr := store.Close()
	return errors.Join(runErr, serverErr, storeErr)
}
