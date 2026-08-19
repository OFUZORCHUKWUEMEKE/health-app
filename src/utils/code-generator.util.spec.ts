import {
    MRN_ALPHABET,
    MRN_BODY_LENGTH,
    MRN_PREFIX,
    MRN_REGEX,
    generateMrnCandidate,
} from './code-generator.util';

describe('generateMrnCandidate', () => {
    it('always produces the C-XXXXXX format', () => {
        for (let i = 0; i < 1000; i++) {
            expect(generateMrnCandidate()).toMatch(MRN_REGEX);
        }
    });

    it('uses the declared prefix and body length', () => {
        const mrn = generateMrnCandidate();
        expect(mrn.startsWith(MRN_PREFIX)).toBe(true);
        expect(mrn).toHaveLength(MRN_PREFIX.length + MRN_BODY_LENGTH);
    });

    it('draws body characters only from the declared alphabet', () => {
        for (let i = 0; i < 200; i++) {
            for (const char of generateMrnCandidate().slice(MRN_PREFIX.length)) {
                expect(MRN_ALPHABET).toContain(char);
            }
        }
    });

    it('does not obviously repeat itself', () => {
        const seen = new Set(Array.from({ length: 500 }, () => generateMrnCandidate()));
        // 36^6 keyspace — 500 draws colliding more than a handful of times means
        // the generator is not actually random.
        expect(seen.size).toBeGreaterThan(495);
    });
});
