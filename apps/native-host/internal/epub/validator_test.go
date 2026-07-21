package epub

import (
	"archive/zip"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestValidateAcceptsEPUBArchive(t *testing.T) {
	t.Parallel()

	filePath := filepath.Join(t.TempDir(), "示例.EPUB")
	writeArchive(t, filePath, []archiveEntry{
		{name: "mimetype", content: "application/epub+zip"},
		{name: ContainerPath, content: "<container/>"},
		{name: "OEBPS/content.opf", content: "book content is not opened by validation"},
	})

	got, err := Validate(filePath)
	if err != nil {
		t.Fatalf("Validate() error = %v", err)
	}
	if got.Path != filePath {
		t.Fatalf("Path = %q, want %q", got.Path, filePath)
	}
	if got.Filename != "示例.EPUB" {
		t.Fatalf("Filename = %q, want 示例.EPUB", got.Filename)
	}
	if got.Size <= 0 {
		t.Fatalf("Size = %d, want a positive size", got.Size)
	}
}

func TestValidateRejectsInvalidFilesystemInputs(t *testing.T) {
	t.Parallel()

	temporaryDirectory := t.TempDir()
	emptyFile := filepath.Join(temporaryDirectory, "empty.epub")
	if err := os.WriteFile(emptyFile, nil, 0o600); err != nil {
		t.Fatalf("create empty file: %v", err)
	}
	wrongExtension := filepath.Join(temporaryDirectory, "book.zip")
	writeArchive(t, wrongExtension, []archiveEntry{{name: ContainerPath, content: "<container/>"}})
	directory := filepath.Join(temporaryDirectory, "directory.epub")
	if err := os.Mkdir(directory, 0o700); err != nil {
		t.Fatalf("create directory: %v", err)
	}

	tests := []struct {
		name     string
		filePath string
		want     error
	}{
		{name: "relative path", filePath: "book.epub", want: ErrPathNotAbsolute},
		{name: "missing file", filePath: filepath.Join(temporaryDirectory, "missing.epub"), want: ErrFileUnavailable},
		{name: "directory", filePath: directory, want: ErrNotRegularFile},
		{name: "wrong extension", filePath: wrongExtension, want: ErrWrongExtension},
		{name: "empty file", filePath: emptyFile, want: ErrEmptyFile},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			_, err := Validate(test.filePath)
			if !errors.Is(err, test.want) {
				t.Fatalf("Validate() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestValidateRejectsSymbolicLink(t *testing.T) {
	t.Parallel()

	temporaryDirectory := t.TempDir()
	target := filepath.Join(temporaryDirectory, "target.epub")
	writeArchive(t, target, []archiveEntry{{name: ContainerPath, content: "<container/>"}})
	link := filepath.Join(temporaryDirectory, "link.epub")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symbolic links are unavailable in this environment: %v", err)
	}

	_, err := Validate(link)
	if !errors.Is(err, ErrNotRegularFile) {
		t.Fatalf("Validate() error = %v, want ErrNotRegularFile", err)
	}
}

func TestValidateRejectsInvalidZIP(t *testing.T) {
	t.Parallel()

	filePath := filepath.Join(t.TempDir(), "invalid.epub")
	if err := os.WriteFile(filePath, []byte("not a ZIP archive"), 0o600); err != nil {
		t.Fatalf("create invalid EPUB: %v", err)
	}

	_, err := Validate(filePath)
	if !errors.Is(err, ErrInvalidArchive) {
		t.Fatalf("Validate() error = %v, want ErrInvalidArchive", err)
	}
}

func TestValidateRejectsMissingContainer(t *testing.T) {
	t.Parallel()

	filePath := filepath.Join(t.TempDir(), "missing-container.epub")
	writeArchive(t, filePath, []archiveEntry{{name: "OEBPS/content.opf", content: "<package/>"}})

	_, err := Validate(filePath)
	if !errors.Is(err, ErrMissingContainer) {
		t.Fatalf("Validate() error = %v, want ErrMissingContainer", err)
	}
}

func TestValidateRejectsUnsafeArchivePaths(t *testing.T) {
	t.Parallel()

	unsafePaths := []string{"../escape", "/absolute", `META-INF\container.xml`, "C:/windows/path"}
	for _, unsafePath := range unsafePaths {
		unsafePath := unsafePath
		t.Run(unsafePath, func(t *testing.T) {
			t.Parallel()
			filePath := filepath.Join(t.TempDir(), "unsafe.epub")
			writeArchive(t, filePath, []archiveEntry{
				{name: ContainerPath, content: "<container/>"},
				{name: unsafePath, content: "unsafe"},
			})

			_, err := Validate(filePath)
			if !errors.Is(err, ErrUnsafeArchive) {
				t.Fatalf("Validate() error = %v, want ErrUnsafeArchive", err)
			}
		})
	}
}

func TestValidateRejectsArchiveSymlinkEntry(t *testing.T) {
	t.Parallel()

	filePath := filepath.Join(t.TempDir(), "symlink-entry.epub")
	writeArchive(t, filePath, []archiveEntry{
		{name: ContainerPath, content: "<container/>"},
		{name: "OEBPS/link", content: "target", mode: os.ModeSymlink | 0o777},
	})

	_, err := Validate(filePath)
	if !errors.Is(err, ErrUnsafeArchive) {
		t.Fatalf("Validate() error = %v, want ErrUnsafeArchive", err)
	}
}

func TestValidateEnforcesArchiveLimits(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		entries []archiveEntry
		limits  Limits
	}{
		{
			name: "entry count",
			entries: []archiveEntry{
				{name: ContainerPath, content: "<container/>"},
				{name: "second", content: "entry"},
			},
			limits: Limits{MaxEntries: 1},
		},
		{
			name:    "directory metadata size",
			entries: []archiveEntry{{name: ContainerPath, content: "<container/>"}},
			limits:  Limits{MaxDirectoryMetadataSize: 4},
		},
		{
			name:    "container size",
			entries: []archiveEntry{{name: ContainerPath, content: "<container/>"}},
			limits:  Limits{MaxContainerSize: 4},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			filePath := filepath.Join(t.TempDir(), "limited.epub")
			writeArchive(t, filePath, test.entries)

			_, err := ValidateWithLimits(filePath, test.limits)
			if !errors.Is(err, ErrArchiveLimit) {
				t.Fatalf("ValidateWithLimits() error = %v, want ErrArchiveLimit", err)
			}
		})
	}
}

type archiveEntry struct {
	name    string
	content string
	mode    os.FileMode
}

func writeArchive(t *testing.T, filePath string, entries []archiveEntry) {
	t.Helper()

	file, err := os.Create(filePath)
	if err != nil {
		t.Fatalf("create archive: %v", err)
	}

	archive := zip.NewWriter(file)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Store}
		if entry.mode != 0 {
			header.SetMode(entry.mode)
		}
		writer, createErr := archive.CreateHeader(header)
		if createErr != nil {
			t.Fatalf("create archive entry %q: %v", entry.name, createErr)
		}
		if _, writeErr := writer.Write([]byte(entry.content)); writeErr != nil {
			t.Fatalf("write archive entry %q: %v", entry.name, writeErr)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("close archive: %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("close EPUB file: %v", err)
	}
}
