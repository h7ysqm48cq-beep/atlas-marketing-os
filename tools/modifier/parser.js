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

function position(sourceFile, node) {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();

  const startLocation = sourceFile.getLineAndCharacterOfPosition(start);
  const endLocation = sourceFile.getLineAndCharacterOfPosition(end);

  return {
    start,
    end,
    startLine: startLocation.line + 1,
    startColumn: startLocation.character + 1,
    endLine: endLocation.line + 1,
    endColumn: endLocation.character + 1,
  };
}

function modifierNames(node) {
  if (!node.modifiers) {
    return [];
  }

  return node.modifiers.map((modifier) =>
    ts.tokenToString(modifier.kind) || ts.SyntaxKind[modifier.kind],
  );
}

function decoratorNames(node) {
  const decorators = ts.canHaveDecorators(node)
    ? ts.getDecorators(node) || []
    : [];

  return decorators.map((decorator) => {
    const expression = decorator.expression;

    if (ts.isCallExpression(expression)) {
      return expression.expression.getText();
    }

    return expression.getText();
  });
}

function parameterInfo(sourceFile, parameter) {
  return {
    name: parameter.name.getText(sourceFile),
    type: parameter.type
      ? parameter.type.getText(sourceFile)
      : null,
    optional: Boolean(parameter.questionToken),
    rest: Boolean(parameter.dotDotDotToken),
    initializer: parameter.initializer
      ? parameter.initializer.getText(sourceFile)
      : null,
    modifiers: modifierNames(parameter),
    decorators: decoratorNames(parameter),
    ...position(sourceFile, parameter),
  };
}

function importInfo(sourceFile, node) {
  const clause = node.importClause;
  const namedBindings =
    clause && clause.namedBindings
      ? clause.namedBindings
      : null;

  const moduleText = node.moduleSpecifier.getText(sourceFile);
  const quoteStyle = moduleText.startsWith('"')
    ? '"'
    : "'";

  return {
    module: node.moduleSpecifier.text,
    quoteStyle,
    sideEffectOnly: !clause,
    defaultImport:
      clause && clause.name
        ? clause.name.text
        : null,
    namespaceImport:
      namedBindings &&
      ts.isNamespaceImport(namedBindings)
        ? namedBindings.name.text
        : null,
    namedImports:
      namedBindings &&
      ts.isNamedImports(namedBindings)
        ? namedBindings.elements.map((element) => ({
            imported: element.propertyName
              ? element.propertyName.text
              : element.name.text,
            local: element.name.text,
            typeOnly: Boolean(element.isTypeOnly),
            ...position(sourceFile, element),
          }))
        : [],
    typeOnly: Boolean(clause && clause.isTypeOnly),
    importClauseStart: clause
      ? clause.getStart(sourceFile)
      : null,
    importClauseEnd: clause
      ? clause.getEnd()
      : null,
    namedBindingsStart: namedBindings
      ? namedBindings.getStart(sourceFile)
      : null,
    namedBindingsEnd: namedBindings
      ? namedBindings.getEnd()
      : null,
    moduleSpecifierStart:
      node.moduleSpecifier.getStart(sourceFile),
    moduleSpecifierEnd:
      node.moduleSpecifier.getEnd(),
    ...position(sourceFile, node),
  };
}

function exportInfo(sourceFile, node) {
  const exportClause = node.exportClause;
  const moduleSpecifier = node.moduleSpecifier;
  const moduleText = moduleSpecifier
    ? moduleSpecifier.getText(sourceFile)
    : null;

  const quoteStyle =
    moduleText && moduleText.startsWith('"')
      ? '"'
      : "'";

  const namedExports =
    exportClause &&
    ts.isNamedExports(exportClause)
      ? exportClause.elements.map((element) => ({
          local: element.propertyName
            ? element.propertyName.text
            : element.name.text,
          exported: element.name.text,
          typeOnly: Boolean(element.isTypeOnly),
          ...position(sourceFile, element),
        }))
      : [];

  const namespaceExport =
    exportClause &&
    ts.isNamespaceExport(exportClause)
      ? exportClause.name.text
      : null;

  return {
    module: moduleSpecifier
      ? moduleSpecifier.text
      : null,
    quoteStyle,
    exportAll:
      exportClause === undefined ||
      exportClause === null,
    namespaceExport,
    namedExports,
    typeOnly: Boolean(node.isTypeOnly),
    exportClauseStart: exportClause
      ? exportClause.getStart(sourceFile)
      : null,
    exportClauseEnd: exportClause
      ? exportClause.getEnd()
      : null,
    moduleSpecifierStart: moduleSpecifier
      ? moduleSpecifier.getStart(sourceFile)
      : null,
    moduleSpecifierEnd: moduleSpecifier
      ? moduleSpecifier.getEnd()
      : null,
    ...position(sourceFile, node),
  };
}

