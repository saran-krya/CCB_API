import { ApiProperty } from '@nestjs/swagger';
import { ArrayUnique, IsInt, IsArray } from 'class-validator';

// The COMPLETE list of roleIds that should hold this workflow type's approve action(s) afterward —
// WorkflowService.setApprovers diffs this against who currently holds it and adds/removes only the
// difference. An empty array is valid (removes every current approver for this type).
export class SetApproversDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  @ArrayUnique()
  roleIds!: number[];
}
