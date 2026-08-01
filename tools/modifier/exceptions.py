class ModifierError(Exception):
    """Base exception for Atlas Modifier Engine."""


class UnsupportedTypeScriptImport(ModifierError):
    """Raised when an import statement cannot be safely parsed."""


class InvalidTypeScriptFile(ModifierError):
    """Raised when a target is not a valid TypeScript file."""
