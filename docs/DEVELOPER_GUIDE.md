# Developer Guide

This guide provides detailed information for developers who want to contribute to the Dalec VS Code Extension.

## Prerequisites

Before getting started, ensure you have the following installed:

- **Node.js** (version 20 or higher)
- **npm** (comes with Node.js)
- **Docker** with Buildx support (for testing build functionality)
- **VS Code** (for extension development and testing)
- **Git**

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/project-dalec/dalec-vscode-extension.git
cd dalec-vscode-extension
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required dependencies including the TypeScript/ESLint toolchain.

### 3. Build the Extension

```bash
npm run compile
```

This compiles the TypeScript source code and emits `dist/extension.js`.

For production builds, use:
```bash
npm run webpack
```

### 4. Run the Extension in Development Mode

You have several options to test the extension:

**Option A: Using VS Code Command Palette**
1. Open the project in VS Code
2. Press `F5` to launch the Extension Development Host
3. This opens a new VS Code window with the extension loaded

**Option B: Using Command Line**
```bash
code --extensionDevelopmentPath=$(pwd)
```

**Option C: Package and Install Locally**
```bash
npx vsce package
```
Then install the generated `.vsix` file using VS Code's Extension Manager.

## Development Workflow

### Project Structure

```
dalec-vscode-extension/
├── src/
│   ├── extension.ts              # Main extension entry point
│   └── commands/                 # Command implementations
│       ├── runBuildCurrentSpecCommand/
│       │   ├── runBuildCommand.ts
│       │   ├── dalecStatusBar.ts
│       │   └── helpers/          # Helper utilities
│       └── reRunLastAction/
├── schemas/
│   └── spec.schema.json          # Dalec spec JSON schema (vendored copy)
├── docs/
│   └── spec.schema.json          # Preferred schema location
├── resources/                    # Extension resources
├── package.json                  # Extension manifest
├── tsconfig.json                # TypeScript configuration
└── webpack.config.js            # Webpack build configuration
```

### Available Scripts

- `npm run compile` - Compile TypeScript to JavaScript
- `npm run webpack` - Build production bundle with webpack
- `npm run install:all` - Install all dependencies (used in CI/CD)
- `npm run watch` - Watch mode for development
- `npm test` - Run tests

### Testing Your Changes

1. **Manual Testing**: Launch the extension in development mode (F5) and test your changes in the Extension Development Host window
2. **With Dalec Specs**: Create or open a `.yml`/`.yaml` file with `#syntax=ghcr.io/project-dalec/dalec/frontend:*` as the first line
3. **Debug Configurations**: Test debug configurations in `.vscode/launch.json`

### Extension Activation

The extension activates when:
- A workspace contains `docs/spec.schema.json`
- A Dalec-marked YAML file is opened
- One of the Dalec commands runs
- A `dalec-buildx` debug session starts

## Making Changes

### Code Style

- Follow TypeScript best practices
- Use the Errorable pattern for error handling (see `src/commands/utils/errorable.ts`)
- Use secure shell execution with array-based arguments (see `src/commands/utils/shell.ts`)
- Maintain type safety with strict TypeScript settings

### Adding New Features

1. Create your feature branch: `git checkout -b feature/my-new-feature`
2. Implement your changes following the project structure
3. Test thoroughly in the Extension Development Host
4. Update documentation as needed
5. Commit your changes with descriptive messages
6. Push to your fork and submit a pull request

### Security Considerations

- **Shell Injection Prevention**: Always use array-based arguments with `execFile()` or `execFileSync()` from `src/commands/utils/shell.ts`
- Never concatenate user input into shell commands
- Follow the security patterns documented in [REFACTORING_ERRORABLE.md](REFACTORING_ERRORABLE.md)

## Release Process

The project uses an automated CI/CD pipeline (`.github/workflows/publish.yml`) that:
1. Validates the build and version
2. Checks CHANGELOG.md for version documentation
3. Creates a GitHub release
4. Publishes to VS Code Marketplace
5. Attaches the VSIX artifact to the release

To prepare a release:
1. Update version in `package.json`
2. Document changes in `CHANGELOG.md`
3. Trigger the workflow manually via GitHub Actions

## Additional Resources

For information about the Dalec project itself, see the [Dalec Developer Guide](https://project-dalec.github.io/dalec/developers) for:
- Dalec architecture and design
- Building Dalec frontends
- Recommended dev/test workflows
- Using the Makefile for Dalec tasks
