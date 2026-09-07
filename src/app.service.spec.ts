import { AppService } from './app.service';

describe('AppService.getHealth', () => {
    const service = new AppService();

    it('reports the live memory counters', () => {
        const health = service.getHealth();

        expect(health.status).toBe('ok');
        expect(health.memory_mb.rss).toBeGreaterThan(0);
        expect(health.memory_mb.heapUsed).toBeGreaterThan(0);
    });

    it('reports the V8 heap ceiling, so a heap OOM can be told from a SIGKILL', () => {
        const health = service.getHealth();

        expect(health.limits_mb.heap_limit).toBeGreaterThan(0);
    });

    it('reports no container limit when not running under a cgroup limit', () => {
        // Outside a container both cgroup paths are absent or report a sentinel,
        // and the share must be null rather than a division by a bogus number.
        const health = service.getHealth();

        if (health.limits_mb.container_limit === null) {
            expect(health.limits_mb.heap_share_of_container).toBeNull();
        } else {
            expect(health.limits_mb.container_limit).toBeGreaterThan(0);
            expect(health.limits_mb.heap_share_of_container).toBeGreaterThan(0);
        }
    });

    it('does not throw when the cgroup files are unreadable', () => {
        expect(() => service.getHealth()).not.toThrow();
    });
});
