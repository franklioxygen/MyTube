import { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection, deleteCollection, getCollections, updateCollection } from '../../controllers/collectionController';
import * as storageService from '../../services/storageService';

vi.mock('../../services/storageService');

describe('CollectionController', () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let json: any;
  let status: any;

  beforeEach(() => {
    vi.clearAllMocks();
    json = vi.fn();
    status = vi.fn().mockReturnValue({ json });
    req = {};
    res = {
      json,
      status,
    };
  });

  describe('getCollections', () => {
    it('should return collections', () => {
      const mockCollections = [{ id: '1', title: 'Col 1', videos: [] }];
      (storageService.getCollections as any).mockReturnValue(mockCollections);

      getCollections(req as Request, res as Response);

      expect(json).toHaveBeenCalledWith(mockCollections);
    });

    it('should handle errors', () => {
      (storageService.getCollections as any).mockImplementation(() => {
        throw new Error('Error');
      });

      getCollections(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith({ success: false, error: 'Failed to get collections' });
    });
  });

  describe('createCollection', () => {
    it('should create collection', () => {
      req.body = { name: 'New Col' };
      const mockCollection = { id: '1', title: 'New Col', videos: [] };
      (storageService.saveCollection as any).mockReturnValue(mockCollection);

      createCollection(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(201);
      // The controller creates a new object, so we check partial match or just that it was called
      expect(storageService.saveCollection).toHaveBeenCalled();
    });

    it('should return 400 if name is missing', () => {
      req.body = {};

      createCollection(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith({ success: false, error: 'Collection name is required' });
    });

    it('should add video if videoId provided', () => {
      req.body = { name: 'New Col', videoId: 'v1' };
      const mockCollection = { id: '1', title: 'New Col', videos: ['v1'] };
      (storageService.addVideoToCollection as any).mockReturnValue(mockCollection);

      createCollection(req as Request, res as Response);

      expect(storageService.addVideoToCollection).toHaveBeenCalled();
      expect(status).toHaveBeenCalledWith(201);
    });
  });

  describe('updateCollection', () => {
    it('should update collection name', () => {
      req.params = { id: '1' };
      req.body = { name: 'Updated Name' };
      const mockCollection = { id: '1', title: 'Updated Name', videos: [] };
      (storageService.atomicUpdateCollection as any).mockReturnValue(mockCollection);

      updateCollection(req as Request, res as Response);

      expect(storageService.atomicUpdateCollection).toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(mockCollection);
    });

    it('should add video', () => {
      req.params = { id: '1' };
      req.body = { videoId: 'v1', action: 'add' };
      const mockCollection = { id: '1', title: 'Col', videos: ['v1'] };
      (storageService.addVideoToCollection as any).mockReturnValue(mockCollection);

      updateCollection(req as Request, res as Response);

      expect(storageService.addVideoToCollection).toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(mockCollection);
    });

    it('should remove video', () => {
      req.params = { id: '1' };
      req.body = { videoId: 'v1', action: 'remove' };
      const mockCollection = { id: '1', title: 'Col', videos: [] };
      (storageService.removeVideoFromCollection as any).mockReturnValue(mockCollection);

      updateCollection(req as Request, res as Response);

      expect(storageService.removeVideoFromCollection).toHaveBeenCalled();
      expect(json).toHaveBeenCalledWith(mockCollection);
    });

    it('should return 404 if collection not found', () => {
      req.params = { id: '1' };
      req.body = { name: 'Update' };
      (storageService.atomicUpdateCollection as any).mockReturnValue(null);

      updateCollection(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(404);
    });
  });

  describe('deleteCollection', () => {
    it('should delete collection with files', () => {
      req.params = { id: '1' };
      req.query = {};
      (storageService.deleteCollectionWithFiles as any).mockReturnValue(true);

      deleteCollection(req as Request, res as Response);

      expect(storageService.deleteCollectionWithFiles).toHaveBeenCalledWith('1');
      expect(json).toHaveBeenCalledWith({ success: true, message: 'Collection deleted successfully' });
    });

    it('should delete collection and videos if deleteVideos is true', () => {
      req.params = { id: '1' };
      req.query = { deleteVideos: 'true' };
      (storageService.deleteCollectionAndVideos as any).mockReturnValue(true);

      deleteCollection(req as Request, res as Response);

      expect(storageService.deleteCollectionAndVideos).toHaveBeenCalledWith('1');
      expect(json).toHaveBeenCalledWith({ success: true, message: 'Collection deleted successfully' });
    });

    it('should return 404 if delete fails', () => {
      req.params = { id: '1' };
      req.query = {};
      (storageService.deleteCollectionWithFiles as any).mockReturnValue(false);

      deleteCollection(req as Request, res as Response);

      expect(status).toHaveBeenCalledWith(404);
    });
  });
});
