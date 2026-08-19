import { randomInt } from 'crypto';

export const GenerateRef = function (num: number, type: string): string {
    // let unique_code = GenerateRandomString(num)
    let unique_code = num.toString();
    let zero_count = 0;
    if (unique_code.length < 7) {
        zero_count = 7 - unique_code.length;
        unique_code = '0'.repeat(zero_count) + unique_code;
    }

    return type + 'B' + unique_code;
};

export const GenerateRandomString = function (length: number): string {
    let result = '';
    const characters =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
};


// ─── MRN ────────────────────────────────────────────────
// Shared Medical Record Number namespace for both patients (users) and doctors.
// Format: 'C-' + 6 uppercase alphanumeric characters, e.g. C-3622ET.
//
// NOTE: these constants are mirrored in scripts/lib/mrn.js for the plain-Node
// seed/backfill scripts, which cannot import TypeScript. Keep the two in sync.
export const MRN_PREFIX = 'C-';
export const MRN_BODY_LENGTH = 6;
export const MRN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const MRN_REGEX = /^C-[A-Z0-9]{6}$/;

/**
 * Produces a candidate MRN. Does NOT reserve it — use MrnService.generateUniqueMrn() for
 * anything that persists, so the value is claimed in the shared registry first.
 */
export function generateMrnCandidate(): string {
    let body = '';
    for (let i = 0; i < MRN_BODY_LENGTH; i++) {
        body += MRN_ALPHABET.charAt(randomInt(MRN_ALPHABET.length));
    }
    return MRN_PREFIX + body;
}

export function generateSessionCode(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let result = '';

    // Add 3 random uppercase letters
    for (let i = 0; i < 3; i++) {
        result += letters.charAt(Math.floor(Math.random() * letters.length));
    }

    // Add 3 random digits
    for (let i = 0; i < 3; i++) {
        result += Math.floor(Math.random() * 10).toString();
    }

    return result;
}
