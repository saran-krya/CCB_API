import { Global, Module } from '@nestjs/common';
import { OrganizationContextService } from './organization-context.service';

/**
 * `@Global()` so every feature module (Role, IAM, Community, ...) can inject
 * `OrganizationContextService` without each one separately declaring it as a provider — it's a thin,
 * stateless wrapper over the already-global `ClsService` (see AppModule's `ClsModule.forRoot`), so
 * there is no per-module state to keep separate anyway. `OrganizationContextGuard`/
 * `OrganizationStatusGuard` stay in AuthModule (they're part of the global guard chain, not something
 * other modules need to inject directly).
 */
@Global()
@Module({
  providers: [OrganizationContextService],
  exports: [OrganizationContextService],
})
export class OrganizationContextModule {}
