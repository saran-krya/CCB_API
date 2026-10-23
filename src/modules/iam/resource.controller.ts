import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { ROLES } from '@app/common/constants/global';
import { IamService } from './iam.service';

/**
 * Read-mostly — Resources are a curated catalog (resource-catalog.ts), not a freely-authored CRUD
 * surface, mirroring how PModule/Screen work today. SUPER_ADMIN-only, same boundary as Policies.
 */
@ApiBearerAuth()
@ApiTags('IAM Resources')
@Roles(ROLES.SUPER_ADMIN)
@Controller({ path: 'iam/resources', version: '1' })
export class ResourceController {
  constructor(private readonly iam: IamService) {}

  @Get()
  findAll() {
    return this.iam.findAllResources();
  }

  // A distinct literal path, not a query param on GET /, so findAll's existing response shape
  // never changes for any existing caller.
  @Get('with-actions')
  findAllWithActions() {
    return this.iam.findAllResourcesWithActions();
  }
}
