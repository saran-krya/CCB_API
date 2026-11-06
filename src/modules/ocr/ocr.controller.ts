import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission } from '../../common/decorators/permission.decorator';
import { OcrExtractDto } from './dto/ocr-extract.dto';
import { OcrService } from './ocr.service';
import { ACTION_CODES } from '../../common/constants/action-codes.constants';
import { BYTES_PER_MB } from '../../common/constants/file.constants';

const MAX_UPLOAD_BYTES = 15 * BYTES_PER_MB;

@ApiBearerAuth()
@ApiTags('OCR')
@Controller({ path: 'ocr', version: '1' })
export class OcrController {
  constructor(private readonly ocr: OcrService) {}

  @Post('extract')
  @Permission(ACTION_CODES.CREATE_REGISTRATION_REQUEST, ACTION_CODES.EDIT_REGISTRATION_REQUEST)
  @ApiOperation({ summary: 'Extract structured fields from an uploaded registration document via ConverseZen OCR' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async extract(@UploadedFile() file: Express.Multer.File, @Body() dto: OcrExtractDto) {
    if (!file) throw new BadRequestException('No document uploaded — send the file as a multipart file part.');
    return this.ocr.extract(dto.documentType, {
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
    });
  }
}
