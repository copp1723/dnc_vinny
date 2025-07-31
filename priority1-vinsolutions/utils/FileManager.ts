import fs from 'fs-extra';
import path from 'path';

export class FileManager {
  async ensureDirectory(dirPath: string): Promise<void> {
    await fs.ensureDir(dirPath);
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async readFile(filePath: string): Promise<string> {
    return fs.readFile(filePath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async moveFile(sourcePath: string, destPath: string): Promise<void> {
    await fs.move(sourcePath, destPath, { overwrite: true });
  }

  async deleteFile(filePath: string): Promise<void> {
    await fs.unlink(filePath);
  }

  getAbsolutePath(relativePath: string): string {
    return path.resolve(relativePath);
  }
}