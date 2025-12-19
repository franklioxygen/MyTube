import { Request, Response } from "express";
import { ValidationError } from "../errors/DownloadErrors";
import { CloudStorageService } from "../services/CloudStorageService";

/**
 * Get signed URL for a cloud storage file
 * GET /api/cloud/signed-url?filename=xxx&type=video|thumbnail
 */
export const getSignedUrl = async (
    req: Request,
    res: Response
): Promise<void> => {
    const { filename, type } = req.query;

    if (!filename || typeof filename !== "string") {
        throw new ValidationError("filename is required", "filename");
    }

    if (type && type !== "video" && type !== "thumbnail") {
        throw new ValidationError(
            "type must be 'video' or 'thumbnail'",
            "type"
        );
    }

    const fileType = (type as "video" | "thumbnail") || "video";
    const signedUrl = await CloudStorageService.getSignedUrl(filename, fileType);

    if (!signedUrl) {
        res.status(404).json({
            success: false,
            message: "File not found in cloud storage or cloud storage not configured",
        });
        return;
    }

    res.status(200).json({
        success: true,
        url: signedUrl,
    });
};

