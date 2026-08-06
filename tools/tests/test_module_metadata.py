from __future__ import annotations

from tools.repository import (
    AtlasProject,
    ModuleMetadataAnalyzer,
)


def write_module(
    tmp_path,
    metadata: str,
):
    target = tmp_path / "src/app.module.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(
        (
            "import { Module } "
            "from '@nestjs/common';\n"
            "\n"
            "@Module({\n"
            f"{metadata}"
            "})\n"
            "export class AppModule {}\n"
        ),
        encoding="utf-8",
    )

    return target


def test_extracts_module_imports(
    tmp_path,
):
    write_module(
        tmp_path,
        (
            "  imports: [\n"
            "    ConfigModule,\n"
            "    UsersModule,\n"
            "  ],\n"
        ),
    )

    project = AtlasProject.load(
        tmp_path
    )

    index = ModuleMetadataAnalyzer(
        project
    ).build()

    imports = index.imports_for_file(
        "src/app.module.ts"
    )

    assert [
        item.module_class
        for item in imports
    ] == [
        "ConfigModule",
        "UsersModule",
    ]


def test_detects_existing_module_import(
    tmp_path,
):
    write_module(
        tmp_path,
        "  imports: [ConfigModule],\n",
    )

    index = ModuleMetadataAnalyzer(
        AtlasProject.load(tmp_path)
    ).build()

    assert index.has_module_import(
        "src/app.module.ts",
        "ConfigModule",
    )

    assert not index.has_module_import(
        "src/app.module.ts",
        "UsersModule",
    )


def test_module_without_imports_returns_empty(
    tmp_path,
):
    write_module(
        tmp_path,
        "  providers: [],\n",
    )

    index = ModuleMetadataAnalyzer(
        AtlasProject.load(tmp_path)
    ).build()

    assert (
        index.imports_for_file(
            "src/app.module.ts"
        )
        == []
    )


def test_atlas_project_exposes_module_imports(
    tmp_path,
):
    write_module(
        tmp_path,
        "  imports: [ConfigModule],\n",
    )

    project = AtlasProject.load(
        tmp_path
    )

    assert project.has_module_import(
        "src/app.module.ts",
        "ConfigModule",
    )

    assert [
        item.module_class
        for item in project.module_imports_of(
            "src/app.module.ts"
        )
    ] == [
        "ConfigModule",
    ]