function hasModifier(node, kind) {
  return Boolean(
    node.modifiers &&
      node.modifiers.some(
        (modifier) => modifier.kind === kind,
      ),
  );
}

function bindingNames(name, sourceFile) {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }

  if (
    ts.isObjectBindingPattern(name) ||
    ts.isArrayBindingPattern(name)
  ) {
    const names = [];

    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }

      names.push(
        ...bindingNames(
          element.name,
          sourceFile,
        ),
      );
    }

    return names;
  }

  return [
    name.getText(sourceFile),
  ];
}

function declarationModifiers(node) {
  if (
    typeof ts.canHaveModifiers === 'function' &&
    typeof ts.getModifiers === 'function' &&
    ts.canHaveModifiers(node)
  ) {
    return ts.getModifiers(node) || [];
  }

  return (node.modifiers || []).filter(
    (modifier) =>
      modifier.kind !== ts.SyntaxKind.Decorator,
  );
}

function declarationKeywordStart(
  sourceFile,
  node,
) {
  if (ts.isVariableStatement(node)) {
    return node.declarationList.getStart(
      sourceFile,
    );
  }

  let keywordKind = null;

  if (ts.isClassDeclaration(node)) {
    keywordKind = ts.SyntaxKind.ClassKeyword;
  } else if (
    ts.isFunctionDeclaration(node)
  ) {
    keywordKind = ts.SyntaxKind.FunctionKeyword;
  } else if (
    ts.isInterfaceDeclaration(node)
  ) {
    keywordKind = ts.SyntaxKind.InterfaceKeyword;
  } else if (
    ts.isTypeAliasDeclaration(node)
  ) {
    keywordKind = ts.SyntaxKind.TypeKeyword;
  } else if (
    ts.isEnumDeclaration(node)
  ) {
    keywordKind = ts.SyntaxKind.EnumKeyword;
  }

  if (keywordKind === null) {
    return node.getStart(sourceFile);
  }

  const keyword = node
    .getChildren(sourceFile)
    .find(
      (child) => child.kind === keywordKind,
    );

  return keyword
    ? keyword.getStart(sourceFile)
    : node.getStart(sourceFile);
}

function modifierPosition(
  sourceFile,
  modifiers,
  kind,
) {
  const modifier = modifiers.find(
    (item) => item.kind === kind,
  );

  if (!modifier) {
    return {
      start: null,
      end: null,
    };
  }

  return {
    start: modifier.getStart(sourceFile),
    end: modifier.getEnd(),
  };
}

