# MyTube

A YouTube/Bilibili/MissAV video downloader and player that supports channel subscriptions and auto-downloads, allowing you to save videos and thumbnails locally. Organize your videos into collections for easy access and management. Now supports [yt-dlp sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md##), including Weibo, Xiaohongshu, X.com, etc.

[中文](README-zh.md)

## Demo

🌐 **Try the live demo (read only): [https://mytube-demo.vercel.app](https://mytube-demo.vercel.app)**

[![Watch the video](https://img.youtube.com/vi/O5rMqYffXpg/maxresdefault.jpg)](https://youtu.be/O5rMqYffXpg)


## Features

- **Video Downloading**: Download YouTube, Bilibili and MissAV videos with a simple URL input.
- **Video Upload**: Upload local video files directly to your library with automatic thumbnail generation.
- **Bilibili Support**: Support for downloading single videos, multi-part videos, and entire collections/series.
- **Parallel Downloads**: Queue multiple downloads and track their progress simultaneously.
- **Batch Download**: Add multiple video URLs at once to the download queue.
- **Concurrent Download Limit**: Set a limit on the number of simultaneous downloads to manage bandwidth.
- **Local Library**: Automatically save video thumbnails and metadata for a rich browsing experience.
- **Video Player**: Custom player with Play/Pause, Loop, Seek, Full-screen, and Dimming controls.
- **Auto Subtitles**: Automatically download YouTube default language subtitles.
- **Search**: Search for videos locally in your library or online via YouTube.
- **Collections**: Organize videos into custom collections for easy access.
- **Modern UI**: Responsive, dark-themed interface with a "Back to Home" feature and glassmorphism effects.
- **Theme Support**: Toggle between Light and Dark modes with smooth transitions.
- **Login Protection**: Secure your application with a password login page.
- **Internationalization**: Support for multiple languages including English, Chinese, Spanish, French, German, Japanese, Korean, Arabic, and Portuguese.
- **Pagination**: Efficiently browse large libraries with pagination support.
- **Subscriptions**: Manage subscriptions to channels or creators to automatically download new content.
- **Video Rating**: Rate your videos with a 5-star system.
- **Mobile Optimizations**: Mobile-friendly tags menu and optimized layout for smaller screens.
- **Temp Files Cleanup**: Manage storage by cleaning up temporary download files directly from settings.
- **View Modes**: Toggle between Collection View and Video View on the home page.

## Directory Structure

For a detailed breakdown of the project structure, please refer to [Directory Structure](documents/en/directory-structure.md).

## Getting Started

For installation and setup instructions, please refer to [Getting Started](documents/en/getting-started.md).

## API Endpoints

For a list of available API endpoints, please refer to [API Endpoints](documents/en/api-endpoints.md).

## Environment Variables

The application uses environment variables for configuration.

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:5551/api
VITE_BACKEND_URL=http://localhost:5551
```

### Backend (`backend/.env`)

```env
PORT=5551
UPLOAD_DIR=uploads
VIDEO_DIR=uploads/videos
IMAGE_DIR=uploads/images
MAX_FILE_SIZE=500000000
```

Copy the `.env.example` files in both frontend and backend directories to create your own `.env` files.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to get started, our development workflow, and code quality guidelines.

## Deployment

For detailed instructions on how to deploy MyTube using Docker, please refer to [Docker Deployment Guide](documents/en/docker-guide.md).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=franklioxygen/MyTube&type=date&legend=bottom-right)](https://www.star-history.com/#franklioxygen/MyTube&type=date&legend=bottom-right)

## Disclaimer

 - Purpose and Restrictions This software (including code and documentation) is intended solely for personal learning, research, and technical exchange. It is strictly prohibited to use this software for any commercial purposes or for any illegal activities that violate local laws and regulations.

 - Liability The developer is unaware of and has no control over how users utilize this software. Any legal liabilities, disputes, or damages arising from the illegal or improper use of this software (including but not limited to copyright infringement) shall be borne solely by the user. The developer assumes no direct, indirect, or joint liability.

 - Modifications and Distribution This project is open-source. Any individual or organization modifying or forking this code must comply with the open-source license. Important: If a third party modifies the code to bypass or remove the original user authentication/security mechanisms and distributes such versions, the modifier/distributor bears full responsibility for any consequences. We strongly discourage bypassing or tampering with any security verification mechanisms.

 - Non-Profit Statement This is a completely free open-source project. The developer does not accept donations and has never published any donation pages. The software itself allows no charges and offers no paid services. Please be vigilant and beware of any scams or misleading information claiming to collect fees on behalf of this project.

## License

MIT
