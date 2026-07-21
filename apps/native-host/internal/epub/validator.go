// Package epub validates local EPUB files without extracting or reading book
// content. Validation is limited to filesystem properties and ZIP metadata.
package epub

import (
	"archive/zip"
	"errors"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const ContainerPath = "META-INF/container.xml"

var (
	ErrPathNotAbsolute  = errors.New("EPUB path is not absolute")
	ErrFileUnavailable  = errors.New("EPUB file is unavailable")
	ErrNotRegularFile   = errors.New("EPUB path is not a regular file")
	ErrWrongExtension   = errors.New("EPUB file does not have an .epub extension")
	ErrEmptyFile        = errors.New("EPUB file is empty")
	ErrInvalidArchive   = errors.New("EPUB file is not a valid ZIP archive")
	ErrMissingContainer = errors.New("EPUB archive is missing META-INF/container.xml")
	ErrUnsafeArchive    = errors.New("EPUB archive contains an unsafe entry")
	ErrArchiveLimit     = errors.New("EPUB archive exceeds a metadata safety limit")
)

// Limits bounds the ZIP metadata inspected during validation. Zero values use
// conservative defaults suitable for ordinary EPUB files.
type Limits struct {
	MaxEntries               int
	MaxDirectoryMetadataSize uint64
	MaxContainerSize         uint64
}

// File describes a validated EPUB without exposing any of its book content.
type File struct {
	Path     string
	Filename string
	Size     int64
}

var defaultLimits = Limits{
	MaxEntries:               10_000,
	MaxDirectoryMetadataSize: 8 << 20,
	MaxContainerSize:         1 << 20,
}

// Validate checks a local EPUB using the default metadata limits.
func Validate(filePath string) (File, error) {
	return ValidateWithLimits(filePath, Limits{})
}

// ValidateWithLimits checks a local EPUB without extracting archive entries.
func ValidateWithLimits(filePath string, limits Limits) (File, error) {
	if !filepath.IsAbs(filePath) {
		return File{}, ErrPathNotAbsolute
	}

	info, err := os.Lstat(filePath)
	if err != nil {
		return File{}, fmt.Errorf("%w: %v", ErrFileUnavailable, err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return File{}, ErrNotRegularFile
	}
	if !strings.EqualFold(filepath.Ext(info.Name()), ".epub") {
		return File{}, ErrWrongExtension
	}
	if info.Size() <= 0 {
		return File{}, ErrEmptyFile
	}

	archive, err := zip.OpenReader(filePath)
	if err != nil {
		return File{}, fmt.Errorf("%w: %v", ErrInvalidArchive, err)
	}
	defer archive.Close()

	limits = limits.withDefaults()
	if len(archive.File) > limits.MaxEntries {
		return File{}, fmt.Errorf("%w: got %d entries, maximum is %d", ErrArchiveLimit, len(archive.File), limits.MaxEntries)
	}

	var directoryMetadataSize uint64
	containerFound := false
	for _, entry := range archive.File {
		if !safeArchivePath(entry.Name) || entry.Mode()&os.ModeSymlink != 0 {
			return File{}, fmt.Errorf("%w: %q", ErrUnsafeArchive, entry.Name)
		}

		entryMetadataSize := uint64(len(entry.Name)) + uint64(len(entry.Comment)) + uint64(len(entry.Extra))
		if entryMetadataSize > limits.MaxDirectoryMetadataSize || directoryMetadataSize > limits.MaxDirectoryMetadataSize-entryMetadataSize {
			return File{}, ErrArchiveLimit
		}
		directoryMetadataSize += entryMetadataSize

		if entry.Name == ContainerPath && !entry.FileInfo().IsDir() {
			if entry.UncompressedSize64 > limits.MaxContainerSize {
				return File{}, fmt.Errorf("%w: container.xml is %d bytes, maximum is %d", ErrArchiveLimit, entry.UncompressedSize64, limits.MaxContainerSize)
			}
			containerFound = true
		}
	}

	if !containerFound {
		return File{}, ErrMissingContainer
	}

	return File{
		Path:     filePath,
		Filename: info.Name(),
		Size:     info.Size(),
	}, nil
}

func (limits Limits) withDefaults() Limits {
	if limits.MaxEntries <= 0 {
		limits.MaxEntries = defaultLimits.MaxEntries
	}
	if limits.MaxDirectoryMetadataSize == 0 {
		limits.MaxDirectoryMetadataSize = defaultLimits.MaxDirectoryMetadataSize
	}
	if limits.MaxContainerSize == 0 {
		limits.MaxContainerSize = defaultLimits.MaxContainerSize
	}
	return limits
}

func safeArchivePath(name string) bool {
	if name == "" || strings.ContainsRune(name, '\x00') || strings.Contains(name, "\\") || strings.HasPrefix(name, "/") {
		return false
	}

	cleaned := path.Clean(name)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return false
	}

	firstSegment, _, _ := strings.Cut(cleaned, "/")
	return !strings.Contains(firstSegment, ":")
}