function expandedStatementRemovalRange(
  sourceFile,
  start,
  end,
) {
  const text = sourceFile.text;

  let lineStart = start;

  while (
    lineStart > 0 &&
    text[lineStart - 1] !== '\n' &&
    text[lineStart - 1] !== '\r'
  ) {
    lineStart -= 1;
  }

  let lineEnd = end;

  while (
    lineEnd < text.length &&
    text[lineEnd] !== '\n' &&
    text[lineEnd] !== '\r'
  ) {
    lineEnd += 1;
  }

  const before = text.slice(
    lineStart,
    start,
  );

  const after = text.slice(
    end,
    lineEnd,
  );

  if (
    before.trim() === '' &&
    after.trim() === ''
  ) {
    if (
      text[lineEnd] === '\r' &&
      text[lineEnd + 1] === '\n'
    ) {
      lineEnd += 2;
    } else if (
      text[lineEnd] === '\r' ||
      text[lineEnd] === '\n'
    ) {
      lineEnd += 1;
    }

    /*
     * When the declaration is surrounded by blank
     * lines, deleting only its own line would leave
     * two consecutive blank lines.
     *
     * Consume at most one immediately following
     * blank line. This also prevents a leading blank
     * line when removing the first declaration.
     */
    let nextLineEnd = lineEnd;

    while (
      nextLineEnd < text.length &&
      text[nextLineEnd] !== '\n' &&
      text[nextLineEnd] !== '\r'
    ) {
      nextLineEnd += 1;
    }

    const nextLine = text.slice(
      lineEnd,
      nextLineEnd,
    );

    if (nextLine.trim() === '') {
      if (
        text[nextLineEnd] === '\r' &&
        text[nextLineEnd + 1] === '\n'
      ) {
        nextLineEnd += 2;
      } else if (
        text[nextLineEnd] === '\r' ||
        text[nextLineEnd] === '\n'
      ) {
        nextLineEnd += 1;
      }

      lineEnd = nextLineEnd;
    }

    return {
      start: lineStart,
      end: lineEnd,
    };
  }

  return {
    start,
    end,
  };
}

function variableDeclaratorInfos(
  sourceFile,
  node,
) {
  if (!ts.isVariableStatement(node)) {
    return [];
  }

  const declarations =
    node.declarationList.declarations;

  const statementRange =
    expandedStatementRemovalRange(
      sourceFile,
      node.getStart(sourceFile),
      node.getEnd(),
    );

  return declarations.map(
    (declaration, index) => {
      let removalStart;
      let removalEnd;

      if (declarations.length === 1) {
        removalStart =
          statementRange.start;
        removalEnd =
          statementRange.end;
      } else if (
        index < declarations.length - 1
      ) {
        removalStart =
          declaration.getStart(sourceFile);

        removalEnd =
          declarations[
            index + 1
          ].getStart(sourceFile);
      } else {
        removalStart =
          declarations[
            index - 1
          ].getEnd();

        removalEnd =
          declaration.getEnd();
      }

      return {
        names: bindingNames(
          declaration.name,
          sourceFile,
        ),

        /*
         * A destructuring declaration may expose
         * only one binding name, for example:
         *
         *   const { beta } = source;
         *
         * Therefore names.length alone cannot
         * distinguish it from:
         *
         *   const beta = source;
         */
        destructuring:
          !ts.isIdentifier(
            declaration.name,
          ),

        start:
          declaration.getStart(sourceFile),
        end: declaration.getEnd(),
        removalStart,
        removalEnd,
      };
    },
  );
}

