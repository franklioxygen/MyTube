import fs from "fs-extra";
import os from "os";
import path from "path";
import sanitizeFilename from "sanitize-filename";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOriginalUploadFilename } from "../../controllers/video/uploadNaming";

type UploadNamingModule = typeof import("../../controllers/video/uploadNaming");

const VIDEO_ID = `upload-3f9a2c1b${"0".repeat(56)}`;
const tempRoots: string[] = [];

const makeTempRoot = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mytube-upload-naming-"));
  tempRoots.push(root);
  for (const dir of ["videos", "images", "subtitles", "data"]) {
    fs.ensureDirSync(path.join(root, dir));
  }
  return root;
};

const loadWithRoot = async (
  root: string,
  videos: any[] = []
): Promise<UploadNamingModule> => {
  vi.resetModules();
  vi.doMock("../../config/paths", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../config/paths")>()),
    DATA_DIR: path.join(root, "data"),
    VIDEOS_DIR: path.join(root, "videos"),
    IMAGES_DIR: path.join(root, "images"),
    SUBTITLES_DIR: path.join(root, "subtitles"),
  }));
  const allocator = await import(
    "../../services/filenameTemplate/outputPathAllocator"
  );
  allocator.setOutputPathAllocatorVideoProviderForTests(() => videos);
  return import("../../controllers/video/uploadNaming");
};

const writeTempUpload = (root: string, content = "uploaded-bytes") => {
  const storedFilename = "1760000000000-0123456789abcdef.mp4";
  fs.writeFileSync(path.join(root, "videos", storedFilename), content);
  return storedFilename;
};

const placeInput = (storedFilename: string, originalname: string) => ({
  storedFilename,
  originalname,
  videoId: VIDEO_ID,
  moveThumbnailsToVideoFolder: false,
  moveSubtitlesToVideoFolder: false,
});

