-- 0003_seed_enumerations.sql
-- Seed enumerations (docs/03-data-model.md 2.3). Rows only control pickers (visibility and order);
-- the ID method templates themselves live in code (domain/protocolTemplates.ts).
-- `attribute_key` = suggested keys for the "More attributes" picker; Source comes from the import (OQ-20).

INSERT OR IGNORE INTO enumerations (id, kind, value, sort_order, is_active) VALUES
  ('01J00000000000000000000001', 'id_method_type', 'None', 1, 1),
  ('01J00000000000000000000002', 'id_method_type', 'Tails', 2, 1),
  ('01J00000000000000000000003', 'id_method_type', 'PCR', 3, 1),
  ('01J00000000000000000000004', 'id_method_type', 'PCR + Sequence', 4, 1),
  ('01J00000000000000000000005', 'id_method_type', 'Fluorescence', 5, 1),
  ('01J00000000000000000000006', 'id_method_type', 'Custom', 6, 1),
  ('01J00000000000000000000007', 'fluorophore', 'GFP', 1, 1),
  ('01J00000000000000000000008', 'fluorophore', 'mCherry', 2, 1),
  ('01J00000000000000000000009', 'fluorophore', 'DsRed', 3, 1),
  ('01J00000000000000000000010', 'cryo_place', 'Demo freezer shelf', 1, 1),
  ('01J00000000000000000000011', 'cryo_place', 'External storage', 2, 1),
  ('01J00000000000000000000012', 'request_type', 'Set up cross', 1, 1),
  ('01J00000000000000000000013', 'request_type', 'Genotyping', 2, 1),
  ('01J00000000000000000000014', 'request_type', 'Experimental use', 3, 1),
  ('01J00000000000000000000015', 'request_type', 'Other', 4, 1),
  ('01J00000000000000000000016', 'attribute_key', 'Source', 1, 1);
