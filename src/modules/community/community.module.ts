import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Property } from '../property/entities/property.entity';
import { CommunityController } from './community.controller';
import { CommunityService } from './community.service';
import { Community } from './entities/community.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Community, Property])],
  controllers: [CommunityController],
  providers: [CommunityService],
  exports: [CommunityService],
})
export class CommunityModule {}
