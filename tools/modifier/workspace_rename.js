#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const ts = require('typescript');


function fail(message, details = null) {
  process.stdout.write(
    JSON.stringify(
      {
        ok: false,
        error: message,
        details,
      },
      null,
      2,
    ),
  );

  process.exit(1);
}


function normalizePath(value) {
  return path.resolve(value);
}


function isTypeScriptSource(filePath) {
  return (
    filePath.endsWith('.ts') ||
    filePath.endsWith('.tsx')
  ) && !filePath.endsWith('.d.ts');
}


function isInsideRoot(filePath, projectRoot) {
  const relative = path.relative(
    projectRoot,
    filePath,
  );

  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative)
  ) || filePath === projectRoot;
}


function collectSourceFiles(projectRoot) {
  const ignoredDirectories = new Set([
    '.git',
    '.next',
    '.turbo',
    '.atlas',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '__pycache__',
  ]);

  const files = [];

  function visit(directory) {
    for (
      const entry
      of fs.readdirSync(
        directory,
        {
          withFileTypes: true,
        },
      )
    ) {
      if (
        entry.isDirectory() &&
        ignoredDirectories.has(entry.name)
      ) {
        continue;
      }

      const absolutePath = path.join(
        directory,
        entry.name,
      );

      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }

      if (
        entry.isFile() &&
        isTypeScriptSource(absolutePath)
      ) {
        files.push(
          normalizePath(absolutePath),
        );
      }
    }
  }

  visit(projectRoot);

  files.sort();
  return files;
}


function loadProjectConfiguration(projectRoot) {
  const configPath = ts.findConfigFile(
    projectRoot,
    ts.sys.fileExists,
    'tsconfig.json',
  );

  if (!configPath) {
    return {
      configPath: null,
      fileNames: collectSourceFiles(
        projectRoot,
      ),
      options: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        moduleResolution:
          ts.ModuleResolutionKind.NodeJs,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        allowJs: false,
        skipLibCheck: true,
      },
      errors: [],
    };
  }

  const configFile = ts.readConfigFile(
    configPath,
    ts.sys.readFile,
  );

  if (configFile.error) {
    return {
      configPath,
      fileNames: [],
      options: {},
      errors: [configFile.error],
    };
  }

  const parsed = (
    ts.parseJsonConfigFileContent(
      configFile.config,
      ts.sys,
      path.dirname(configPath),
      undefined,
      configPath,
    )
  );

  const fileNames = parsed.fileNames
    .map(normalizePath)
    .filter(
      (filePath) =>
        isTypeScriptSource(filePath) &&
        isInsideRoot(
          filePath,
          projectRoot,
        ),
    );

  return {
    configPath,
    fileNames,
    options: parsed.options,
    errors: parsed.errors,
  };
}


function flattenDiagnostic(diagnostic) {
  return {
    code: diagnostic.code,
    category:
      ts.DiagnosticCategory[
        diagnostic.category
      ],
    message: ts.flattenDiagnosticMessageText(
      diagnostic.messageText,
      '\n',
    ),
    file:
      diagnostic.file
        ? diagnostic.file.fileName
        : null,
    start:
      diagnostic.start !== undefined
        ? diagnostic.start
        : null,
  };
}


function createWorkspaceLanguageService(
  projectRoot,
  configuration,
) {
  const versions = new Map();

  for (
    const fileName
    of configuration.fileNames
  ) {
    versions.set(fileName, '1');
  }

  const host = {
    getCompilationSettings() {
      return configuration.options;
    },

    getScriptFileNames() {
      return configuration.fileNames;
    },

    getScriptVersion(fileName) {
      return versions.get(
        normalizePath(fileName),
      ) || '1';
    },

    getScriptSnapshot(fileName) {
      if (!fs.existsSync(fileName)) {
        return undefined;
      }

      return ts.ScriptSnapshot.fromString(
        fs.readFileSync(
          fileName,
          'utf8',
        ),
      );
    },

    getCurrentDirectory() {
      return projectRoot;
    },

    getDefaultLibFileName(options) {
      return ts.getDefaultLibFilePath(
        options,
      );
    },

    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath:
      ts.sys.realpath
        ? ts.sys.realpath
        : undefined,

    useCaseSensitiveFileNames() {
      return ts.sys.useCaseSensitiveFileNames;
    },

    getNewLine() {
      return ts.sys.newLine;
    },
  };

  return ts.createLanguageService(
    host,
    ts.createDocumentRegistry(),
  );
}


function declarationNames(node) {
  const names = [];

  if (
    (
      ts.isClassDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) &&
    node.name
  ) {
    names.push(node.name);
  }

  if (ts.isVariableStatement(node)) {
    for (
      const declaration
      of node.declarationList.declarations
    ) {
      collectBindingIdentifiers(
        declaration.name,
        names,
      );
    }
  }

  return names;
}


function collectBindingIdentifiers(
  bindingName,
  output,
) {
  if (ts.isIdentifier(bindingName)) {
    output.push(bindingName);
    return;
  }

  for (
    const element
    of bindingName.elements
  ) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }

    collectBindingIdentifiers(
      element.name,
      output,
    );
  }
}


