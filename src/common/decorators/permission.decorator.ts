import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'permission';
export const Permission = (...actionCodes: string[]) => SetMetadata(PERMISSION_KEY, actionCodes);
