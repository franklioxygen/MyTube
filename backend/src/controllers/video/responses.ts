import { Response } from "express";
import { successResponse } from "../../utils/response";

// Helper responses
export const sendData = (res: Response, data: any) => {
  res.status(200).json(data);
};

export const sendSuccess = (res: Response, data: any, message: string) => {
  res.status(200).json(successResponse(data, message));
};
