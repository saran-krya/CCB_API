import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';
import { Action } from './entities/action.entity';
import { Screen } from '../screens/entities/screen.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Action,
      Screen,]),
  ],
  controllers: [ActionsController],
  providers: [ActionsService],
  exports: [ActionsService],
})
export class ActionsModule { }