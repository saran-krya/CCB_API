import { ApiProperty } from '@nestjs/swagger';
import { GlobalSearchResultItem } from '../interfaces/search-provider.interface';

export class GlobalSearchResultItemDto implements GlobalSearchResultItem {
  @ApiProperty() entityType!: string;
  @ApiProperty() id!: string;
  @ApiProperty() module!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ required: false }) description?: string;
  @ApiProperty({ required: false }) status?: string;
  @ApiProperty() url!: string;
}

export class GlobalSearchGroupDto {
  @ApiProperty() module!: string;
  @ApiProperty({ type: [GlobalSearchResultItemDto] }) items!: GlobalSearchResultItemDto[];
}

export class GlobalSearchResponseDataDto {
  @ApiProperty() query!: string;
  @ApiProperty({ type: [GlobalSearchGroupDto] }) groups!: GlobalSearchGroupDto[];
  @ApiProperty({ description: 'Sum of every group\'s item count.' }) totalCount!: number;
}
