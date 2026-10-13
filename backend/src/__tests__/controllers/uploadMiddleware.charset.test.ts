import fs from "fs-extra";
import os from "os";
import path from "path";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];

// Smallest header the upload storage accepts as an .mp4 (ISO BMFF "isom").
const MP4_HEADER = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("ftypisom", "ascii"),
  Buffer.from([0x00, 0x00, 0x02, 0x00]),
  Buffer.from("isomiso2", "ascii"),
]);

const multipartRequest = (filename: string) => {
  const boundary = "----mytube-test-boundary";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="videos"; filename="`
    ),
    // Browsers send the filename parameter as raw UTF-8 bytes.
    Buffer.from(filename, "utf8"),
    Buffer.from('"\r\nContent-Type: video/mp4\r\n\r\n'),
    MP4_HEADER,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const req = new PassThrough() as any;
  req.headers = {
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(body.length),
  };
  req.end(body);
  return req;
};

describe("upload middleware filename charset", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../../config/paths");
    for (const root of tempRoots.splice(0)) {
      fs.removeSync(root);
    }
  });

  it("decodes non-ASCII upload filenames as UTF-8", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-upload-charset-"));
    tempRoots.push(root);
    vi.resetModules();
    vi.doMock("../../config/paths", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../config/paths")>()),
      VIDEOS_DIR: path.join(root, "videos"),
    }));
    const { uploadBatch } = await import(
      "../../controllers/video/uploadMiddleware"
    );
    const req = multipartRequest("我的视频 café.mp4");

    await new Promise<void>((resolve, reject) => {
      uploadBatch.array("videos")(req, {} as any, (error?: unknown) =>
        error ? reject(error) : resolve()
      );
    });

    expect(req.files).toHaveLength(1);
    expect(req.files[0].originalname).toBe("我的视频 café.mp4");
    expect(req.files[0].validationError).toBeUndefined();
  });
});
