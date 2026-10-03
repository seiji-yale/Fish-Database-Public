"""Step 2 (T-004): the mapping rules of `docs/05-import-spec.md` sections 2-3 (BR-10 vocabulary,
PCR condition parsing, fluorescence phenotype parsing, cryo ranges, the `External storage` typo, the
`demogene5 3 bp insertion` allele note, `Source` as an attribute). Pure functions only: no I/O, no ids, no
database access -- `line_docs.py` turns the result into rows.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from tz import to_iso_date

# BR-10: legacy vocabulary -> the schema's `id_protocols.protocol_type` values. Applied at import
# and never shown to users again (docs/07-glossary.md).
PROTOCOL_TYPE_BY_ID_METHOD = {
    "NONE": "none",
    "Tails": "tails",
    "Gel": "pcr",
    "Sequence": "pcr_sequence",
    "Fluoresence": "fluorescence",  # sic -- the workbook's own spelling
}

# Default label for a protocol row (docs/03-data-model.md 2.6: "default = type name").
PROTOCOL_LABEL = {
    "none": "None",
    "tails": "Tails",
    "pcr": "PCR",
    "pcr_sequence": "PCR + Sequence",
    "fluorescence": "Fluorescence",
}

LINE_STATUSES = {"Current", "Breeding", "Closed"}

_PCR_CONDITION_RE = re.compile(r"^\s*(\d+)\s*/\s*(?:\d+\s*s\s*/\s*)?(\d+)\s*Cycle\s*$", re.IGNORECASE)
_FLUORESCENCE_PHENOTYPE_RE = re.compile(r"^\s*Day\s*([0-9]+(?:-[0-9]+)?)\s*:\s*(.*)$", re.IGNORECASE)
_CRYO_ID_RE = re.compile(r"^C(\d+)$")

DEFAULT_ANNEALING_C = 60
DEFAULT_CYCLES = 35


@dataclass(frozen=True)
class Diagnostic:
    """One line for the import report: a normalisation that was applied, or something that still
    needs an import review (`docs/05-import-spec.md` section 6: "Normalisations applied" /
    "Unresolved items")."""

    kind: Literal["normalisation", "unresolved"]
    line: str
    message: str


@dataclass
class Protocol:
    protocol_type: str
    label: str
    fields: dict[str, object]
    notes: str | None


@dataclass
class GenotypingRecord:
    record_date: str
    positive_count: int
    notes: str | None


@dataclass
class CryoRecord:
    cryo_date: str | None
    place: str | None
    box_name: str | None
    cryo_id_start: str | None
    cryo_id_end: str | None
    count: int | None
    details_unknown: int
    notes: str | None


@dataclass
class NormalizedLine:
    name: str
    gene: str | None
    status: str
    dob: str | None
    legacy_no: int | None
    legacy_check: int
    notes: str | None
    updated_at_source: object  # the raw `Last Update` cell; tz.py converts it later
    source_attribute: str | None
    protocol: Protocol
    genotyping_record: GenotypingRecord | None
    ided_number: int
    last_id_date: str | None
    cryo_record: CryoRecord | None
    phenotypes: list[str]
    reference_title: str | None


def normalize_status(raw: object, *, line: str) -> str:
    text = str(raw).strip() if raw is not None else ""
    if text not in LINE_STATUSES:
        raise ValueError(f"{line}: unknown Status {raw!r} (expected one of {sorted(LINE_STATUSES)})")
    return text


def parse_gene_and_note(raw: object) -> tuple[str | None, str | None]:
    """Add Info 01 -> (gene, an extra note fragment). Only the one documented exception
    (`demogene5 3 bp insertion`) splits into a gene and a note; every other value is the gene as-is."""
    if raw is None:
        return None, None
    text = str(raw).strip()
    if text == "":
        return None, None
    if text == "demogene5 3 bp insertion":
        return "demogene5", "[import] allele note: 3 bp insertion"
    return text, None


def parse_pcr_condition(raw: object) -> tuple[int, int, str | None]:
    """PCR Cond. / C -> (annealing_c, cycles, a note when the value was not a bare number)."""
    if isinstance(raw, bool):
        raise TypeError(f"PCR Cond. must be a number or text, got a bool: {raw!r}")
    if isinstance(raw, int):
        return raw, DEFAULT_CYCLES, None
    text = str(raw).strip() if raw is not None else ""
    note = f"[import] PCR condition: {text}"
    match = _PCR_CONDITION_RE.match(text)
    if match:
        return int(match.group(1)), int(match.group(2)), note
    return DEFAULT_ANNEALING_C, DEFAULT_CYCLES, note


def parse_expected_band(raw: object) -> str | None:
    if raw is None:
        return None
    if isinstance(raw, int):
        return str(raw)
    return str(raw).strip()


def parse_fluorescence_phenotype(raw: object, *, line: str) -> tuple[str, str]:
    """Phenotype column, for a Fluorescence line only: `Day2: green fin fluorescence` -> ("2", "green
    vasculature"). Raises if the cell does not follow the documented `Day<n>[-<n>]: <text>` shape --
    every real Fluorescence row does; a new shape needs a spec decision, not a silent guess."""
    text = "" if raw is None else str(raw).strip()
    match = _FLUORESCENCE_PHENOTYPE_RE.match(text)
    if not match:
        raise ValueError(f"{line}: Phenotype {raw!r} does not match 'Day<n>[-<n>]: <text>'")
    return match.group(1), match.group(2).strip()


def infer_fluorophore(description: str, line_name: str) -> str | None:
    """GFP/green -> GFP; mCherry/Red -> mCherry (checked in that order); otherwise None (reported
    as unresolved -- `docs/05-import-spec.md` section 3.2, only `demo_034` needs this today)."""
    haystack = f"{description} {line_name}".lower()
    if "gfp" in haystack or "green" in haystack:
        return "GFP"
    if "mcherry" in haystack or "red" in haystack:
        return "mCherry"
    return None


def fix_cryo_place(raw: object) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if text == "":
        return None
    return "External storage" if text == "External storage" else text


def parse_cryo_ids(min_raw: object, max_raw: object) -> tuple[str | None, str | None, int | None, str | None]:
    """CryoID_min / CryoID_MAX -> (start, end, count, a note for the External storage "no lab id"
    case). `C0000`-`C0000` means "stored externally, no lab id was assigned" (section 3.4)."""
    start = str(min_raw).strip() if min_raw not in (None, "") else None
    end = str(max_raw).strip() if max_raw not in (None, "") else None
    if start == "C0000" and end == "C0000":
        return None, None, None, "[import] external storage, no lab ID"
    if start is not None and end is not None:
        start_match, end_match = _CRYO_ID_RE.match(start), _CRYO_ID_RE.match(end)
        if start_match and end_match:
            count = int(end_match.group(1)) - int(start_match.group(1)) + 1
            return start, end, count, None
    return start, end, None, None


def normalize_line(raw: dict[str, object]) -> tuple[NormalizedLine, list[Diagnostic]]:
    """Turns one `reader.RawRecord.values` dict into a `NormalizedLine` plus report diagnostics."""
    diagnostics: list[Diagnostic] = []
    name = str(raw["line"]).strip()

    def note(message: str) -> None:
        diagnostics.append(Diagnostic("normalisation", name, message))

    def unresolved(message: str) -> None:
        diagnostics.append(Diagnostic("unresolved", name, message))

    status = normalize_status(raw["status"], line=name)
    gene, allele_note = parse_gene_and_note(raw["gene_raw"])
    if allele_note:
        note(f"{allele_note} (from Add Info 01 {raw['gene_raw']!r})")

    source_attribute = None
    if raw["source"] not in (None, ""):
        source_attribute = str(raw["source"]).strip()

    extra_notes = [n for n in (allele_note,) if n]
    if raw["add_info_02"] not in (None, ""):
        extra_notes.append(str(raw["add_info_02"]).strip())
    notes = "\n".join(extra_notes) if extra_notes else None

    protocol_type = PROTOCOL_TYPE_BY_ID_METHOD.get(str(raw["id_method"]).strip())
    if protocol_type is None:
        raise ValueError(f"{name}: unknown ID Method {raw['id_method']!r}")
    if protocol_type in ("pcr", "pcr_sequence"):
        annealing_c, cycles, condition_note = parse_pcr_condition(raw["pcr_cond"])
        if condition_note:
            note(f"{condition_note} -> annealing {annealing_c} C, {cycles} cycles")
        fields: dict[str, object] = {
            "primer_f_name": _trim(raw["primer_f_name"]),
            "primer_f_seq": _trim_upper(raw["primer_f_seq"]),
            "primer_r_name": _trim(raw["primer_r_name"]),
            "primer_r_seq": _trim_upper(raw["primer_r_seq"]),
            "annealing_c": annealing_c,
            "expected_band": parse_expected_band(raw["base_pairs"]),
            "cycles": cycles,
        }
        protocol_notes = condition_note
        for field_key in ("primer_f_name", "primer_r_name"):
            value = fields.get(field_key)
            if isinstance(value, str) and _has_non_ascii(value):
                note(f"{field_key} kept verbatim as typed (contains a non-ASCII character): {value!r}")
        if protocol_type == "pcr_sequence":
            seq_cond = raw["seq_cond"]
            seq_primer = _trim(seq_cond)
            if seq_primer and seq_primer.startswith("Use "):
                seq_primer = seq_primer[len("Use "):]
            fields.update(
                seq_primer=seq_primer,
                guide_seq=_trim_upper(raw["guide_seq"]),
                expected_mutation=_trim(raw["mutation"]),
                seq_result_urls=[],
            )
        phenotypes = _split_phenotypes(raw["phenotype"])
    elif protocol_type == "fluorescence":
        if raw["phenotype"] is None:
            raise ValueError(f"{name}: a Fluorescence line needs a Phenotype cell")
        screening_day, description = parse_fluorescence_phenotype(raw["phenotype"], line=name)
        fluorophore = infer_fluorophore(description, name)
        if fluorophore is None:
            unresolved(f"fluorophore could not be inferred from {description!r}; choose one in overrides.yaml")
        fields = {"fluorophore": fluorophore, "screening_day": screening_day, "description": description}
        protocol_notes = None
        phenotypes = []  # fluorescence lines keep phenotypes empty (OQ-9)
    else:
        fields = {}
        protocol_notes = None
        phenotypes = _split_phenotypes(raw["phenotype"])

    protocol = Protocol(
        protocol_type=protocol_type,
        label=PROTOCOL_LABEL[protocol_type],
        fields=fields,
        notes=protocol_notes,
    )

    id_date = to_iso_date(raw["id_date"])
    id_number = None if raw["id_number"] in (None, "") else int(raw["id_number"])
    genotyping_record = None
    ided_number = 0
    last_id_date = None
    if id_date is not None:
        positive_count = id_number if id_number is not None else 0
        record_note = "[import] from Mastersheet Ver. 1.1"
        if id_number is None:
            note(f"ID Number blank with an ID Date present; genotyping record created with 0 positives")
        genotyping_record = GenotypingRecord(record_date=id_date, positive_count=positive_count, notes=record_note)
        ided_number = positive_count
        last_id_date = id_date
    elif id_number is not None:
        unresolved(f"ID Number {id_number} present with no ID Date; no genotyping record was created")

    cryo_record = None
    if raw["cryo_flag"] is True:
        start, end, count, cryo_note = parse_cryo_ids(raw["cryo_id_min"], raw["cryo_id_max"])
        cryo_date = to_iso_date(raw["cryo_date"])
        place = fix_cryo_place(raw["cryo_place"])
        if raw["cryo_place"] is not None and place != str(raw["cryo_place"]).strip():
            note(f"Cryo Place typo fixed: {raw['cryo_place']!r} -> {place!r}")
        box_name = _trim(raw["cryo_box"])
        details_unknown = 1 if not any([cryo_date, place, box_name, start, end]) else 0
        if cryo_note:
            note(f"{cryo_note} (Cryo BoxID {raw['cryo_box']!r})")
        cryo_record = CryoRecord(
            cryo_date=cryo_date, place=place, box_name=box_name, cryo_id_start=start,
            cryo_id_end=end, count=count, details_unknown=details_unknown, notes=cryo_note,
        )
    elif raw["cryo_flag"] not in (False, None):
        raise ValueError(f"{name}: Cryo Preservation must be TRUE/FALSE, got {raw['cryo_flag']!r}")

    reference_title = _trim(raw["resource02"])

    line = NormalizedLine(
        name=name,
        gene=gene,
        status=status,
        dob=to_iso_date(raw["dob"]),
        legacy_no=None if raw["no"] is None else int(raw["no"]),
        legacy_check=1 if raw["check"] else 0,
        notes=notes,
        updated_at_source=raw["last_update"],
        source_attribute=source_attribute,
        protocol=protocol,
        genotyping_record=genotyping_record,
        ided_number=ided_number,
        last_id_date=last_id_date,
        cryo_record=cryo_record,
        phenotypes=phenotypes,
        reference_title=reference_title,
    )
    return line, diagnostics


def _has_non_ascii(text: str) -> bool:
    return any(ord(character) > 127 for character in text)


def _trim(raw: object) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _trim_upper(raw: object) -> str | None:
    trimmed = _trim(raw)
    return trimmed.upper() if trimmed is not None else None


def _split_phenotypes(raw: object) -> list[str]:
    if raw is None:
        return []
    text = str(raw).strip()
    if text == "":
        return []
    return [part.strip() for part in text.split(";") if part.strip()]