function declarationInfo(
  sourceFile,
  node,
) {
  const exported = hasModifier(
    node,
    ts.SyntaxKind.ExportKeyword,
  );

  const isDefault = hasModifier(
    node,
    ts.SyntaxKind.DefaultKeyword,
  );

  const modifiers = declarationModifiers(
    node,
  );

  const keywordStart = declarationKeywordStart(
    sourceFile,
    node,
  );

  const modifierStart =
    modifiers.length > 0
      ? modifiers[0].getStart(sourceFile)
      : keywordStart;

  const exportPosition = modifierPosition(
    sourceFile,
    modifiers,
    ts.SyntaxKind.ExportKeyword,
  );

  const defaultPosition = modifierPosition(
    sourceFile,
    modifiers,
    ts.SyntaxKind.DefaultKeyword,
  );

  let kind = null;
  let name = null;
  let names = [];
  let typeOnly = false;
  let variableDeclarators = [];

  if (ts.isClassDeclaration(node)) {
    kind = 'class';
    name = node.name
      ? node.name.text
      : null;
    names = name
      ? [name]
      : [];
  } else if (
    ts.isFunctionDeclaration(node)
  ) {
    kind = 'function';
    name = node.name
      ? node.name.text
      : null;
    names = name
      ? [name]
      : [];
  } else if (
    ts.isVariableStatement(node)
  ) {
    kind = 'variable';

    names = node.declarationList
      .declarations
      .flatMap((declaration) =>
        bindingNames(
          declaration.name,
          sourceFile,
        ),
      );

    name =
      names.length === 1
        ? names[0]
        : null;

    variableDeclarators =
      variableDeclaratorInfos(
        sourceFile,
        node,
      );
  } else if (
    ts.isInterfaceDeclaration(node)
  ) {
    kind = 'interface';
    name = node.name.text;
    names = [name];
    typeOnly = true;
  } else if (
    ts.isTypeAliasDeclaration(node)
  ) {
    kind = 'type';
    name = node.name.text;
    names = [name];
    typeOnly = true;
  } else if (
    ts.isEnumDeclaration(node)
  ) {
    kind = 'enum';
    name = node.name.text;
    names = [name];
  } else {
    return null;
  }

  const statementRemovalRange =
    expandedStatementRemovalRange(
      sourceFile,
      node.getStart(sourceFile),
      node.getEnd(),
    );

  return {
    kind,
    name,
    names,
    variableDeclarators,
    removalStart:
      statementRemovalRange.start,
    removalEnd:
      statementRemovalRange.end,
    exported,
    default: isDefault,
    typeOnly,
    modifiers: modifierNames(node),
    modifierStart,
    keywordStart,
    exportModifierStart:
      exportPosition.start,
    exportModifierEnd:
      exportPosition.end,
    defaultModifierStart:
      defaultPosition.start,
    defaultModifierEnd:
      defaultPosition.end,
    declarationStart:
      node.getStart(sourceFile),
    declarationEnd:
      node.getEnd(),
    ...position(sourceFile, node),
  };
}

function memberVisibility(node) {
  if (
    hasModifier(
      node,
      ts.SyntaxKind.PrivateKeyword,
    )
  ) {
    return 'private';
  }

  if (
    hasModifier(
      node,
      ts.SyntaxKind.ProtectedKeyword,
    )
  ) {
    return 'protected';
  }

  if (
    hasModifier(
      node,
      ts.SyntaxKind.PublicKeyword,
    )
  ) {
    return 'public';
  }

  /*
   * TypeScript class members are public by
   * default when no visibility modifier is
   * explicitly present.
   */
  return 'public';
}

function memberNameInfo(
  sourceFile,
  node,
) {
  if (!node.name) {
    return {
      name: null,
      identifierStart: null,
      identifierEnd: null,
      computed: false,
    };
  }

  const computed =
    ts.isComputedPropertyName(node.name);

  if (computed) {
    return {
      name: node.name.getText(sourceFile),
      identifierStart:
        node.name.getStart(sourceFile),
      identifierEnd:
        node.name.getEnd(),
      computed: true,
    };
  }

  return {
    name: node.name.getText(sourceFile),
    identifierStart:
      node.name.getStart(sourceFile),
    identifierEnd:
      node.name.getEnd(),
    computed: false,
  };
}

function memberRemovalRange(
  sourceFile,
  node,
) {
  return expandedStatementRemovalRange(
    sourceFile,
    node.getStart(sourceFile),
    node.getEnd(),
  );
}

function classMemberKind(node) {
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }

  if (ts.isMethodDeclaration(node)) {
    return 'method';
  }

  if (ts.isPropertyDeclaration(node)) {
    return 'property';
  }

  if (ts.isGetAccessorDeclaration(node)) {
    return 'getter';
  }

  if (ts.isSetAccessorDeclaration(node)) {
    return 'setter';
  }

  return null;
}

