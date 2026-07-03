import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttributeController } from './attribute.controller';
import { AttributeService } from './attribute.service';
import { Attribute } from './entities/attribute.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Attribute]), ConfigModule],
  controllers: [AttributeController],
  providers: [AttributeService],
  exports: [AttributeService],
})
export class AttributeModule {}
