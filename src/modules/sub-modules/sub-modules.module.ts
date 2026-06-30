import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubModulesController } from './sub-modules.controller';
import { SubModulesService } from './sub-modules.service';
import { SubModule } from './entities/sub-module.entity';
import { PModule } from '../pmodules/entities/pmodule.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubModule,
      PModule,
    ]),
  ],
  controllers: [SubModulesController],
  providers: [SubModulesService],
  exports: [SubModulesService],
})
export class SubModulesModule {}