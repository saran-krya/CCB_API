import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SftpService } from './sftp.service';
import { SftpIngestionLog } from './entities/sftp-ingestion-log.entity';

export interface FileMovementResult {
  success: boolean;
  fileName: string;
  movedToFolder: string | null;
  error?: string;
}


@Injectable()
export class FileMovementService {
  private readonly logger = new Logger(FileMovementService.name);

  constructor(
    private readonly sftp: SftpService,
    private readonly config: ConfigService,
    @InjectRepository(SftpIngestionLog) private readonly ingestionLogs: Repository<SftpIngestionLog>,
  ) {}

  async moveProcessed(fileName: string, fileId: number): Promise<FileMovementResult> {
    return this.move(fileName, fileId, 'processed');
  }

  async moveFailed(fileName: string, fileId: number): Promise<FileMovementResult> {
    return this.move(fileName, fileId, 'failed');
  }

  async moveDuplicate(fileName: string, fileId: number): Promise<FileMovementResult> {
    return this.move(fileName, fileId, 'duplicate');
  }

  private async move(fileName: string, fileId: number, bucket: 'processed' | 'failed' | 'duplicate'): Promise<FileMovementResult> {
    const remotePath = this.config.getOrThrow<string>('SFTP_REMOTE_PATH');
    
    const baseDir = remotePath.replace(/\/+$/, '').replace(/\/[^/]+$/, '');

    const now = new Date();
    const datePath = [
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('/');
    const movedToFolder = `${bucket}/${datePath}`;
    const destDir = `${baseDir}/${movedToFolder}`;
    const sourcePath = `${remotePath.replace(/\/+$/, '')}/${fileName}`;
    const destPath = `${destDir}/${fileName}`;

    const client = await this.sftp.connect();
    try {
      await client.mkdir(destDir, true);
      await client.rename(sourcePath, destPath);

      const movedAt = new Date();
      await this.ingestionLogs.update(fileId, { movedToFolder, movedAt });

      this.logger.log(`Moved "${fileName}" to ${movedToFolder} (log #${fileId})`);
      return { success: true, fileName, movedToFolder };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to move "${fileName}" to ${bucket} (log #${fileId}): ${message}`);
      return { success: false, fileName, movedToFolder: null, error: message };
    } finally {
      await this.sftp.disconnect(client);
    }
  }
}
