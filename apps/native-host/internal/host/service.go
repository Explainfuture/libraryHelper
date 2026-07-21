// Package host connects validated Native Messaging requests to BookBridge's
// transfer and HTTP subsystems.
package host

import (
	"errors"

	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/epub"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/lan"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/protocol"
	"github.com/Explainfuture/libraryHelper/apps/native-host/internal/transfer"
)

type FileValidator func(string) (epub.File, error)
type URLBuilder func(string) string

type ServiceOptions struct {
	Store        *transfer.Store
	Validate     FileValidator
	URL          URLBuilder
	StartupError error
}

type Service struct {
	store        *transfer.Store
	validate     FileValidator
	url          URLBuilder
	startupError error
}

func NewService(options ServiceOptions) (*Service, error) {
	if options.Store == nil {
		return nil, errors.New("host service requires a transfer store")
	}
	validator := options.Validate
	if validator == nil {
		validator = epub.Validate
	}
	return &Service{
		store:        options.Store,
		validate:     validator,
		url:          options.URL,
		startupError: options.StartupError,
	}, nil
}

// Handle executes one already-decoded request and returns a concrete protocol
// response with the original requestId.
func (service *Service) Handle(request protocol.Request) any {
	switch request.Type {
	case protocol.RequestCreateTransfer:
		return service.createTransfer(request)
	case protocol.RequestCancelTransfer:
		return service.cancelTransfer(request)
	default:
		return protocol.Error(request.RequestID, "UNKNOWN_REQUEST", "unsupported request type")
	}
}

func (service *Service) RetainedCount() int {
	return service.store.RetainedCount()
}

func (service *Service) createTransfer(request protocol.Request) any {
	if request.Create == nil {
		return protocol.Error(request.RequestID, "INVALID_REQUEST", "CREATE_TRANSFER payload is required")
	}
	validated, err := service.validate(request.Create.FilePath)
	if err != nil {
		return protocol.Error(request.RequestID, "INVALID_EPUB", "EPUB file is invalid or unavailable")
	}
	if service.startupError != nil || service.url == nil {
		if errors.Is(service.startupError, lan.ErrNoLANAddress) {
			return protocol.Error(request.RequestID, "NO_LAN_ADDRESS", "no usable private LAN address was found")
		}
		return protocol.Error(request.RequestID, "HTTP_SERVER_UNAVAILABLE", "local download server is unavailable")
	}

	session, token, err := service.store.Create(transfer.CreateInput{
		FilePath: validated.Path,
		Filename: validated.Filename,
		Size:     validated.Size,
	})
	if err != nil {
		return protocol.Error(request.RequestID, "INTERNAL_ERROR", "could not create transfer")
	}
	return protocol.TransferCreatedResponse{
		Type:      "TRANSFER_CREATED",
		RequestID: request.RequestID,
		Payload: protocol.TransferCreatedPayload{
			TransferID: session.TransferID,
			URL:        service.url(token),
			Filename:   session.Filename,
			Size:       session.Size,
			ExpiresAt:  session.ExpiresAt.UnixMilli(),
		},
	}
}

func (service *Service) cancelTransfer(request protocol.Request) any {
	if request.Cancel == nil {
		return protocol.Error(request.RequestID, "INVALID_REQUEST", "CANCEL_TRANSFER payload is required")
	}
	session, err := service.store.Cancel(request.Cancel.TransferID)
	if err != nil {
		switch {
		case errors.Is(err, transfer.ErrSessionNotFound):
			return protocol.Error(request.RequestID, "TRANSFER_NOT_FOUND", "transfer was not found")
		case errors.Is(err, transfer.ErrSessionNotActive):
			return protocol.Error(request.RequestID, "TRANSFER_NOT_ACTIVE", "transfer is no longer active")
		default:
			return protocol.Error(request.RequestID, "INTERNAL_ERROR", "could not cancel transfer")
		}
	}
	return protocol.TransferCancelledResponse{
		Type:      "TRANSFER_CANCELLED",
		RequestID: request.RequestID,
		Payload:   protocol.TransferCancelledPayload{TransferID: session.TransferID},
	}
}
