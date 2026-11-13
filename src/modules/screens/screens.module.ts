import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScreensController } from './screens.controller';
import { ScreensService } from './screens.service';
import { Screen } from './entities/screen.entity';
import { SubModule } from '../sub-modules/entities/sub-module.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';
import { Action } from '../actions/entities/action.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Screen, SubModule, PModule, Action]),
  ],
  controllers: [ScreensController],
  providers: [ScreensService],
  exports: [ScreensService],
})
export class ScreensModule {}