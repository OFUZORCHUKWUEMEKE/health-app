import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { HttpExceptionFilter } from './common/filters/exceptions/http-exception.filter';
import { ModelExceptionFilter } from './common/filters/exceptions/model-exception.filter';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { requestContextMiddleware } from './common/middleware/request-context.middleware';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.use(requestContextMiddleware);

  // CORS — open to every origin by default.
  //
  // Set CORS_ORIGINS to a comma-separated allowlist to restrict access again;
  // leaving it empty (or setting it to `*`) allows any origin. Note that
  // `origin: true` reflects the caller's Origin header rather than sending
  // `*`, which is required because `credentials: true` forbids a wildcard.
  const corsOrigins = configService.get<string[]>('corsOrigins', []);
  const allowAllOrigins = corsOrigins.length === 0 || corsOrigins.includes('*');

  app.enableCors({
    origin: allowAllOrigins ? true : corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    // Omitting `allowedHeaders` makes the cors middleware echo back whatever
    // the browser asks for in Access-Control-Request-Headers, so clients are
    // free to send custom headers such as x-request-id.
    exposedHeaders: ['x-request-id'],
    maxAge: 86400,
  });

  logger.log(
    allowAllOrigins
      ? 'CORS: all origins allowed'
      : `CORS: restricted to ${corsOrigins.join(', ')}`,
  );

  // Global pipes & filters
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(), new ModelExceptionFilter());
  app.useGlobalInterceptors(
    new RequestLoggingInterceptor(),
    new ResponseEnvelopeInterceptor(),
  );

  // API prefix
  app.setGlobalPrefix('api/v1');

  const isProduction =
    configService.get<string>('NODE_ENV', process.env.NODE_ENV) ===
    'production';

  if (!isProduction) {
    const documentation = new DocumentBuilder()
      .setTitle('Health App API')
      .setDescription('Telemedicine backend API documentation')
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        'access-token',
      )
      .build();

    const document = SwaggerModule.createDocument(app, documentation);
    SwaggerModule.setup('docs', app, document);
  }

  // Port from config (not hardcoded)
  const port = configService.get<number>('port', 4000);
  await app.listen(port);
  logger.log(`Application running on port ${port}`);
  if (!isProduction) {
    logger.log(`Swagger docs at http://localhost:${port}/docs`);
  }
}

bootstrap();
