"use strict";

const { fromBuffer, fileTypeFromBuffer, supportedExtensions, supportedMimeTypes } = require("./index.js");

const api = {
  fromBuffer,
  fileTypeFromBuffer,
  supportedExtensions,
  supportedMimeTypes,
};

module.exports = api;
module.exports.default = api;
