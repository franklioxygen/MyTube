import fs from "fs-extra";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { Jimp } from "jimp";
import { fromBuffer, fromFile } from "file-type";

const { PNG } = require("pngjs");

const png1x1 = PNG.sync.write({
  width: 1,
  height: 1,
  data: Buffer.from([255, 255, 255, 255]),
});

const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00]);
const gifHeader = Buffer.from("47494638396101000100", "hex");
const webpHeader = Buffer.concat([
  Buffer.from("52494646", "hex"),
  Buffer.from([0x18, 0x00, 0x00, 0x00]),
  Buffer.from("57454250", "hex"),
  Buffer.from("56503820", "hex"),
]);
const avifHeader = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from("66747970", "hex"),
  Buffer.from("61766966", "hex"),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from("6d69663161766966", "hex"),
]);
const tiffHeader = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
const bmpHeader = Buffer.from([0x42, 0x4d, 0x46, 0x00, 0x00, 0x00]);

const tempDirectories: string[] = [];

afterEach(async () => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (directory) {
      await fs.remove(directory);
    }
  }
});

describe("file-type compatibility package", () => {
  it("detects supported image signatures from buffers", async () => {
    await expect(fromBuffer(jpegHeader)).resolves.toEqual({
      ext: "jpg",
      mime: "image/jpeg",
    });
    await expect(fromBuffer(png1x1)).resolves.toEqual({
      ext: "png",
      mime: "image/png",
    });
    await expect(fromBuffer(gifHeader)).resolves.toEqual({
      ext: "gif",
      mime: "image/gif",
    });
    await expect(fromBuffer(webpHeader)).resolves.toEqual({
      ext: "webp",
      mime: "image/webp",
    });
    await expect(fromBuffer(avifHeader)).resolves.toEqual({
      ext: "avif",
      mime: "image/avif",
    });
    await expect(fromBuffer(tiffHeader)).resolves.toEqual({
      ext: "tif",
      mime: "image/tiff",
    });
    await expect(fromBuffer(bmpHeader)).resolves.toEqual({
      ext: "bmp",
      mime: "image/bmp",
    });
    await expect(fromBuffer(Buffer.from("not-an-image"))).resolves.toBeUndefined();
  });

  it("detects file types from disk", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mytube-file-type-"));
    tempDirectories.push(tempDirectory);
    const pngPath = path.join(tempDirectory, "avatar.png");
    await fs.writeFile(pngPath, png1x1);

    await expect(fromFile(pngPath)).resolves.toEqual({
      ext: "png",
      mime: "image/png",
    });
  });

  it("rejects file paths outside the app and temp directories", async () => {
    const outsidePath = path.resolve(process.cwd(), "..", "package.json");

    await expect(fromFile(outsidePath)).rejects.toThrow(
      /outside allowed roots/
    );
  });

  it("stays compatible with Jimp's file-type/core.js import", async () => {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "mytube-jimp-"));
    tempDirectories.push(tempDirectory);
    const pngPath = path.join(tempDirectory, "avatar.png");
    await fs.writeFile(pngPath, png1x1);

    const coreFileType = require("file-type/core.js");
    await expect(coreFileType.fromBuffer(png1x1)).resolves.toEqual({
      ext: "png",
      mime: "image/png",
    });

    const image = await Jimp.read(pngPath);
    expect(image.bitmap.width).toBe(1);
    expect(image.bitmap.height).toBe(1);
  });
});
