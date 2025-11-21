// Load environment variables from .env file
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const VERSION = require("./version");
const apiRoutes = require("./src/routes/api");
const storageService = require("./src/services/storageService");
const { VIDEOS_DIR, IMAGES_DIR } = require("./src/config/paths");

// Display version information
VERSION.displayVersion();

const app = express();
const PORT = process.env.PORT || 5551;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize storage (create directories, etc.)
storageService.initializeStorage();

// Serve static files
app.use("/videos", express.static(VIDEOS_DIR));
app.use("/images", express.static(IMAGES_DIR));

// API Routes
app.use("/api", apiRoutes);

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