function classMemberInfo(
  sourceFile,
  node,
) {
  const kind = classMemberKind(node);

  if (kind === null) {
    return null;
  }

  const nameInfo =
    kind === 'constructor'
      ? {
          name: 'constructor',
          identifierStart: null,
          identifierEnd: null,
          computed: false,
        }
      : memberNameInfo(
          sourceFile,
          node,
        );

  const removalRange =
    memberRemovalRange(
      sourceFile,
      node,
    );

  const parameters =
    'parameters' in node &&
    node.parameters
      ? node.parameters.map((parameter) =>
          parameterInfo(
            sourceFile,
            parameter,
          ),
        )
      : [];

  return {
    kind,
    name: nameInfo.name,

    identifierStart:
      nameInfo.identifierStart,
    identifierEnd:
      nameInfo.identifierEnd,

    computed: nameInfo.computed,

    memberStart:
      node.getStart(sourceFile),
    memberEnd:
      node.getEnd(),

    removalStart:
      removalRange.start,
    removalEnd:
      removalRange.end,

    parameters,
    parameterCount: parameters.length,

    returnType:
      node.type
        ? node.type.getText(sourceFile)
        : null,

    type:
      ts.isPropertyDeclaration(node) &&
      node.type
        ? node.type.getText(sourceFile)
        : null,

    initializer:
      ts.isPropertyDeclaration(node) &&
      node.initializer
        ? node.initializer.getText(sourceFile)
        : null,

    modifiers: modifierNames(node),
    decorators: decoratorNames(node),

    static: hasModifier(
      node,
      ts.SyntaxKind.StaticKeyword,
    ),

    async: hasModifier(
      node,
      ts.SyntaxKind.AsyncKeyword,
    ),

    abstract: hasModifier(
      node,
      ts.SyntaxKind.AbstractKeyword,
    ),

    readonly: hasModifier(
      node,
      ts.SyntaxKind.ReadonlyKeyword,
    ),

    declare: hasModifier(
      node,
      ts.SyntaxKind.DeclareKeyword,
    ),

    override: hasModifier(
      node,
      ts.SyntaxKind.OverrideKeyword,
    ),

    optional: Boolean(
      node.questionToken,
    ),

    visibility: memberVisibility(node),

    bodyStart:
      node.body
        ? node.body.getStart(sourceFile)
        : null,

    bodyEnd:
      node.body
        ? node.body.getEnd()
        : null,

    ...position(sourceFile, node),
  };
}

function constructorInfo(sourceFile, node) {
  return {
    parameters: node.parameters.map((parameter) =>
      parameterInfo(sourceFile, parameter),
    ),
    parameterCount: node.parameters.length,
    modifiers: modifierNames(node),
    decorators: decoratorNames(node),
    bodyStart: node.body
      ? node.body.getStart(sourceFile)
      : null,
    bodyEnd: node.body
      ? node.body.getEnd()
      : null,
    ...position(sourceFile, node),
  };
}

function methodInfo(sourceFile, node) {
  return {
    name: node.name
      ? node.name.getText(sourceFile)
      : null,
    parameters: node.parameters.map((parameter) =>
      parameterInfo(sourceFile, parameter),
    ),
    returnType: node.type
      ? node.type.getText(sourceFile)
      : null,
    modifiers: modifierNames(node),
    decorators: decoratorNames(node),
    async: Boolean(
      node.modifiers &&
        node.modifiers.some(
          (modifier) =>
            modifier.kind === ts.SyntaxKind.AsyncKeyword,
        ),
    ),
    ...position(sourceFile, node),
  };
}

function classInfo(sourceFile, node) {
  const constructors = [];
  const methods = [];
  const members = [];

  for (const member of node.members) {
    const info = classMemberInfo(
      sourceFile,
      member,
    );

    if (info !== null) {
      members.push(info);
    }

    /*
     * Preserve the original constructor/method
     * arrays so existing Python APIs remain
     * backward compatible.
     */
    if (
      ts.isConstructorDeclaration(member)
    ) {
      constructors.push(
        constructorInfo(
          sourceFile,
          member,
        ),
      );
    }

    if (ts.isMethodDeclaration(member)) {
      methods.push(
        methodInfo(
          sourceFile,
          member,
        ),
      );
    }
  }

  const name = node.name
    ? node.name.text
    : null;

  return {
    name,

    identifierStart:
      node.name
        ? node.name.getStart(sourceFile)
        : null,

    identifierEnd:
      node.name
        ? node.name.getEnd()
        : null,

    modifiers: modifierNames(node),
    decorators: decoratorNames(node),

    constructors,
    methods,
    members,

    memberCount: members.length,

    classStart:
      node.getStart(sourceFile),

    classEnd:
      node.getEnd(),

    ...position(sourceFile, node),
  };
}


