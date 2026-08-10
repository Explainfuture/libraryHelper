import { getFilename } from "./names";

const DATABASE_NAME = "bookbridge-file-access";
const DATABASE_VERSION = 1;
const DIRECTORY_STORE = "directories";
const PICKER_ID = "bookbridge-epub-directories";

export type DirectoryPermission = "denied" | "granted" | "prompt";

export interface AuthorizedDirectory {
  id: string;
  name: string;
  permission: DirectoryPermission;
}

export interface AutomaticFileLookup {
  checkedDirectories: number;
  blockedDirectories: number;
  match?: {
    directoryId: string;
    directoryName: string;
    file: File;
  };
}

interface StoredDirectory {
  id: string;
  addedAt: number;
  handle: FileSystemDirectoryHandle;
}

interface DirectoryPickerOptions {
  id: string;
  mode: "read";
}

type DirectoryPicker = (
  options?: DirectoryPickerOptions,
) => Promise<FileSystemDirectoryHandle>;

interface PermissionHandle {
  queryPermission?: (options: { mode: "read" }) => Promise<DirectoryPermission>;
  requestPermission?: (options: {
    mode: "read";
  }) => Promise<DirectoryPermission>;
}

export function supportsDirectoryAccess(): boolean {
  return typeof Reflect.get(window, "showDirectoryPicker") === "function";
}

export async function addAuthorizedDirectory(): Promise<AuthorizedDirectory> {
  const picker = Reflect.get(window, "showDirectoryPicker") as unknown;
  if (typeof picker !== "function") {
    throw new Error("当前浏览器不支持目录授权。");
  }
  const handle = await (picker as DirectoryPicker).call(window, {
    id: PICKER_ID,
    mode: "read",
  });
  const existing = await readStoredDirectories();
  const duplicate = await findSameDirectory(existing, handle);
  if (duplicate !== undefined) {
    const refreshed = { ...duplicate, handle };
    await writeStoredDirectory(refreshed);
    return toAuthorizedDirectory(refreshed);
  }

  const record: StoredDirectory = {
    id: crypto.randomUUID(),
    addedAt: Date.now(),
    handle,
  };
  await writeStoredDirectory(record);
  return toAuthorizedDirectory(record);
}

export async function listAuthorizedDirectories(): Promise<
  AuthorizedDirectory[]
> {
  const records = await readStoredDirectories();
  return Promise.all(records.map(toAuthorizedDirectory));
}

export async function removeAuthorizedDirectory(id: string): Promise<void> {
  if (id === "") {
    return;
  }
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DIRECTORY_STORE, "readwrite");
    transaction.objectStore(DIRECTORY_STORE).delete(id);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function requestAuthorizedDirectoryPermission(
  id: string,
): Promise<AuthorizedDirectory | null> {
  const record = await readStoredDirectory(id);
  if (record === undefined) {
    return null;
  }
  const permission = await requestReadPermission(record.handle);
  return {
    id: record.id,
    name: directoryName(record.handle),
    permission,
  };
}

export async function findDownloadedEpub(
  suggestedFilename: string,
  expectedBytes?: number,
): Promise<AutomaticFileLookup> {
  const filename = getFilename(suggestedFilename);
  if (filename === "") {
    return { checkedDirectories: 0, blockedDirectories: 0 };
  }

  const records = await readStoredDirectories();
  const permissions = await Promise.all(
    records.map(async (record) => ({
      record,
      permission: await queryReadPermission(record.handle),
    })),
  );
  const readable = permissions.filter(
    (entry) => entry.permission === "granted",
  );
  const candidates = await Promise.all(
    readable.map(async ({ record }) => {
      try {
        const handle = await record.handle.getFileHandle(filename);
        const file = await handle.getFile();
        if (
          expectedBytes !== undefined &&
          expectedBytes >= 0 &&
          file.size !== expectedBytes
        ) {
          return null;
        }
        return {
          directoryId: record.id,
          directoryName: directoryName(record.handle),
          file,
        };
      } catch (error: unknown) {
        if (isMissingFileError(error)) {
          return null;
        }
        throw error;
      }
    }),
  );
  const matches = candidates
    .filter((candidate) => candidate !== null)
    .toSorted(
      (left, right) => right.file.lastModified - left.file.lastModified,
    );

  return {
    checkedDirectories: readable.length,
    blockedDirectories: permissions.length - readable.length,
    ...(matches[0] === undefined ? {} : { match: matches[0] }),
  };
}

async function findSameDirectory(
  records: readonly StoredDirectory[],
  handle: FileSystemDirectoryHandle,
): Promise<StoredDirectory | undefined> {
  const comparisons = await Promise.all(
    records.map(async (record) => ({
      record,
      same: await record.handle.isSameEntry(handle).catch(() => false),
    })),
  );
  return comparisons.find((comparison) => comparison.same)?.record;
}

async function toAuthorizedDirectory(
  record: StoredDirectory,
): Promise<AuthorizedDirectory> {
  return {
    id: record.id,
    name: directoryName(record.handle),
    permission: await queryReadPermission(record.handle),
  };
}

function directoryName(handle: FileSystemDirectoryHandle): string {
  return handle.name || "已授权目录";
}

async function queryReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<DirectoryPermission> {
  const query = (handle as PermissionHandle).queryPermission;
  if (typeof query !== "function") {
    return "granted";
  }
  try {
    return await query.call(handle, { mode: "read" });
  } catch {
    return "denied";
  }
}

async function requestReadPermission(
  handle: FileSystemDirectoryHandle,
): Promise<DirectoryPermission> {
  const current = await queryReadPermission(handle);
  if (current === "granted") {
    return current;
  }
  const request = (handle as PermissionHandle).requestPermission;
  if (typeof request !== "function") {
    return current;
  }
  try {
    return await request.call(handle, { mode: "read" });
  } catch {
    return "denied";
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotFoundError" || error.name === "TypeMismatchError")
  );
}

async function readStoredDirectories(): Promise<StoredDirectory[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DIRECTORY_STORE, "readonly");
    const request = transaction
      .objectStore(DIRECTORY_STORE)
      .getAll() as IDBRequest<StoredDirectory[]>;
    const records = await waitForRequest<StoredDirectory[]>(request);
    await waitForTransaction(transaction);
    return records.toSorted((left, right) => left.addedAt - right.addedAt);
  } finally {
    database.close();
  }
}

async function readStoredDirectory(
  id: string,
): Promise<StoredDirectory | undefined> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DIRECTORY_STORE, "readonly");
    const request = transaction
      .objectStore(DIRECTORY_STORE)
      .get(id) as IDBRequest<StoredDirectory | undefined>;
    const record = await waitForRequest<StoredDirectory | undefined>(request);
    await waitForTransaction(transaction);
    return record;
  } finally {
    database.close();
  }
}

async function writeStoredDirectory(record: StoredDirectory): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(DIRECTORY_STORE, "readwrite");
    transaction.objectStore(DIRECTORY_STORE).put(record);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DIRECTORY_STORE)) {
        database.createObjectStore(DIRECTORY_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("无法打开目录授权数据库。"));
    };
    request.onblocked = () => {
      reject(new Error("目录授权数据库正在被其他窗口使用。"));
    };
  });
}

function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("目录授权数据库操作失败。"));
    };
  });
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("目录授权数据库事务失败。"));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("目录授权数据库事务已取消。"));
    };
  });
}