function findDeclarationPosition(
  targetFile,
  oldName,
) {
  const sourceText = fs.readFileSync(
    targetFile,
    'utf8',
  );

  const scriptKind = (
    targetFile.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS
  );

  const sourceFile = ts.createSourceFile(
    targetFile,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const matches = [];

  for (
    const statement
    of sourceFile.statements
  ) {
    for (
      const identifier
      of declarationNames(statement)
    ) {
      if (identifier.text === oldName) {
        matches.push(identifier);
      }
    }
  }

  if (matches.length === 0) {
    fail(
      `Declaration ${JSON.stringify(oldName)} ` +
      `was not found in ${targetFile}`,
    );
  }

  if (matches.length > 1) {
    fail(
      `More than one declaration named ` +
      `${JSON.stringify(oldName)} was found ` +
      `in ${targetFile}`,
    );
  }

  return matches[0].getStart(
    sourceFile,
  );
}


function groupRenameLocations(
  locations,
  projectRoot,
  newName,
) {
  const grouped = new Map();

  for (const location of locations) {
    const absolutePath = normalizePath(
      location.fileName,
    );

    if (
      !isInsideRoot(
        absolutePath,
        projectRoot,
      )
    ) {
      continue;
    }

    const relativePath = path
      .relative(
        projectRoot,
        absolutePath,
      )
      .split(path.sep)
      .join('/');

    if (!grouped.has(relativePath)) {
      grouped.set(relativePath, []);
    }

    const prefix = (
      location.prefixText || ''
    );

    const suffix = (
      location.suffixText || ''
    );

    grouped.get(relativePath).push({
      start: location.textSpan.start,
      end:
        location.textSpan.start +
        location.textSpan.length,
      text:
        prefix +
        newName +
        suffix,
      prefix,
      suffix,
    });
  }

  return Array.from(
    grouped.entries(),
  )
    .sort(
      ([left], [right]) =>
        left.localeCompare(right),
    )
    .map(
      ([filePath, edits]) => ({
        filePath,
        edits: edits.sort(
          (left, right) =>
            left.start - right.start,
        ),
      }),
    );
}


function workspaceRename(
  projectRoot,
  targetFile,
  oldName,
  newName,
) {
  const resolvedRoot = normalizePath(
    projectRoot,
  );

  const resolvedTarget = normalizePath(
    path.isAbsolute(targetFile)
      ? targetFile
      : path.join(
          resolvedRoot,
          targetFile,
        ),
  );

  if (!fs.existsSync(resolvedRoot)) {
    fail(
      `Project root does not exist: ` +
      `${resolvedRoot}`,
    );
  }

  if (
    !fs.statSync(resolvedRoot)
      .isDirectory()
  ) {
    fail(
      `Project root is not a directory: ` +
      `${resolvedRoot}`,
    );
  }

  if (
    !isInsideRoot(
      resolvedTarget,
      resolvedRoot,
    )
  ) {
    fail(
      `Target file escapes project root: ` +
      `${targetFile}`,
    );
  }

  if (!fs.existsSync(resolvedTarget)) {
    fail(
      `Target file does not exist: ` +
      `${resolvedTarget}`,
    );
  }

  if (!isTypeScriptSource(resolvedTarget)) {
    fail(
      `Target file must be .ts or .tsx: ` +
      `${resolvedTarget}`,
    );
  }

  const configuration = (
    loadProjectConfiguration(
      resolvedRoot,
    )
  );

  if (configuration.errors.length > 0) {
    fail(
      'TypeScript project configuration failed',
      configuration.errors.map(
        flattenDiagnostic,
      ),
    );
  }

  if (
    !configuration.fileNames.includes(
      resolvedTarget,
    )
  ) {
    configuration.fileNames.push(
      resolvedTarget,
    );
    configuration.fileNames.sort();
  }

  const languageService = (
    createWorkspaceLanguageService(
      resolvedRoot,
      configuration,
    )
  );

  const position = findDeclarationPosition(
    resolvedTarget,
    oldName,
  );

  const renameInfo = (
    languageService.getRenameInfo(
      resolvedTarget,
      position,
      {
        allowRenameOfImportPath: false,
      },
    )
  );

  if (!renameInfo.canRename) {
    fail(
      renameInfo.localizedErrorMessage ||
      `Symbol ${JSON.stringify(oldName)} ` +
      `cannot be renamed`,
    );
  }

  const locations = (
    languageService.findRenameLocations(
      resolvedTarget,
      position,
      false,
      false,
      true,
    ) || []
  );

  if (locations.length === 0) {
    fail(
      `No rename locations were found for ` +
      `${JSON.stringify(oldName)}`,
    );
  }

  const files = groupRenameLocations(
    locations,
    resolvedRoot,
    newName,
  );

  return {
    ok: true,
    schemaVersion: 1,
    projectRoot: resolvedRoot,
    configPath:
      configuration.configPath,
    targetFile: path
      .relative(
        resolvedRoot,
        resolvedTarget,
      )
      .split(path.sep)
      .join('/'),
    oldName,
    newName,
    totalLocations:
      locations.length,
    totalFiles: files.length,
    files,
  };
}


const [
  projectRoot,
  targetFile,
  oldName,
  newName,
] = process.argv.slice(2);

if (
  !projectRoot ||
  !targetFile ||
  !oldName ||
  !newName
) {
  fail(
    'Usage: node workspace_rename.js ' +
    '<project-root> <target-file> ' +
    '<old-name> <new-name>',
  );
}

try {
  process.stdout.write(
    JSON.stringify(
      workspaceRename(
        projectRoot,
        targetFile,
        oldName,
        newName,
      ),
      null,
      2,
    ),
  );
} catch (error) {
  fail(
    error instanceof Error
      ? error.message
      : String(error),
  );
}