function bindingIdentifierNodes(name) {
  if (ts.isIdentifier(name)) {
    return [name];
  }

  if (
    ts.isObjectBindingPattern(name) ||
    ts.isArrayBindingPattern(name)
  ) {
    const identifiers = [];

    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }

      identifiers.push(
        ...bindingIdentifierNodes(
          element.name,
        ),
      );
    }

    return identifiers;
  }

  return [];
}

function declarationSymbolNodes(node) {
  if (
    ts.isClassDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name
      ? [node.name]
      : [];
  }

  if (ts.isVariableStatement(node)) {
    return node.declarationList
      .declarations
      .flatMap((declaration) =>
        bindingIdentifierNodes(
          declaration.name,
        ),
      );
  }

  return [];
}

function createRenameLanguageService(
  fileName,
  sourceText,
  scriptKind,
) {
  const compilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.CommonJS,
    moduleResolution:
      ts.ModuleResolutionKind.NodeJs,
    jsx:
      scriptKind === ts.ScriptKind.TSX
        ? ts.JsxEmit.ReactJSX
        : ts.JsxEmit.None,
    allowJs: false,
    checkJs: false,
    strict: false,
    skipLibCheck: true,
  };

  const normalizedFileName =
    path.resolve(fileName);

  const host = {
    getCompilationSettings() {
      return compilerOptions;
    },

    getScriptFileNames() {
      return [normalizedFileName];
    },

    getScriptVersion() {
      return '1';
    },

    getScriptSnapshot(requestedFileName) {
      const normalizedRequested =
        path.resolve(requestedFileName);

      if (
        normalizedRequested ===
        normalizedFileName
      ) {
        return ts.ScriptSnapshot.fromString(
          sourceText,
        );
      }

      if (!ts.sys.fileExists(requestedFileName)) {
        return undefined;
      }

      const content = ts.sys.readFile(
        requestedFileName,
      );

      return content === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(
            content,
          );
    },

    getCurrentDirectory() {
      return path.dirname(
        normalizedFileName,
      );
    },

    getDefaultLibFileName(options) {
      return ts.getDefaultLibFilePath(
        options,
      );
    },

    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists:
      ts.sys.directoryExists,
    getDirectories:
      ts.sys.getDirectories,
  };

  return ts.createLanguageService(
    host,
    ts.createDocumentRegistry(),
  );
}

function renameSymbolInfo(
  sourceFile,
  languageService,
  fileName,
  declaration,
  identifier,
) {
  const position = identifier.getStart(
    sourceFile,
  );

  const renameInfo =
    languageService.getRenameInfo(
      fileName,
      position,
      {
        allowRenameOfImportPath: false,
      },
    );

  if (!renameInfo.canRename) {
    return null;
  }

  const locations =
    languageService.findRenameLocations(
      fileName,
      position,
      false,
      false,
      false,
    ) || [];

  const normalizedFileName =
    path.resolve(fileName);

  const occurrences = locations
    .filter(
      (location) =>
        path.resolve(location.fileName) ===
        normalizedFileName,
    )
    .map((location) => ({
      start: location.textSpan.start,
      end:
        location.textSpan.start +
        location.textSpan.length,
      prefixText:
        location.prefixText || '',
      suffixText:
        location.suffixText || '',
    }))
    .sort(
      (left, right) =>
        left.start - right.start,
    );

  return {
    name: identifier.text,
    kind: declaration.kind,
    declarationStart:
      declaration.declarationStart,
    declarationEnd:
      declaration.declarationEnd,
    identifierStart:
      identifier.getStart(sourceFile),
    identifierEnd:
      identifier.getEnd(),
    occurrences,
  };
}

