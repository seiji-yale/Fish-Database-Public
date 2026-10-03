"""Loads `overrides.yaml` (manual answers to the report's "Unresolved items", per
`docs/05-import-spec.md` section 7 step 2) and applies them to a normalised line. Today the only
documented override is a Fluorescence line's fluorophore, e.g.:

    demo_034:
      fluorophore: GFP

Applying an override never removes a `Diagnostic`'s history: it adds a "normalisation" diagnostic
saying an override was used, so the report always shows why a value differs from the sheet.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from normalize import Diagnostic, NormalizedLine

KNOWN_OVERRIDE_FIELDS = {"fluorophore"}


def load_overrides(path: Path) -> dict[str, dict[str, str]]:
    """`{}` when the file does not exist yet (nothing to apply on a first dry run)."""
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path}: expected a mapping of line name -> {{field: value}}")
    for line_name, fields in data.items():
        if not isinstance(fields, dict):
            raise ValueError(f"{path}: {line_name!r} must map to a mapping of field -> value")
        unknown = set(fields) - KNOWN_OVERRIDE_FIELDS
        if unknown:
            raise ValueError(f"{path}: {line_name!r} has unsupported override field(s) {sorted(unknown)}")
    return data


def apply_overrides(
    line: NormalizedLine, diagnostics: list[Diagnostic], overrides: dict[str, dict[str, str]]
) -> list[Diagnostic]:
    """Returns a new diagnostics list with resolved "unresolved" entries removed and an override
    "normalisation" entry added in their place. Mutates `line.protocol.fields` in place."""
    fields = overrides.get(line.name)
    if not fields:
        return diagnostics
    result = list(diagnostics)
    if "fluorophore" in fields:
        if line.protocol.protocol_type != "fluorescence":
            raise ValueError(f"{line.name}: overrides.yaml sets fluorophore but this is not a Fluorescence line")
        line.protocol.fields["fluorophore"] = fields["fluorophore"]
        result = [d for d in result if not (d.kind == "unresolved" and "fluorophore" in d.message)]
        result.append(
            Diagnostic("normalisation", line.name, f"fluorophore set from overrides.yaml: {fields['fluorophore']}")
        )
    return result
