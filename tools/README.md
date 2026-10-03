# Atlas Upgrade Framework

## List patches

```bash
python3 tools/patch_runner.py list
```

## Dry run

```bash
python3 tools/patch_runner.py run 006A --dry-run
```

## Apply patch

```bash
python3 tools/patch_runner.py run 006A
```

## Roll back latest patch backup

```bash
python3 tools/patch_runner.py rollback 006A
```

Every patch must:

- define a `MANIFEST`;
- expose `apply(context)`;
- be safe to run repeatedly;
- back up modified files;
- run configured build commands;
- show Git status and diff summary.
