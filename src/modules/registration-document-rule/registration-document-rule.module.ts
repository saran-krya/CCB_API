import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RegistrationDocumentRule } from './entities/registration-document-rule.entity';
import { RegistrationDocumentRuleController } from './registration-document-rule.controller';
import { RegistrationDocumentRuleService } from './registration-document-rule.service';

@Module({
  imports: [TypeOrmModule.forFeature([RegistrationDocumentRule])],
  controllers: [RegistrationDocumentRuleController],
  providers: [RegistrationDocumentRuleService],
  exports: [RegistrationDocumentRuleService],
})
export class RegistrationDocumentRuleModule {}
