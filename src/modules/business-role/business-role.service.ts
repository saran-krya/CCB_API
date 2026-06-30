import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import {
  CreateBusinessRoleDto,
  UpdateBusinessRoleDto,
} from "./dto/create-business-role.dto";

import { BusinessRole } from "./entities/business-role.entity";

@Injectable()
export class BusinessRoleService {
  constructor(
    @InjectRepository(
      BusinessRole,
    )
    private readonly businessRoles: Repository<BusinessRole>,
  ) {}

  create(
    dto: CreateBusinessRoleDto,
  ) {
    const businessRole =
      this.businessRoles.create({
        ...dto,
        active:
          dto.active ?? true,
      });

    return this.businessRoles.save(
      businessRole,
    );
  }

  findAll() {
    return this.businessRoles.find({
      order: {
        name: "ASC",
      },
    });
  }

  async findOne(id: number) {
    const businessRole =
      await this.businessRoles.findOne({
        where: { id },
      });

    if (!businessRole) {
      throw new NotFoundException(
        "Business role not found",
      );
    }

    return businessRole;
  }

  async update(
    id: number,
    dto: UpdateBusinessRoleDto,
  ) {
    const businessRole =
      await this.findOne(id);

    Object.assign(
      businessRole,
      dto,
    );

    return this.businessRoles.save(
      businessRole,
    );
  }

  async remove(id: number) {
    const businessRole =
      await this.findOne(id);

    await this.businessRoles.softRemove(
      businessRole,
    );
  }
}