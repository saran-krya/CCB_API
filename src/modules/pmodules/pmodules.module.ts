import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PModule } from './entities/pmodule.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';
import { Screen } from '../screens/entities/screen.entity';
import { Action } from '../actions/entities/action.entity';
import { PModulesService } from './pmodules.service';
import { PModulesController } from './pmodules.controller';

// SubModule, Screen and Action are registered only so GET /pmodules/catalog can assemble the whole catalog (and a module's
// delete can check for children) — their own modules still own their CRUD.
@Module({
  imports: [TypeOrmModule.forFeature([PModule, SubModule, Screen, Action])],
  controllers: [PModulesController],
  providers: [PModulesService],
  exports: [PModulesService],
})
export class PModulesModule {}
