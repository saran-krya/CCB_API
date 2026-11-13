import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttributeModule } from '../attribute/attribute.module';
import { Attribute } from '../attribute/entities/attribute.entity';
import { UserModule } from '../user/user.module';
import { EmailTemplateController } from './email-template.controller';
import { EmailTemplateService } from './email-template.service';
import { EmailTemplate } from './entities/email-template.entity';
import { EmailHtmlSanitizer } from './html-sanitizer';

/**
 * E-mail template management and rendering.
 *
 * Imported by AppModule (activated 2026-11-12 — docs/INVITATIONS_AND_EMAIL_TEMPLATES.md). `TypeOrmModule.forFeature([...])` below registers the
 * EmailTemplate entity; its table is created by migration 1795600000000 (src/migrations), and the built-in templates are written by
 * EmailTemplateService on start. The `sanitize-html` package is a dependency of the API (package.json).
 *
 * (`Attribute` is registered here only to read and create the one COMPANY_NAME row; the entity itself belongs to AttributeModule.)
 */
@Module({
  imports: [TypeOrmModule.forFeature([EmailTemplate, Attribute]), AttributeModule, UserModule],
  controllers: [EmailTemplateController],
  providers: [EmailTemplateService, EmailHtmlSanitizer],
  exports: [EmailTemplateService],
})
export class EmailTemplateModule {}
