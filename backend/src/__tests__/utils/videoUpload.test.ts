import fs from "fs-extra";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it } from "vitest";
import { ValidationError } from "../../errors/DownloadErrors";
import { createVideoUploadStorage } from "../../utils/videoUpload";

const tempDirectories: string[] = [];

async function createTempDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "mytube-upload-"));
  tempDirectories.push(directory);
  return directory;
}

function handleFileWithStorage(
  storage: ReturnType<typeof createVideoUploadStorage>,
  req: Record<string, unknown>,
  originalname: string,
  chunks: Buffer[]
): Promise<{ error: Error | null; info?: Express.Multer.File }> {
  return new Promise((resolve) => {
    const stream = new PassThrough();
    storage._handleFile(
      req as any,
      {
        originalname,
        stream,
      } as unknown as Express.Multer.File,
      (error, info) => {
        resolve({
          error,
          info: info as Express.Multer.File | undefined,
        });
      }
    );

    for (const chunk of chunks) {
      stream.write(chunk);
    }
    stream.end();
  });
}

afterEach(async () => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await fs.remove(directory);
    }
  }
});

describe("videoUpload storage", () => {
  it("fails fast when a file signature is invalid", async () => {
    const storage = createVideoUploadStorage(await createTempDirectory());

    const result = await handleFileWithStorage(
      storage,
      {},
      "bad.mp4",
      [Buffer.from("definitely-not-a-video")]
    );

    expect(result.error).toBeInstanceOf(ValidationError);
    expect(result.error?.message).toContain("unsupported video signature");
  });

  it("enforces aggregate request size limits across multiple files", async () => {
    const storage = createVideoUploadStorage(await createTempDirectory(), {
      maxTotalBytes: 5,
    });
    const req = {};

    const firstFile = await handleFileWithStorage(storage, req, "one.flv", [
      Buffer.from("FLV"),
    ]);
    const secondFile = await handleFileWithStorage(storage, req, "two.flv", [
      Buffer.from("FLV"),
    ]);

    expect(firstFile.error).toBeNull();
    expect(secondFile.error).toBeInstanceOf(ValidationError);
    expect(secondFile.error?.message).toContain("Batch upload too large");
  });
});
