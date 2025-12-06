# Contributing to MyTube

First off, thanks for taking the time to contribute! 🎉

The following is a set of guidelines for contributing to MyTube. These are mostly guidelines, not rules. Use your best judgment, and feel free to propose changes to this document in a pull request.

## Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v14 or higher)
- [npm](https://www.npmjs.com/) (v6 or higher)
- [Docker](https://www.docker.com/) (optional, for containerized development)

### Installation

1.  **Fork the repository** on GitHub.
2.  **Clone your fork** locally:
    ```bash
    git clone https://github.com/your-username/mytube.git
    cd mytube
    ```
3.  **Install dependencies** for both frontend and backend:
    ```bash
    npm run install:all
    ```
    Alternatively, you can install them manually:
    ```bash
    npm install
    cd frontend && npm install
    cd ../backend && npm install
    ```

### Running Locally

To start the development environment (both frontend and backend):

```bash
npm run dev
```

-   **Frontend**: http://localhost:5556
-   **Backend API**: http://localhost:5551

## Project Structure

-   `frontend/`: React application (Vite + TypeScript).
-   `backend/`: Express.js API (TypeScript).
-   `docker-compose.yml`: Docker configuration for running the full stack.

## Development Workflow

1.  **Create a Branch**: Always work on a new branch for your changes.
    ```bash
    git checkout -b feature/my-awesome-feature
    # or
    git checkout -b fix/annoying-bug
    ```
2.  **Make Changes**: Implement your feature or fix.
3.  **Commit**: Write clear, descriptive commit messages.
    ```bash
    git commit -m "feat: add new video player controls"
    ```
    *We recommend following [Conventional Commits](https://www.conventionalcommits.org/) convention.*

## Code Quality

### Frontend
-   Run linting to ensure code style consistency:
    ```bash
    cd frontend
    npm run lint
    ```

### Backend
-   Run tests to ensure nothing is broken:
    ```bash
    cd backend
    npm run test
    ```

## Pull Request Process

1.  Ensure your code builds and runs locally.
2.  Update the `README.md` if you are adding new features or changing configuration.
3.  Push your branch to your fork on GitHub.
4.  Open a Pull Request against the `master` branch of the original repository.
5.  Provide a clear description of the problem and solution.
6.  Link to any related issues.

## License

By contributing, you agree that your contributions will be licensed under its MIT License.
