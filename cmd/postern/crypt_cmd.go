package main

import (
	"errors"
	"fmt"
	"os"
)

// The decrypt and rekey commands rewrite the data file in place. Stop the
// server first: it would otherwise overwrite the result with its own copy.

func readDataFile(path string) ([]byte, error) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("data file not found: %s", path)
	}
	return b, err
}

// decryptFile rewrites an encrypted data file as plain JSON.
func decryptFile(path string, codec *fileCodec) error {
	if codec == nil {
		return errors.New("set POSTERN_KEY or POSTERN_KEY_FILE to the current key")
	}
	b, err := readDataFile(path)
	if err != nil {
		return err
	}
	plain, encrypted, err := codec.Decode(b)
	if err != nil {
		return err
	}
	if !encrypted {
		return errors.New("the data file is not encrypted")
	}
	// Never write out something the server could not read back.
	if _, _, _, err := decodeStore(plain); err != nil {
		return fmt.Errorf("the decrypted contents are not valid: %w", err)
	}
	return writeFileAtomic(path, plain)
}

// rekeyFile re-encrypts the data file under a new key, with a new salt. The
// result is read back and checked before it replaces the old file.
func rekeyFile(path string, oldCodec, newCodec *fileCodec) error {
	if oldCodec == nil {
		return errors.New("set POSTERN_KEY or POSTERN_KEY_FILE to the current key")
	}
	if newCodec == nil {
		return errors.New("set POSTERN_NEW_KEY or POSTERN_NEW_KEY_FILE to the new key")
	}
	if oldCodec.pass == newCodec.pass {
		return errors.New("the new key is the same as the current key")
	}
	b, err := readDataFile(path)
	if err != nil {
		return err
	}
	plain, encrypted, err := oldCodec.Decode(b)
	if err != nil {
		return err
	}
	if !encrypted {
		return errors.New("the data file is not encrypted; start the server with a key to encrypt it")
	}
	out, err := newCodec.Encode(plain)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, out, 0o600); err != nil {
		return err
	}
	if err := verifySaved(tmp, newCodec, plain); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, path)
}

func decryptMain(path string) int {
	codec, err := codecFromEnv()
	if err == nil {
		err = decryptFile(path, codec)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "decrypt: %s\n", err)
		return 1
	}
	fmt.Printf("decrypted %s\nUnset POSTERN_KEY and POSTERN_KEY_FILE before starting the server, or it will encrypt the file again.\n", path)
	return 0
}

func rekeyMain(path string) int {
	oldCodec, err := codecFromEnv()
	if err != nil {
		fmt.Fprintf(os.Stderr, "rekey: %s\n", err)
		return 1
	}
	var newCodec *fileCodec
	pass, ok, err := keyFromEnv("POSTERN_NEW_KEY")
	if err != nil {
		fmt.Fprintf(os.Stderr, "rekey: %s\n", err)
		return 1
	}
	if ok {
		newCodec = newFileCodec(pass)
	}
	if err := rekeyFile(path, oldCodec, newCodec); err != nil {
		fmt.Fprintf(os.Stderr, "rekey: %s\n", err)
		return 1
	}
	fmt.Printf("re-encrypted %s\nStart the server with the new key in POSTERN_KEY or POSTERN_KEY_FILE.\n", path)
	return 0
}
