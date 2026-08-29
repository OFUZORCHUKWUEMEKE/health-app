import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getHealth() {
    // process.memoryUsage() is cheap (a syscall, no allocation of note) and this
    // endpoint is polled by the platform's own health check rather than app traffic,
    // so reporting it here is the "controlled, not noisy" way to watch memory over
    // time in production — curl this repeatedly rather than adding per-request logging
    // anywhere else in the app.
    const mem = process.memoryUsage();
    const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

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
    };
  }
}
