export {};

declare global {
  interface StorageManager {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  }
}