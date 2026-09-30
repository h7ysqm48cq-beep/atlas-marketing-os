from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from tools.ir.action import CreateFile


class CRUDGenerationError(RuntimeError):
    """Raised when CRUD files cannot be generated."""


@dataclass(
    slots=True,
    frozen=True,
)
class CRUDFile:
    path: str
    content: str


@dataclass(
    slots=True,
    frozen=True,
)
class CRUDPlan:
    resource_name: str
    resource_class: str
    files: tuple[CRUDFile, ...]


class CRUDGenerator:
    def __init__(
        self,
        project_root: str | Path,
    ) -> None:
        self.project_root = Path(
            project_root
        ).expanduser().resolve()

    def plan(
        self,
        resource_name: str,
    ) -> CRUDPlan:
        normalized = self._normalize_resource(
            resource_name
        )

        resource_class = self._pascal_case(
            normalized
        )

        base = f"src/{normalized}"

        files = (
            CRUDFile(
                path=(
                    f"{base}/"
                    f"{normalized}.service.ts"
                ),
                content=self._service_source(
                    normalized,
                    resource_class,
                ),
            ),
            CRUDFile(
                path=(
                    f"{base}/"
                    f"{normalized}.controller.ts"
                ),
                content=self._controller_source(
                    normalized,
                    resource_class,
                ),
            ),
            CRUDFile(
                path=(
                    f"{base}/"
                    f"{normalized}.module.ts"
                ),
                content=self._module_source(
                    normalized,
                    resource_class,
                ),
            ),
        )

        return CRUDPlan(
            resource_name=normalized,
            resource_class=resource_class,
            files=files,
        )

    @staticmethod
    def build_actions(
        plan: CRUDPlan,
    ) -> tuple[CreateFile, ...]:
        return tuple(
            CreateFile(
                file_path=file.path,
                content=file.content,
                overwrite=False,
            )
            for file in plan.files
        )

    def apply(
        self,
        plan: CRUDPlan,
        *,
        dry_run: bool = False,
    ) -> tuple[str, ...]:
        changed: list[str] = []

        for file in plan.files:
            target = (
                self.project_root
                / file.path
            ).resolve()

            try:
                target.relative_to(
                    self.project_root
                )
            except ValueError as error:
                raise CRUDGenerationError(
                    "Generated file escapes "
                    "project root"
                ) from error

            if target.exists():
                existing = target.read_text(
                    encoding="utf-8",
                )

                if existing == file.content:
                    continue

                raise CRUDGenerationError(
                    f"Refusing to overwrite "
                    f"existing file: {file.path}"
                )

            changed.append(file.path)

            if dry_run:
                continue

            target.parent.mkdir(
                parents=True,
                exist_ok=True,
            )

            target.write_text(
                file.content,
                encoding="utf-8",
            )

        return tuple(changed)

    @staticmethod
    def _normalize_resource(
        value: str,
    ) -> str:
        if not isinstance(value, str):
            raise TypeError(
                "resource_name must be a string"
            )

        normalized = value.strip().lower()

        normalized = re.sub(
            r"[^a-z0-9]+",
            "-",
            normalized,
        ).strip("-")

        if not normalized:
            raise CRUDGenerationError(
                "resource_name cannot be empty"
            )

        return normalized

    @staticmethod
    def _pascal_case(
        value: str,
    ) -> str:
        return "".join(
            part.capitalize()
            for part in value.split("-")
            if part
        )

    @staticmethod
    def _service_source(
        resource_name: str,
        resource_class: str,
    ) -> str:
        return (
            "import { Injectable } "
            "from '@nestjs/common';\n"
            "\n"
            "@Injectable()\n"
            f"export class {resource_class}Service {{\n"
            "  findAll() {\n"
            "    return [];\n"
            "  }\n"
            "\n"
            "  findOne(id: string) {\n"
            "    return { id };\n"
            "  }\n"
            "}\n"
        )

    @staticmethod
    def _controller_source(
        resource_name: str,
        resource_class: str,
    ) -> str:
        return (
            "import { Controller, Get, Param } "
            "from '@nestjs/common';\n"
            f"import {{ {resource_class}Service }} "
            f"from './{resource_name}.service';\n"
            "\n"
            f"@Controller('{resource_name}')\n"
            f"export class {resource_class}Controller {{\n"
            "  constructor(\n"
            f"    private readonly "
            f"{resource_name}Service: "
            f"{resource_class}Service,\n"
            "  ) {}\n"
            "\n"
            "  @Get()\n"
            "  findAll() {\n"
            f"    return this.{resource_name}Service"
            ".findAll();\n"
            "  }\n"
            "\n"
            "  @Get(':id')\n"
            "  findOne(\n"
            "    @Param('id') id: string,\n"
            "  ) {\n"
            f"    return this.{resource_name}Service"
            ".findOne(id);\n"
            "  }\n"
            "}\n"
        )

    @staticmethod
    def _module_source(
        resource_name: str,
        resource_class: str,
    ) -> str:
        return (
            "import { Module } "
            "from '@nestjs/common';\n"
            f"import {{ {resource_class}Controller }} "
            f"from './{resource_name}.controller';\n"
            f"import {{ {resource_class}Service }} "
            f"from './{resource_name}.service';\n"
            "\n"
            "@Module({\n"
            f"  controllers: "
            f"[{resource_class}Controller],\n"
            f"  providers: "
            f"[{resource_class}Service],\n"
            f"  exports: "
            f"[{resource_class}Service],\n"
            "})\n"
            f"export class {resource_class}Module {{}}\n"
        )
