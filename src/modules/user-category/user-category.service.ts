import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

import {
  CreateUserCategoryDto,
  UpdateUserCategoryDto,
} from "./dto/create-user-category.dto";

import { UserCategory } from "./entities/user-category.entity";

@Injectable()
export class UserCategoryService {
  constructor(
    @InjectRepository(UserCategory)
    private readonly userCategories: Repository<UserCategory>,
  ) {}

  create(
    dto: CreateUserCategoryDto,
  ) {
    const userCategory =
      this.userCategories.create({
        ...dto,
        active:
          dto.active ?? true,
      });

    return this.userCategories.save(
      userCategory,
    );
  }

async findAll() {
  return this.userCategories.find({
    select: {
      id: true,
      name: true,
    },
    order: {
      name: 'ASC',
    },
  });
}
  async findOne(id: number) {
    const userCategory =
      await this.userCategories.findOne({
        where: { id },
      });

    if (!userCategory) {
      throw new NotFoundException(
        "User category not found",
      );
    }

    return userCategory;
  }

  async update(
    id: number,
    dto: UpdateUserCategoryDto,
  ) {
    const userCategory =
      await this.findOne(id);

    Object.assign(
      userCategory,
      dto,
    );

    return this.userCategories.save(
      userCategory,
    );
  }

  async remove(id: number) {
    const userCategory =
      await this.findOne(id);

    await this.userCategories.softRemove(
      userCategory,
    );
  }
}