import { BadRequestException } from '@nestjs/common';
import { DateTime, IANAZone } from 'luxon';

export function isValidIanaTimezone(zone: string): boolean {
    return typeof zone === 'string' && IANAZone.isValidZone(zone);
}

export function assertValidTimezone(zone: string): void {
    if (!isValidIanaTimezone(zone)) {
        throw new BadRequestException(`Invalid IANA timezone: ${zone}`);
    }
}

/**
 * Convert a local wall-clock datetime (e.g. "2026-04-16T10:00:00") plus IANA
 * zone to a UTC Date. Throws BadRequestException on invalid input.
 */
export function localToUtc(localIso: string, zone: string): Date {
    assertValidTimezone(zone);
    const dt = DateTime.fromISO(localIso, { zone, setZone: true });
    if (!dt.isValid) {
        throw new BadRequestException(
            `Invalid local datetime "${localIso}" for zone "${zone}": ${dt.invalidReason}`,
        );
    }
    return dt.toUTC().toJSDate();
}

/**
 * Given a UTC Date and a zone, returns the local day-of-week (0=Sun..6=Sat)
 * and minute-of-day (0..1439) as observed in that zone.
 */
export function zonedClock(
    date: Date,
    zone: string,
): { dayOfWeek: number; minuteOfDay: number; isoDate: string } {
    assertValidTimezone(zone);
    const dt = DateTime.fromJSDate(date, { zone });
    return {
        // luxon weekday: 1 (Monday) ... 7 (Sunday). Normalise to 0 (Sun) ... 6 (Sat).
        dayOfWeek: dt.weekday % 7,
        minuteOfDay: dt.hour * 60 + dt.minute,
        isoDate: dt.toISODate() ?? '',
    };
}

/** UTC Date corresponding to the start of the given local calendar day in `zone`. */
export function startOfZonedDayUtc(dateStr: string, zone: string): Date {
    assertValidTimezone(zone);
    const dt = DateTime.fromISO(dateStr, { zone }).startOf('day');
    if (!dt.isValid) {
        throw new BadRequestException(`Invalid date "${dateStr}" for zone "${zone}"`);
    }
    return dt.toUTC().toJSDate();
}

/** UTC Date corresponding to the exclusive end (next-day 00:00 local) of the given local day in `zone`. */
export function endOfZonedDayUtc(dateStr: string, zone: string): Date {
    assertValidTimezone(zone);
    const dt = DateTime.fromISO(dateStr, { zone }).startOf('day').plus({ days: 1 });
    return dt.toUTC().toJSDate();
}

/** Compose a UTC Date from (local calendar date + "HH:mm") in a given zone. Handles DST. */
export function zonedDateAndTimeToUtc(dateStr: string, hhmm: string, zone: string): Date {
    assertValidTimezone(zone);
    const [hour, minute] = hhmm.split(':').map(Number);
    const dt = DateTime.fromISO(dateStr, { zone }).set({
        hour,
        minute,
        second: 0,
        millisecond: 0,
    });
    if (!dt.isValid) {
        throw new BadRequestException(
            `Invalid local time "${dateStr} ${hhmm}" in zone "${zone}"`,
        );
    }
    return dt.toUTC().toJSDate();
}

/** Return "YYYY-MM-DD" for the local calendar date of the given UTC date in `zone`. */
export function zonedIsoDate(date: Date, zone: string): string {
    assertValidTimezone(zone);
    return DateTime.fromJSDate(date, { zone }).toISODate() ?? '';
}

/** Convert a UTC instant to a local ISO string (without offset suffix) in the given zone. */
export function utcToLocalIso(date: Date, zone: string): string {
    assertValidTimezone(zone);
    return (
        DateTime.fromJSDate(date, { zone }).toISO({
            includeOffset: false,
            suppressMilliseconds: true,
        }) ?? ''
    );
}
