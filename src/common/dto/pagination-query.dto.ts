import { BasePaginationDto } from './base-pagination.dto';

// The search.fullName/search.email/search.mobile/search.role fields previously declared here were
// only ever read by UserService.findAll, which now has its own dedicated UserQueryDto (the Users
// list page moved to one combined search box instead of four independent filters) — removed as
// confirmed-dead (grepped: no other controller/service ever read any of the four).
export class PaginationQueryDto extends BasePaginationDto {}