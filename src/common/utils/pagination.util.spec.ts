import { clampPage, clampPerPage, MAX_PER_PAGE } from './pagination.util';

describe('clampPerPage', () => {
    it('caps a page size above the maximum', () => {
        // The reason this helper exists: ?perPage=1000000 against an endpoint that
        // returns hydrated documents is enough to OOM a small container.
        expect(clampPerPage('1000000')).toBe(MAX_PER_PAGE);
        expect(clampPerPage(101)).toBe(MAX_PER_PAGE);
    });

    it('passes through a page size inside the range', () => {
        expect(clampPerPage('20')).toBe(20);
        expect(clampPerPage(1)).toBe(1);
        expect(clampPerPage(MAX_PER_PAGE)).toBe(MAX_PER_PAGE);
    });

    it('falls back when the value is missing or unparseable', () => {
        expect(clampPerPage(undefined)).toBe(10);
        expect(clampPerPage(null)).toBe(10);
        expect(clampPerPage('')).toBe(10);
        expect(clampPerPage('abc')).toBe(10);
        expect(clampPerPage(NaN)).toBe(10);
        expect(clampPerPage(Infinity)).toBe(10);
    });

    it('falls back on zero and negative values rather than producing an empty page', () => {
        expect(clampPerPage(0)).toBe(10);
        expect(clampPerPage('-5')).toBe(10);
    });

    it('honours a caller-supplied fallback, itself capped by the maximum', () => {
        expect(clampPerPage(undefined, 20)).toBe(20);
        expect(clampPerPage(undefined, 5000)).toBe(MAX_PER_PAGE);
    });

    it('honours a caller-supplied maximum below the default', () => {
        expect(clampPerPage(50, 10, 25)).toBe(25);
    });

    it('truncates a fractional page size', () => {
        expect(clampPerPage('10.9')).toBe(10);
    });
});

describe('clampPage', () => {
    it('defaults to the first page for missing or unparseable values', () => {
        expect(clampPage(undefined)).toBe(1);
        expect(clampPage('abc')).toBe(1);
        expect(clampPage(Infinity)).toBe(1);
    });

    it('rejects zero and negatives, which would make skip() go negative', () => {
        expect(clampPage(0)).toBe(1);
        expect(clampPage(-3)).toBe(1);
    });

    it('passes a valid page through uncapped — a big skip is cheap, a wrong page is not', () => {
        expect(clampPage('7')).toBe(7);
        expect(clampPage(100000)).toBe(100000);
    });
});
