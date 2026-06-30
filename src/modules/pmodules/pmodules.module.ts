import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PModule } from './entities/pmodule.entity';
import { PModulesService } from './pmodules.service';
import { PModulesController } from './pmodules.controller';

@Module({
  imports: [TypeOrmModule.forFeature([PModule])],
  controllers: [PModulesController],
  providers: [PModulesService],
  exports: [PModulesService],
})
export class PModulesModule {}