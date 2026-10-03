from __future__ import annotations

from tools.repository import (
    AtlasProject,
    DependencyGraphBuilder,
    DependencyKind,
)


def test_import_and_constructor_dependencies(
    tmp_path,
):
    target = tmp_path / "src/app.service.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(
        (
            "import { ConfigService } "
            "from '@nestjs/config';\n"
            "\n"
            "export class AppService {\n"
            "  constructor(\n"
            "    private readonly config: "
            "ConfigService,\n"
            "  ) {}\n"
            "}\n"
        ),
        encoding="utf-8",
    )

    project = AtlasProject.load(
        tmp_path
    )

    graph = DependencyGraphBuilder(
        project
    ).build()

    imports = graph.import_dependencies(
        "src/app.service.ts"
    )

    constructors = (
        graph.constructor_dependencies(
            "src/app.service.ts"
        )
    )

    assert len(imports) == 1
    assert imports[0].target == (
        "@nestjs/config"
    )
    assert imports[0].symbol == (
        "ConfigService"
    )

    assert len(constructors) == 1
    assert constructors[0].kind == (
        DependencyKind.CONSTRUCTOR
    )
    assert constructors[0].target == (
        "ConfigService"
    )


def test_aliased_import_uses_local_name(
    tmp_path,
):
    target = tmp_path / "src/example.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(
        (
            "import { ConfigService as AppConfig } "
            "from '@nestjs/config';\n"
        ),
        encoding="utf-8",
    )

    graph = DependencyGraphBuilder(
        AtlasProject.load(tmp_path)
    ).build()

    dependencies = graph.dependencies_of(
        "src/example.ts"
    )

    assert dependencies[0].symbol == (
        "AppConfig"
    )


def test_atlas_project_exposes_dependencies(
    tmp_path,
):
    target = tmp_path / "src/app.service.ts"
    target.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    target.write_text(
        (
            "import { ConfigService } "
            "from '@nestjs/config';\n"
            "\n"
            "export class AppService {\n"
            "  constructor(\n"
            "    private readonly config: "
            "ConfigService,\n"
            "  ) {}\n"
            "}\n"
        ),
        encoding="utf-8",
    )

    project = AtlasProject.load(
        tmp_path
    )

    assert len(
        project.import_dependencies_of(
            "src/app.service.ts"
        )
    ) == 1

    assert len(
        project.constructor_dependencies_of(
            "src/app.service.ts"
        )
    ) == 1
