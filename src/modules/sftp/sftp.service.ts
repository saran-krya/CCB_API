import { BadRequestException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'fs';
import { mkdir, stat } from 'fs/promises';
import { extname, join } from 'path';
import SftpClient = require('ssh2-sftp-client');
import csvParser = require('csv-parser');

const LOCAL_DOWNLOAD_DIR = join(process.cwd(), 'storage', 'sftp', 'temp');

@Injectable()
export class SftpService {
  private readonly logger = new Logger(SftpService.name);

  constructor(private readonly config: ConfigService) {}

  private createClient(): SftpClient {
    return new SftpClient();
  }

  async connect(): Promise<SftpClient> {
    const client = this.createClient();
    const host = this.config.getOrThrow<string>('SFTP_HOST');
    const port = Number(this.config.get<string>('SFTP_PORT', '22'));
    const username = this.config.getOrThrow<string>('SFTP_USERNAME');
    const password = this.config.getOrThrow<string>('SFTP_PASSWORD');

    try {
      await client.connect({ host, port, username, password });
      this.logger.log(`Connected to SFTP server ${host}:${port} as ${username}`);
      return client;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`SFTP connection to ${host}:${port} failed: ${message}`);
      throw new InternalServerErrorException('Failed to connect to the SFTP server');
    }
  }

  async disconnect(client: SftpClient): Promise<void> {
    try {
      await client.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(`SFTP disconnect encountered an issue: ${message}`);
    }
  }

  async listFiles(): Promise<SftpClient.FileInfo[]> {
    const remotePath = this.config.getOrThrow<string>('SFTP_REMOTE_PATH');
    const client = await this.connect();
    try {
      const files = await client.list(remotePath);
      this.logger.log(`Listed ${files.length} entr${files.length === 1 ? 'y' : 'ies'} from ${remotePath}`);
      return files;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to list files at ${remotePath}: ${message}`);
      throw new InternalServerErrorException('Failed to list files on the SFTP server');
    } finally {
      await this.disconnect(client);
    }
  }

  async downloadFile(fileName: string): Promise<{ fileName: string; localPath: string; size: number }> {
    const remotePath = this.config.getOrThrow<string>('SFTP_REMOTE_PATH');
    const remoteFilePath = `${remotePath.replace(/\/+$/, '')}/${fileName}`;
    const localPath = join(LOCAL_DOWNLOAD_DIR, fileName);

    const client = await this.connect();
    try {
      const files = await client.list(remotePath);
      const remoteFile = files.find((f) => f.name === fileName);
      if (!remoteFile) {
        this.logger.warn(`Requested file "${fileName}" not found in ${remotePath}`);
        throw new NotFoundException(`File "${fileName}" was not found on the SFTP server`);
      }

      await mkdir(LOCAL_DOWNLOAD_DIR, { recursive: true });
      await client.fastGet(remoteFilePath, localPath);

      const { size } = await stat(localPath);
      this.logger.log(`Downloaded ${fileName} (${size} bytes) to ${localPath}`);
      return { fileName, localPath, size };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to download "${fileName}" from ${remotePath}: ${message}`);
      throw new InternalServerErrorException('Failed to download the file from the SFTP server');
    } finally {
      await this.disconnect(client);
    }
  }

  async parseCsv(localFilePath: string): Promise<{ fileName: string; rowCount: number; rows: Record<string, string>[] }> {
    const fileName = localFilePath.split(/[/\\]/).pop() ?? localFilePath;

    if (extname(localFilePath).toLowerCase() !== '.csv') {
      throw new BadRequestException(`"${fileName}" is not a .csv file`);
    }

    try {
      await stat(localFilePath);
    } catch {
      throw new NotFoundException(`File "${fileName}" was not found at ${localFilePath}`);
    }

    try {
      const rows = await new Promise<Record<string, string>[]>((resolve, reject) => {
        const collected: Record<string, string>[] = [];
        createReadStream(localFilePath)
          .on('error', (err) => reject(err))
          .pipe(csvParser())
          .on('data', (row: Record<string, string>) => collected.push(row))
          .on('end', () => resolve(collected))
          .on('error', (err: Error) => reject(err));
      });
      this.logger.log(`Parsed ${rows.length} row${rows.length === 1 ? '' : 's'} from ${fileName}`);
      return { fileName, rowCount: rows.length, rows };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to parse CSV "${fileName}": ${message}`);
      throw new InternalServerErrorException('Failed to parse the CSV file');
    }
  }
}
