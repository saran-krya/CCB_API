import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/decorators/permission.decorator';
import { SftpFileListService } from './sftp-file-list.service';
import { SftpFileQueryDto } from './dto/sftp-file-query.dto';
import {
  SftpFileFilterMetadataDto,
  SftpFileListResponseDto,
} from './dto/sftp-file-list-response.dto';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';


@ApiBearerAuth()
@ApiTags('SFTP Files')
@Controller({ path: 'sftp/files', version: '1' })
export class SftpFileListController {
  constructor(private readonly fileList: SftpFileListService) {}


  @Get('metaFilters')
  @Permission(ACTION_CODES.SFTP_MONITOR_VIEW)
  @ApiOperation({ summary: 'Filter metadata for the Files List UI (communities, statuses)' })
  async getFilterMetadata(): Promise<SftpFileFilterMetadataDto> {
    return this.fileList.getFilterMetadata();
  }

  @Get()
  @Permission(ACTION_CODES.SFTP_MONITOR_VIEW)
  @ApiOperation({ summary: 'Paginated, sortable, filterable list of every SftpIngestionLog row (all file_status values)' })
  async findAll(@Query() query: SftpFileQueryDto): Promise<SftpFileListResponseDto> {
    return this.fileList.findAll(query);
  }
}
