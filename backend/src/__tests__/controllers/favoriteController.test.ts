import { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addFavoriteAuthor,
  addFavoriteCollection,
  getFavoriteAuthors,
  getFavoriteCollections,
  removeFavoriteAuthor,
} from "../../controllers/favoriteController";
import * as favoriteService from "../../services/favoriteService";
import * as storageService from "../../services/storageService";
import { getVisibilityScopedRole } from "../../controllers/video/visibility";

vi.mock("../../services/favoriteService");
vi.mock("../../services/storageService");
vi.mock("../../controllers/video/visibility", () => ({
  getVisibilityScopedRole: vi.fn(),
}));

describe("favoriteController", () => {
  const json = vi.fn();
  const statusJson = vi.fn();
  const res = {
    json,
    status: vi.fn(() => ({ json: statusJson })),
  } as unknown as Response;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(favoriteService.resolveFavoriteUserId).mockReturnValue("owner-1");
    vi.mocked(getVisibilityScopedRole).mockReturnValue("visitor");
  });

  it("lists favorites using the resolved owner and visibility role", async () => {
    const rows = [{ collectionId: "collection-1", name: "Saved", videoCount: 1, favoritedAt: 1 }];
    vi.mocked(favoriteService.listFavoriteCollections).mockReturnValue(rows);

    await getFavoriteCollections({} as Request, res);

    expect(favoriteService.listFavoriteCollections).toHaveBeenCalledWith("owner-1", "visitor");
    expect(json).toHaveBeenCalledWith(rows);
  });

  it("returns 404 when favoriting an unknown collection", async () => {
    vi.mocked(storageService.getCollectionById).mockReturnValue(undefined);

    await expect(addFavoriteCollection({ params: { id: "missing" } } as unknown as Request, res))
      .rejects.toMatchObject({ name: "NotFoundError" });
    expect(favoriteService.addFavoriteCollection).not.toHaveBeenCalled();
  });

  it("creates a collection favorite for the resolved owner", async () => {
    vi.mocked(storageService.getCollectionById).mockReturnValue({ id: "collection-1" } as never);

    await addFavoriteCollection({ params: { id: "collection-1" } } as unknown as Request, res);

    expect(favoriteService.addFavoriteCollection).toHaveBeenCalledWith("owner-1", "collection-1");
    expect(statusJson).toHaveBeenCalledWith({ success: true });
  });

  it("validates author metadata and preserves the exact author string", async () => {
    const req = {
      body: {
        author: "AC/DC?News",
        displayName: "AC/DC",
        avatarPath: "/avatars/acdc.jpg",
        channelUrl: "https://example.com/acdc",
      },
    } as Request;

    await addFavoriteAuthor(req, res);

    expect(favoriteService.addFavoriteAuthor).toHaveBeenCalledWith("owner-1", req.body);
    expect(statusJson).toHaveBeenCalledWith({ success: true });
  });

  it("sends the author in the DELETE body", async () => {
    await removeFavoriteAuthor({ body: { author: "AC/DC" } } as Request, res);

    expect(favoriteService.removeFavoriteAuthor).toHaveBeenCalledWith("owner-1", "AC/DC");
    expect(json).toHaveBeenCalledWith({ success: true });
  });

  it("returns 401 before reading favorites for an unauthenticated request", async () => {
    vi.mocked(favoriteService.resolveFavoriteUserId).mockReturnValue(null);

    await getFavoriteAuthors({} as Request, res);

    expect((res.status as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(statusJson).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(favoriteService.listFavoriteAuthors).not.toHaveBeenCalled();
  });
});
