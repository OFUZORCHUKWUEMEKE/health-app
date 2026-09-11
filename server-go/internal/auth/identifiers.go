package auth

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"strings"
	"time"
)

// RegistrationNo mints PAT-<base36 time>-<4 upper alphanumerics>, mirroring
// auth.service.ts. Callers retry on unique violation (Nest did not, but a
// 500 on collision is never acceptable).
func RegistrationNo() (string, error) {
	return identifierNo("PAT-")
}

// DoctorNo mints DOC-<base36 time>-<4 upper alphanumerics>.
func DoctorNo() (string, error) {
	return identifierNo("DOC-")
}

func identifierNo(prefix string) (string, error) {
	suffix, err := randomUpper(4)
	if err != nil {
		return "", err
	}
	millis := fmt.Sprintf("%X", time.Now().UnixMilli())
	return prefix + millis + "-" + suffix, nil
}

var upperAlphabet = []rune("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")

func randomUpper(n int) (string, error) {
	var sb strings.Builder
	for i := 0; i < n; i++ {
		k, err := rand.Int(rand.Reader, big.NewInt(int64(len(upperAlphabet))))
		if err != nil {
			return "", err
		}
		sb.WriteRune(upperAlphabet[k.Int64()])
	}
	return sb.String(), nil
}

// GenerateOTP returns a 6-digit numeric string via crypto/rand.
func GenerateOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()+100000), nil
}
