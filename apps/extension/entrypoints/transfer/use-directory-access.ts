import { useEffect, useRef, useState } from "react";

import type {
  AuthorizedDirectory,
  findDownloadedEpub,
} from "../../src/files/directory-access";

type DirectoryAccessModule = typeof import("../../src/files/directory-access");

export type DirectoryAutomationPhase =
  | "checking"
  | "error"
  | "idle"
  | "missing"
  | "permission"
  | "setup"
  | "unsupported";

export interface DirectoryAutomation {
  directories: readonly AuthorizedDirectory[];
  phase: DirectoryAutomationPhase;
  message: string;
  busy: boolean;
  add: () => Promise<void>;
  cancelPendingLookup: () => void;
  remove: (id: string) => Promise<void>;
  requestPermission: (id: string) => Promise<void>;
}

interface DirectoryAutomationOptions {
  expectedBytes?: number;
  onFile: (file: File, directoryName: string) => void;
  suggestedFilename: string | null;
}

export function useDirectoryAccess({
  expectedBytes,
  onFile,
  suggestedFilename,
}: DirectoryAutomationOptions): DirectoryAutomation {
  const [directories, setDirectories] = useState<AuthorizedDirectory[]>([]);
  const [phase, setPhase] = useState<DirectoryAutomationPhase>("checking");
  const [message, setMessage] = useState("正在检查已授权目录…");
  const [busy, setBusy] = useState(true);
  const moduleReference = useRef<DirectoryAccessModule | null>(null);
  const lookupGeneration = useRef(0);
  const onFileReference = useRef(onFile);

  useEffect(() => {
    onFileReference.current = onFile;
  }, [onFile]);

  useEffect(() => {
    const generation = lookupGeneration.current + 1;
    lookupGeneration.current = generation;

    void import("../../src/files/directory-access")
      .then(async (directoryAccess) => {
        if (lookupGeneration.current !== generation) {
          return;
        }
        moduleReference.current = directoryAccess;
        if (!directoryAccess.supportsDirectoryAccess()) {
          setDirectories([]);
          setPhase("unsupported");
          setMessage("当前浏览器不支持保存目录授权，请继续手动选择文件。");
          return;
        }
        const currentDirectories =
          await directoryAccess.listAuthorizedDirectories();
        if (lookupGeneration.current !== generation) {
          return;
        }
        setDirectories(currentDirectories);
        await lookupAndUpdate({
          active: () => lookupGeneration.current === generation,
          directoryAccess,
          directories: currentDirectories,
          expectedBytes,
          onFile: onFileReference,
          setMessage,
          setPhase,
          suggestedFilename,
        });
      })
      .catch(() => {
        if (lookupGeneration.current === generation) {
          setPhase("error");
          setMessage("无法读取已保存的目录授权，请继续手动选择文件。");
        }
      })
      .finally(() => {
        if (lookupGeneration.current === generation) {
          setBusy(false);
        }
      });

    return () => {
      if (lookupGeneration.current === generation) {
        lookupGeneration.current += 1;
      }
    };
  }, [expectedBytes, suggestedFilename]);

  const add = async () => {
    const directoryAccess = moduleReference.current;
    if (directoryAccess === null || busy) {
      return;
    }
    setBusy(true);
    setMessage("正在添加只读目录授权…");
    try {
      await directoryAccess.addAuthorizedDirectory();
      const currentDirectories =
        await directoryAccess.listAuthorizedDirectories();
      setDirectories(currentDirectories);
      await runCurrentLookup(
        directoryAccess,
        currentDirectories,
        suggestedFilename,
        expectedBytes,
        lookupGeneration,
        onFileReference,
        setPhase,
        setMessage,
      );
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setPhase(directories.length === 0 ? "setup" : "idle");
        setMessage(
          directories.length === 0
            ? "添加一个常用保存目录，以后下载 EPUB 后可直接显示二维码。"
            : "目录没有变化。",
        );
      } else {
        setPhase("error");
        setMessage("无法添加这个目录，请稍后重试。");
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const directoryAccess = moduleReference.current;
    if (directoryAccess === null || busy) {
      return;
    }
    setBusy(true);
    try {
      await directoryAccess.removeAuthorizedDirectory(id);
      const currentDirectories =
        await directoryAccess.listAuthorizedDirectories();
      setDirectories(currentDirectories);
      setPhase(currentDirectories.length === 0 ? "setup" : "idle");
      setMessage(
        currentDirectories.length === 0
          ? "已移除目录。添加一个常用保存目录即可恢复自动读取。"
          : "已移除目录授权。",
      );
    } catch {
      setPhase("error");
      setMessage("无法移除目录授权，请稍后重试。");
    } finally {
      setBusy(false);
    }
  };

  const requestPermission = async (id: string) => {
    const directoryAccess = moduleReference.current;
    if (directoryAccess === null || busy) {
      return;
    }
    setBusy(true);
    setMessage("正在请求只读权限…");
    try {
      await directoryAccess.requestAuthorizedDirectoryPermission(id);
      const currentDirectories =
        await directoryAccess.listAuthorizedDirectories();
      setDirectories(currentDirectories);
      await runCurrentLookup(
        directoryAccess,
        currentDirectories,
        suggestedFilename,
        expectedBytes,
        lookupGeneration,
        onFileReference,
        setPhase,
        setMessage,
      );
    } catch {
      setPhase("permission");
      setMessage("Chrome 没有授予目录权限，你仍可手动选择 EPUB。");
    } finally {
      setBusy(false);
    }
  };

  return {
    directories,
    phase,
    message,
    busy,
    add,
    cancelPendingLookup: () => {
      lookupGeneration.current += 1;
    },
    remove,
    requestPermission,
  };
}

async function runCurrentLookup(
  directoryAccess: DirectoryAccessModule,
  directories: readonly AuthorizedDirectory[],
  suggestedFilename: string | null,
  expectedBytes: number | undefined,
  lookupGeneration: React.RefObject<number>,
  onFile: React.RefObject<DirectoryAutomationOptions["onFile"]>,
  setPhase: React.Dispatch<React.SetStateAction<DirectoryAutomationPhase>>,
  setMessage: React.Dispatch<React.SetStateAction<string>>,
): Promise<void> {
  const generation = lookupGeneration.current + 1;
  lookupGeneration.current = generation;
  await lookupAndUpdate({
    active: () => lookupGeneration.current === generation,
    directoryAccess,
    directories,
    expectedBytes,
    onFile,
    setMessage,
    setPhase,
    suggestedFilename,
  });
}

async function lookupAndUpdate({
  active,
  directoryAccess,
  directories,
  expectedBytes,
  onFile,
  setMessage,
  setPhase,
  suggestedFilename,
}: {
  active: () => boolean;
  directoryAccess: DirectoryAccessModule;
  directories: readonly AuthorizedDirectory[];
  expectedBytes: number | undefined;
  onFile: React.RefObject<DirectoryAutomationOptions["onFile"]>;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
  setPhase: React.Dispatch<React.SetStateAction<DirectoryAutomationPhase>>;
  suggestedFilename: string | null;
}): Promise<void> {
  if (suggestedFilename === null) {
    setPhase(directories.length === 0 ? "setup" : "idle");
    setMessage(
      directories.length === 0
        ? "添加一个常用保存目录，以后下载 EPUB 后可直接显示二维码。"
        : "已准备好自动读取这些目录中的新 EPUB。",
    );
    return;
  }
  if (directories.length === 0) {
    setPhase("setup");
    setMessage("只需添加一次当前保存目录，以后同目录下载的 EPUB 会自动读取。");
    return;
  }

  setPhase("checking");
  setMessage(`正在已授权目录中查找 ${suggestedFilename}…`);
  const lookup = await invokeLookup(
    directoryAccess.findDownloadedEpub,
    suggestedFilename,
    expectedBytes,
  );
  if (!active()) {
    return;
  }
  if (lookup.match !== undefined) {
    setPhase("idle");
    setMessage(`已从“${lookup.match.directoryName}”自动读取文件。`);
    onFile.current(lookup.match.file, lookup.match.directoryName);
    return;
  }
  if (lookup.blockedDirectories > 0 && lookup.checkedDirectories === 0) {
    setPhase("permission");
    setMessage("已保存的目录需要重新允许访问，也可以继续手动选择文件。");
    return;
  }
  setPhase("missing");
  setMessage("已授权目录中没有找到这个文件。可添加它所在的目录，或手动选择。");
}

async function invokeLookup(
  lookup: typeof findDownloadedEpub,
  suggestedFilename: string,
  expectedBytes: number | undefined,
) {
  return expectedBytes === undefined
    ? lookup(suggestedFilename)
    : lookup(suggestedFilename, expectedBytes);
}
