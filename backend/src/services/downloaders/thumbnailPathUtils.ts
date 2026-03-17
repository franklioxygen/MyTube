export const buildManagedThumbnailWebPath = (
  thumbnailFilename: string,
  moveThumbnailsToVideoFolder: boolean,
  collectionName?: string,
): string => {
  const basePath = moveThumbnailsToVideoFolder ? "/videos" : "/images";
  return collectionName
    ? `${basePath}/${collectionName}/${thumbnailFilename}`
    : `${basePath}/${thumbnailFilename}`;
};
