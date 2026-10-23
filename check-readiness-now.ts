import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { BillingReadinessService } from './src/modules/billing-readiness/billing-readiness.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const service = app.get(BillingReadinessService);

  console.log('=== LIVE: getReadiness({ propertyId: 41 }) right now ===');
  const [readiness] = await service.getReadiness({ propertyId: 41 } as any);
  console.log(JSON.stringify(readiness, null, 2));

  await app.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
