import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AttributeModule } from '../attribute/attribute.module';
import { OcrController } from './ocr.controller';
import { OcrService } from './ocr.service';

@Module({
  imports: [ConfigModule, AttributeModule],
  controllers: [OcrController],
  providers: [OcrService],
  exports: [OcrService],
})
export class OcrModule {}
