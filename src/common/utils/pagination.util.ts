/**
 * Pagination clamping.
 *
 * The newer modules already do this inline — NotificationsService has its own
 * MAX_PER_PAGE, AdminController does Math.min(Math.max(...), 100) at two call sites,
 * ConsultationsService does it in the two methods written most recently. The older
 * endpoints never got it: CoreSearchFilterDatePaginationDto validates perPage as
 * @IsString() and nothing else, so `.limit(+perPage || 10)` will happily accept
 * `?perPage=1000000` and read the collection.
 *
 * That is not a theoretical DoS — it is one request killing a 512 MB container.
 * Reads on the older endpoints return hydrated Mongoose documents with up to three
 * populated sub-documents, measured at ~12.3 KB per row, so 5,000 rows is ~60 MB
 * held live before Express serialises a second copy of it into the response.
 *
 * Clamping rather than rejecting is deliberate: these endpoints are already live and
 * a client that has been sending perPage=500 should degrade to 100 rows, not start
 * getting 400s mid-incident. Callers that want the stricter contract (tell the client
 * it asked for too much) should validate in the DTO — see ListNotificationsDto, which
 * does exactly that and then relies on this as the backstop.
 */

/** Ceiling shared by every paginated endpoint. Matches the value the newer modules picked. */
export const MAX_PER_PAGE = 100;

/**
 * Coerce an untrusted page-size to an integer in [1, max].
 * Anything unparseable (undefined, '', 'abc', NaN, Infinity) falls back to `fallback`.
 */
export function clampPerPage(
    value: unknown,
    fallback = 10,
    max: number = MAX_PER_PAGE,
): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed < 1) {
        return Math.min(fallback, max);
    }
    return Math.min(parsed, max);
}

/**
 * Coerce an untrusted page number to an integer >= 1.
 *
 * Deliberately not capped: a large page number costs a skip, not a large result set,
 * and capping it would silently return the wrong page. It only has to be sane enough
 * that `(page - 1) * perPage` cannot go negative or NaN.
 */
export function clampPage(value: unknown): number {
    const parsed = Math.floor(Number(value));
    if (!Number.isFinite(parsed) || parsed < 1) {
        return 1;
    }
    return parsed;
}
