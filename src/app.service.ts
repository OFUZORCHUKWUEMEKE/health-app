import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as v8 from 'v8';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  /**
   * The container's memory ceiling, as the kernel sees it.
   *
   * Reported because the two ways this process can die look identical from the
   * outside but need opposite fixes:
   *
   *  - V8 hits heap_limit_mb  -> a loud "JavaScript heap out of memory" fatal error.
   *  - RSS hits container_limit_mb -> SIGKILL, exit 137, and nothing in the logs.
   *
   * If heap_limit_mb is close to container_limit_mb there is no room left for
   * everything that lives outside the heap (native buffers, sockets, the binary
   * itself), and the process will be killed before V8 ever feels pressure. Roughly
   * 60-70% is the headroom worth keeping.
   */
  private getContainerLimitMb(): number | null {
    // cgroup v2, then v1. Absent (or 'max') outside a container.
    for (const path of [
      '/sys/fs/cgroup/memory.max',
      '/sys/fs/cgroup/memory/memory.limit_in_bytes',
    ]) {
      try {
        const raw = fs.readFileSync(path, 'utf8').trim();
        if (raw === 'max') continue;
        const bytes = Number(raw);
        // v1 reports an enormous sentinel rather than 'max' when unlimited.
        if (!Number.isFinite(bytes) || bytes <= 0 || bytes >= os.totalmem() * 2) {
          continue;
        }
        return Math.round(bytes / 1024 / 1024);
      } catch {
        // Not readable here; try the next layout.
      }
    }
    return null;
  }

  getHealth() {
    // process.memoryUsage() is cheap (a syscall, no allocation of note) and this
    // endpoint is polled by the platform's own health check rather than app traffic,
    // so reporting it here is the "controlled, not noisy" way to watch memory over
    // time in production — curl this repeatedly rather than adding per-request logging
    // anywhere else in the app.
    const mem = process.memoryUsage();
    const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

    const heapLimitMb = mb(v8.getHeapStatistics().heap_size_limit);
    const containerLimitMb = this.getContainerLimitMb();

    return {
      status: 'ok',
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      memory_mb: {
        rss: mb(mem.rss),
        heapUsed: mb(mem.heapUsed),
        heapTotal: mb(mem.heapTotal),
        external: mb(mem.external),
        arrayBuffers: mb(mem.arrayBuffers),
      },
      limits_mb: {
        heap_limit: heapLimitMb,
        container_limit: containerLimitMb,
        // What fraction of the container the heap alone is allowed to claim. Above
        // ~0.75 there is not enough left for non-heap RSS and the platform will kill
        // the process before V8 reports anything.
        heap_share_of_container:
          containerLimitMb === null
            ? null
            : Math.round((heapLimitMb / containerLimitMb) * 100) / 100,
      },
    };
  }
}