function memberRenameSymbolInfo(
  sourceFile,
  languageService,
  fileName,
  classNode,
  member,
) {
  if (
    !classNode.name ||
    !ts.isIdentifier(classNode.name)
  ) {
    return null;
  }

  if (
    ts.isConstructorDeclaration(member) ||
    !member.name ||
    !ts.isIdentifier(member.name)
  ) {
    return null;
  }

  const descriptor = {
    kind: classMemberKind(member),
    declarationStart:
      member.getStart(sourceFile),
    declarationEnd:
      member.getEnd(),
  };

  const symbol = renameSymbolInfo(
    sourceFile,
    languageService,
    fileName,
    descriptor,
    member.name,
  );

  if (!symbol) {
    return null;
  }

  return {
    ...symbol,
    className: classNode.name.text,
    memberStart:
      member.getStart(sourceFile),
    memberEnd:
      member.getEnd(),
  };
}


function parseFile(filePath) {
  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    fail(`File does not exist: ${absolutePath}`);
  }

  const sourceText = fs.readFileSync(absolutePath, 'utf8');

  const scriptKind = absolutePath.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS;

  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );

  const imports = [];
  const exports = [];
  const declarations = [];
  const exportedDeclarations = [];
  const renameSymbols = [];
  const memberRenameSymbols = [];
  const classes = [];

  const languageService =
    createRenameLanguageService(
      absolutePath,
      sourceText,
      scriptKind,
    );

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      imports.push(importInfo(sourceFile, statement));
    }

    if (ts.isExportDeclaration(statement)) {
      exports.push(exportInfo(sourceFile, statement));
    }

    const declaration = declarationInfo(
      sourceFile,
      statement,
    );

    if (declaration) {
      declarations.push(
        declaration,
      );

      if (declaration.exported) {
        exportedDeclarations.push(
          declaration,
        );
      }

      for (
        const identifier
        of declarationSymbolNodes(statement)
      ) {
        const renameSymbol =
          renameSymbolInfo(
            sourceFile,
            languageService,
            absolutePath,
            declaration,
            identifier,
          );

        if (renameSymbol) {
          renameSymbols.push(
            renameSymbol,
          );
        }
      }
    }

    if (ts.isClassDeclaration(statement)) {
      classes.push(
        classInfo(
          sourceFile,
          statement,
        ),
      );

      for (const member of statement.members) {
        const renameSymbol =
          memberRenameSymbolInfo(
            sourceFile,
            languageService,
            absolutePath,
            statement,
            member,
          );

        if (renameSymbol) {
          memberRenameSymbols.push(
            renameSymbol,
          );
        }
      }
    }
  }

  const diagnostics = sourceFile.parseDiagnostics.map((diagnostic) => {
    const location =
      diagnostic.start !== undefined
        ? sourceFile.getLineAndCharacterOfPosition(
            diagnostic.start,
          )
        : null;

    return {
      code: diagnostic.code,
      category: ts.DiagnosticCategory[diagnostic.category],
      message: ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        '\n',
      ),
      line: location ? location.line + 1 : null,
      column: location ? location.character + 1 : null,
    };
  });

  return {
    ok: diagnostics.length === 0,
    schemaVersion: 9,
    file: {
      path: absolutePath,
      size: Buffer.byteLength(sourceText, 'utf8'),
      lineCount: sourceFile.getLineAndCharacterOfPosition(
        sourceText.length,
      ).line + 1,
    },
    imports,
    exports,
    declarations,
    exportedDeclarations,
    renameSymbols,
    memberRenameSymbols,
    classes,
    diagnostics,
    statistics: {
      imports: imports.length,
      exports: exports.length,
      declarations: declarations.length,
      renameSymbols: renameSymbols.length,
      memberRenameSymbols:
        memberRenameSymbols.length,
      exportedDeclarations:
        exportedDeclarations.length,
      classes: classes.length,
      constructors: classes.reduce(
        (total, item) => total + item.constructors.length,
        0,
      ),
      methods: classes.reduce(
        (total, item) => total + item.methods.length,
        0,
      ),
    },
  };
}

const filePath = process.argv[2];

if (!filePath) {
  fail('Usage: node parser.js <typescript-file>');
}

try {
  const result = parseFile(filePath);
  process.stdout.write(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
} catch (error) {
  fail(
    error instanceof Error
      ? error.message
      : String(error),
    error instanceof Error
      ? error.stack
      : null,
  );
}