describe("buildOriginalUploadFilename", () => {
  it.each([
    ["Family Trip 2024.MP4", "Family Trip 2024.mp4"],
    ["我的视频 café.mp4", "我的视频 café.mp4"],
    ["cafe\u0301.mp4", "café.mp4"],
    ["100% fun #1?.mov", "100 fun 1.mov"],
    [".hidden.mkv", "hidden.mkv"],
    ["a/b\\c.webm", "b c.webm"],
    ["clip. .mp4", "clip.mp4"],
    ["../../etc/passwd.mp4", "passwd.mp4"],
    ["..\\..\\evil.mp4", "evil.mp4"],
    ["invoice\u202Egpj.mp4", "invoicegpj.mp4"],
    ["a\u200Bb\uFEFFc\u2028d.mp4", "abcd.mp4"],
    ["a\u0000b\r\nc\u0085.mp4", "abc.mp4"],
    ["clip%03d.mp4", "clip03d.mp4"],
    ["concat:a.mp4", "concata.mp4"],
    ["$(rm -rf ~).mp4", "$(rm -rf ~).mp4"],
    ["-y.mp4", "-y.mp4"],
    ["ａ／ｂ.mp4", "ａ／ｂ.mp4"],
    ["می\u200Cخواهم.mp4", "می\u200Cخواهم.mp4"],
    ["👨\u200D👩\u200D👧.mp4", "👨\u200D👩\u200D👧.mp4"],
  ])("%j -> %j", (input, expected) => {
    expect(buildOriginalUploadFilename(input)).toBe(expected);
  });

  it.each([
    ["???.mp4"],
    ["CON.mp4"],
    ["nul.MKV"],
    ["..mp4"],
    [".mp4"],
    ["clip.exe"],
    [""],
  ])("%j is not usable", (input) => {
    expect(buildOriginalUploadFilename(input)).toBeNull();
  });

  it("trims long names on a character boundary", () => {
    const result = buildOriginalUploadFilename(`${"视".repeat(100)}.mp4`);

    expect(result).not.toBeNull();
    expect(Buffer.byteLength(result!, "utf8")).toBeLessThanOrEqual(200);
    expect(result).toMatch(/^视+\.mp4$/u);
  });

  it("never returns a name with separators, control, format or URL-breaking characters", () => {
    const hostile = [
      "../../etc/passwd.mp4",
      "..\\..\\x.mp4",
      "a\u0000b.mp4",
      "a\r\nX-Evil: 1.mp4",
      "$(id)`id`;reboot;.mp4",
      "-i x.mp4",
      "concat:a|b.mp4",
      "clip%03d.mp4",
      "a#b%c?d.mp4",
      "<script>alert(1)</script>.mp4",
      '"><svg onload=alert(1)>.mp4',
      "invoice\u202Egpj.mp4",
      "\u200B\uFEFF\u2028\u2029.mp4",
      "CON.mp4",
      "...mp4",
      ".htaccess.mp4",
      `${"a".repeat(1000)}.mp4`,
      "ａ／ｂ．．.mp4",
    ];

    for (const input of hostile) {
      const result = buildOriginalUploadFilename(input);
      if (result === null) {
        continue;
      }
      expect(result, input).not.toMatch(/[\\/#%?<>:"|*]/);
      expect(result, input).not.toMatch(
        /(?![\u200C\u200D])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
      );
      expect(result.startsWith("."), input).toBe(false);
      expect(sanitizeFilename(result), input).toBe(result);
      expect(Buffer.byteLength(result, "utf8"), input).toBeLessThanOrEqual(255);
    }
  });
});

describe("placeUploadUnderOriginalName", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../../config/paths");
    for (const root of tempRoots.splice(0)) {
      fs.removeSync(root);
    }
  });

  it("moves the upload to its original filename", async () => {
    const root = makeTempRoot();
    const naming = await loadWithRoot(root);
    const stored = writeTempUpload(root);

    const placement = naming.placeUploadUnderOriginalName(
      placeInput(stored, "Family Trip.mp4")
    );

    expect(placement).toMatchObject({
      videoFilename: "Family Trip.mp4",
      thumbnailFilename: "Family Trip.jpg",
    });
    expect(fs.existsSync(path.join(root, "videos", stored))).toBe(false);
    expect(
      fs.readFileSync(path.join(root, "videos", "Family Trip.mp4"), "utf8")
    ).toBe("uploaded-bytes");
    placement!.release();
  });

  it("appends the upload ID when the name is taken, leaving the existing file alone", async () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(root, "videos", "clip.mp4"), "existing");
    const naming = await loadWithRoot(root);
    const stored = writeTempUpload(root);

    const placement = naming.placeUploadUnderOriginalName(
      placeInput(stored, "clip.mp4")
    );

    expect(placement?.videoFilename).toBe("clip [3f9a2c1b].mp4");
    expect(placement?.thumbnailFilename).toBe("clip [3f9a2c1b].jpg");
    expect(
      fs.readFileSync(path.join(root, "videos", "clip.mp4"), "utf8")
    ).toBe("existing");
    placement!.release();
  });

  it("treats another video's thumbnail as a collision", async () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(root, "images", "clip.jpg"), "other-thumb");
    const naming = await loadWithRoot(root);
    const stored = writeTempUpload(root);

    const placement = naming.placeUploadUnderOriginalName(
      placeInput(stored, "clip.mp4")
    );

    expect(placement?.videoFilename).toBe("clip [3f9a2c1b].mp4");
    expect(placement?.thumbnailFilename).toBe("clip [3f9a2c1b].jpg");
    placement!.release();
  });

  it("treats a case-only match with a library row as a collision", async () => {
    const root = makeTempRoot();
    const naming = await loadWithRoot(root, [
      { id: "other", videoFilename: "Clip.mp4", videoPath: "/videos/Clip.mp4" },
    ]);
    const stored = writeTempUpload(root);

    const placement = naming.placeUploadUnderOriginalName(
      placeInput(stored, "clip.mp4")
    );

    expect(placement?.videoFilename).toBe("clip [3f9a2c1b].mp4");
    placement!.release();
  });

  it("keeps a name reserved until released, so concurrent uploads cannot share it", async () => {
    const root = makeTempRoot();
    const naming = await loadWithRoot(root);
    const firstStored = writeTempUpload(root, "first");
    const secondStored = "1760000000001-fedcba9876543210.mp4";
    fs.writeFileSync(path.join(root, "videos", secondStored), "second");

    const first = naming.placeUploadUnderOriginalName(
      placeInput(firstStored, "clip.mp4")
    );
    const second = naming.placeUploadUnderOriginalName({
      ...placeInput(secondStored, "clip.mp4"),
      videoId: `upload-aaaabbbb${"0".repeat(56)}`,
    });

    expect(first?.videoFilename).toBe("clip.mp4");
    expect(second?.videoFilename).toBe("clip [aaaabbbb].mp4");
    expect(fs.readFileSync(path.join(root, "videos", "clip.mp4"), "utf8")).toBe(
      "first"
    );
    first!.release();
    second!.release();
  });

  it("returns null and leaves the upload in place when the name is unusable", async () => {
    const root = makeTempRoot();
    const naming = await loadWithRoot(root);
    const stored = writeTempUpload(root);

    expect(
      naming.placeUploadUnderOriginalName(placeInput(stored, "CON.mp4"))
    ).toBeNull();
    expect(fs.existsSync(path.join(root, "videos", stored))).toBe(true);
  });

  it("returns null and releases the reservation when the move fails", async () => {
    const root = makeTempRoot();
    const naming = await loadWithRoot(root);

    expect(
      naming.placeUploadUnderOriginalName(
        placeInput("1760000000000-missing00000000.mp4", "clip.mp4")
      )
    ).toBeNull();

    const stored = writeTempUpload(root);
    const retry = naming.placeUploadUnderOriginalName(
      placeInput(stored, "clip.mp4")
    );
    expect(retry?.videoFilename).toBe("clip.mp4");
    retry!.release();
  });
});
