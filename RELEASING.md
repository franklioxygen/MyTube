# Release Process

MyTube follows [Semantic Versioning 2.0.0](https://semver.org/).

## Versioning Scheme

Versions are formatted as `MAJOR.MINOR.PATCH` (e.g., `1.0.0`).

-   **MAJOR**: Incompatible API changes.
-   **MINOR**: Backwards-compatible functionality.
-   **PATCH**: Backwards-compatible bug fixes.

## Creating a Release

We use the `release.sh` script to automate the release process. This script handles:
1.  Updating version numbers in `package.json` files.
2.  Creating a git tag.
3.  Building and pushing Docker images.

### Prerequisites

-   Ensure you are on the `main` branch.
-   Ensure your working directory is clean (no uncommitted changes).
-   Ensure you are logged in to Docker Hub (`docker login`).

### Usage

Run the release script with the desired version number:

```bash
./release.sh <version>
```

Example:

```bash
./release.sh 1.2.0
```

Alternatively, you can specify the increment type:

```bash
./release.sh patch  # 1.1.0 -> 1.1.1
./release.sh minor  # 1.1.0 -> 1.2.0
./release.sh major  # 1.1.0 -> 2.0.0
```

### What the Script Does

1.  **Checks** that you are on `main` and have a clean git status.
2.  **Updates** `version` in:
    -   `package.json`
    -   `frontend/package.json`
    -   `backend/package.json`
3.  **Commits** the changes with message `chore(release): v<version>`.
4.  **Tags** the commit with `v<version>`.
5.  **Builds** Docker images for backend and frontend.
6.  **Pushes** images to Docker Hub with tags:
    -   `franklioxygen/mytube:backend-<version>`
    -   `franklioxygen/mytube:backend-latest`
    -   `franklioxygen/mytube:frontend-<version>`
    -   `franklioxygen/mytube:frontend-latest`
