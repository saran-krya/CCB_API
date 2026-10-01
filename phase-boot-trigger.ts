import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  console.log('Bootstrap completed successfully.');
  await app.close();
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
