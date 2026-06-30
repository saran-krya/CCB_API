import { SelectQueryBuilder } from 'typeorm';
import { ObjectLiteral } from 'typeorm';
import { BasePaginationDto } from '../dto/base-pagination.dto';
import { PaginatedResult } from '../interfaces/paginated-result.interface';

export async function paginate<T extends ObjectLiteral>(
  query: SelectQueryBuilder<T>,
  pagination: BasePaginationDto,
): Promise<PaginatedResult<T>> {
  const page = pagination.page;
  const limit = pagination.limit;

  const [items, total] = await query
    .skip((page - 1) * limit)
    .take(limit)
    .getManyAndCount();

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}