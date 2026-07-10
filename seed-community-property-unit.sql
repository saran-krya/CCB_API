-- =============================================================================
-- SEED DATA: Community / Property / Unit — sourced from CCB_Template's own
-- mock dataset (CCB_Template/lib/data/communities.ts), not invented data.
--
-- Source of truth: CCB_Template/lib/data/communities.ts
--   - 8 communities (the `communities` array)
--   - 67 properties/towers across those communities (the `properties` array)
--   - 111 units (the `units` array — the template itself only defines units
--     for the first 5 towers of Azizi Rivera; it does not define units for
--     the other 62 properties, so this script doesn't invent any either —
--     faithfully mirrors the template's own incompleteness rather than
--     filling the gap with made-up data)
--
-- Field mapping notes:
--   - properties.property_code uses the template's own `code` field
--     (e.g. "AZR-T01"), NOT the template's `id` field (e.g. "RIV-T01") —
--     the `id` is just an internal mock-data key, `code` is the field the
--     template itself treats as the business-facing property code.
--   - units reference their property via that same `code`, resolved
--     through the template's own propertyId -> code mapping.
--
-- Run this ONCE against the target MySQL database:
--   mysql -u <user> -p <database> < seed-community-property-unit.sql
--
-- Idempotent: INSERT IGNORE skips any row whose unique code already exists.
-- If a community with code 'AZR' (Azizi Rivera) already exists in this
-- database, that INSERT is skipped (it's the same logical community) —
-- but properties/units below still insert under it via the same lookup,
-- so nothing is lost.
-- =============================================================================

START TRANSACTION;

-- ---------------------------------------------------------------------------
-- Step 1: Communities (8 rows)
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO communities
  (name, code, community_status, description, location, address, city, state, zip_code, country, contact_person, contact_email, contact_phone)
VALUES
  ('Azizi Rivera', 'AZR', 'active', 'A premium residential community with modern amenities and sustainable energy solutions.', 'Downtown Dubai', 'Sheikh Zayed Road, Dubai Marina', 'Dubai', 'Dubai', '0000', 'UAE', 'Fatima Al Mansouri', 'fatima.almansouri@azizirivera.ae', '+971 4 362 7000'),
  ('Azizi Pearl', 'AZP', 'active', 'Eco-friendly community focused on green living and renewable energy.', 'Dubai Marina', 'Marina Mall District, Dubai Marina', 'Dubai', 'Dubai', '0000', 'UAE', 'Mohamed Al Naqbi', 'mohamed.alnaqbi@azizipearl.ae', '+971 4 350 6000'),
  ('Azizi Star', 'AZS', 'active', 'Luxury waterfront high-rise community with panoramic harbor views.', 'Downtown Dubai', 'Old Town District, Downtown Dubai', 'Dubai', 'Dubai', '0000', 'UAE', 'Aisha Al Mansoori', 'aisha.almansouri@azizistar.ae', '+971 4 309 2000'),
  ('Azizi Grand', 'AZG', 'active', 'Premium mixed-use community with scenic views and modern facilities.', 'Business Bay', 'Business Bay Avenue, Dubai', 'Dubai', 'Dubai', '0000', 'UAE', 'Hassan Al Harthi', 'hassan.alharthi@azizigrand.ae', '+971 4 361 7000'),
  ('Azizi Heights', 'AZH', 'active', 'Peaceful elevated community with parks and recreational facilities.', 'JBR District', 'Jumeirah Beach Residence, Dubai', 'Dubai', 'Dubai', '0000', 'UAE', 'Layla Al Mazrouei', 'layla.almazrouei@aziziheights.ae', '+971 4 394 1111'),
  ('Azizi Jewel', 'AZJ', 'active', 'Urban luxury living at its finest with premium amenities and city access.', 'Deira', 'Al Khaleej Street, Deira', 'Dubai', 'Dubai', '0000', 'UAE', 'Noor Al Falahi', 'noor.alfalahi@azizijewel.ae', '+971 4 222 8888'),
  ('Azizi Crest', 'AZC', 'active', 'Upscale residential community with landscaped gardens and family-friendly environment.', 'Arabian Ranches', 'Arabian Ranches South, Dubai', 'Dubai', 'Dubai', '0000', 'UAE', 'Rania Al Shehhi', 'rania.alshehhi@azizicrest.ae', '+971 4 365 9000'),
  ('Azizi Vista', 'AZV', 'active', 'Contemporary high-rise community with stunning skyline views and modern infrastructure.', 'DIFC District', 'Sheikh Zayed Road Extension, Dubai', 'Dubai', 'Dubai', '0000', 'UAE', 'Sara Al Ketbi', 'sara.alketbi@azizivista.ae', '+971 4 331 1000');

-- ---------------------------------------------------------------------------
-- Step 2: Properties (67 rows)
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO properties
  (community_id, property_name, property_code, property_type, number_of_floors, property_status)
VALUES
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower A', 'AZR-T01', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower B', 'AZR-T02', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower C', 'AZR-T03', 'mixed', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower D', 'AZR-T04', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower E', 'AZR-T05', 'residential', 20, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower F', 'AZR-T06', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower G', 'AZR-T07', 'residential', 22, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower H', 'AZR-T08', 'residential', 18, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower I', 'AZR-T09', 'mixed', 22, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower J', 'AZR-T10', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower K', 'AZR-T11', 'residential', 20, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZR'), 'Rivera Tower L', 'AZR-T12', 'residential', 20, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZP'), 'Pearl Tower A', 'AZP-T01', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZP'), 'Pearl Tower B', 'AZP-T02', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZP'), 'Pearl Tower C', 'AZP-T03', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZP'), 'Pearl Tower D', 'AZP-T04', 'mixed', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZP'), 'Pearl Tower E', 'AZP-T05', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZP'), 'Pearl Tower F', 'AZP-T06', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZP'), 'Pearl Tower G', 'AZP-T07', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZP'), 'Pearl Tower H', 'AZP-T08', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZP'), 'Pearl Tower I', 'AZP-T09', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZS'), 'Star Tower A', 'AZS-T01', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZS'), 'Star Tower B', 'AZS-T02', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZS'), 'Star Tower C', 'AZS-T03', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZS'), 'Star Tower D', 'AZS-T04', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZS'), 'Star Tower E', 'AZS-T05', 'mixed', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZS'), 'Star Tower F', 'AZS-T06', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZS'), 'Star Tower G', 'AZS-T07', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZS'), 'Star Tower H', 'AZS-T08', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZG'), 'Grand Tower A', 'AZG-T01', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZG'), 'Grand Tower B', 'AZG-T02', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZG'), 'Grand Tower C', 'AZG-T03', 'residential', 22, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZG'), 'Grand Tower D', 'AZG-T04', 'residential', 22, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZG'), 'Grand Tower E', 'AZG-T05', 'residential', 22, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZG'), 'Grand Tower F', 'AZG-T06', 'residential', 22, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZG'), 'Grand Tower G', 'AZG-T07', 'mixed', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZG'), 'Grand Tower H', 'AZG-T08', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZG'), 'Grand Tower I', 'AZG-T09', 'residential', 22, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZH'), 'Heights Tower A', 'AZH-T01', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZH'), 'Heights Tower B', 'AZH-T02', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZH'), 'Heights Tower C', 'AZH-T03', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZH'), 'Heights Tower D', 'AZH-T04', 'mixed', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZH'), 'Heights Tower E', 'AZH-T05', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZH'), 'Heights Tower F', 'AZH-T06', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZH'), 'Heights Tower G', 'AZH-T07', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZH'), 'Heights Tower H', 'AZH-T08', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZJ'), 'Jewel Tower A', 'AZJ-T01', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZJ'), 'Jewel Tower B', 'AZJ-T02', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZJ'), 'Jewel Tower C', 'AZJ-T03', 'mixed', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZJ'), 'Jewel Tower D', 'AZJ-T04', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZJ'), 'Jewel Tower E', 'AZJ-T05', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZJ'), 'Jewel Tower F', 'AZJ-T06', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZJ'), 'Jewel Tower G', 'AZJ-T07', 'residential', 24, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZC'), 'Crest Tower A', 'AZC-T01', 'residential', 22, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZC'), 'Crest Tower B', 'AZC-T02', 'residential', 22, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZC'), 'Crest Tower C', 'AZC-T03', 'residential', 22, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZC'), 'Crest Tower D', 'AZC-T04', 'mixed', 20, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZC'), 'Crest Tower E', 'AZC-T05', 'residential', 20, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZC'), 'Crest Tower F', 'AZC-T06', 'residential', 20, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZC'), 'Crest Tower G', 'AZC-T07', 'residential', 18, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZV'), 'Vista Tower A', 'AZV-T01', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZV'), 'Vista Tower B', 'AZV-T02', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZV'), 'Vista Tower C', 'AZV-T03', 'mixed', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZV'), 'Vista Tower D', 'AZV-T04', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZV'), 'Vista Tower E', 'AZV-T05', 'residential', 28, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZV'), 'Vista Tower F', 'AZV-T06', 'residential', 26, 'active'),
  ((SELECT id FROM communities WHERE code = 'AZV'), 'Vista Tower G', 'AZV-T07', 'residential', 26, 'active');

-- ---------------------------------------------------------------------------
-- Step 3: Units (111 rows — only for the 5 properties the
-- template itself defines units for: Rivera Towers A-E)
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO units
  (property_id, unit_number, floor_number, unit_type, unit_size, occupancy_status, unit_status, bedrooms, bathrooms, balcony, parking_spaces, monthly_rent, handover_date, owner_id, tenant_id, master_meter_id, sub_meter_id, amenities, description)
VALUES
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A01', 1, 'studio', 450.00, 'vacant', 'active', 0, 1, TRUE, 1, 2500.00, '2021-12-01', NULL, NULL, 'MMT00001', 'SMT00001', '["AC","Furnished","Modular Kitchen"]', 'Modern studio apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A02', 1, 'apartment', 850.00, 'occupied', 'active', 2, 2, FALSE, 1, 2600.00, '2021-12-01', 'OWN0002', 'TEN0002', 'MMT00002', 'SMT00002', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A03', 2, 'apartment', 850.00, 'occupied', 'active', 2, 2, TRUE, 1, 2700.00, '2021-12-01', 'OWN0003', 'TEN0003', 'MMT00003', 'SMT00003', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A04', 2, 'studio', 450.00, 'vacant', 'active', 0, 1, FALSE, 1, 2800.00, '2021-12-01', 'OWN0004', NULL, 'MMT00004', 'SMT00004', '["AC","Furnished","Modular Kitchen"]', 'Modern studio apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A05', 3, 'apartment', 850.00, 'occupied', 'active', 2, 2, TRUE, 1, 2900.00, '2021-12-01', NULL, 'TEN0005', 'MMT00005', 'SMT00005', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A06', 3, 'apartment', 850.00, 'occupied', 'active', 2, 2, FALSE, 1, 3000.00, '2021-12-01', 'OWN0006', 'TEN0006', 'MMT00006', 'SMT00006', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A07', 4, 'studio', 450.00, 'vacant', 'active', 0, 1, TRUE, 1, 3100.00, '2021-12-01', 'OWN0007', NULL, 'MMT00007', 'SMT00007', '["AC","Furnished","Modular Kitchen"]', 'Modern studio apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A08', 4, 'apartment', 850.00, 'occupied', 'active', 2, 2, FALSE, 1, 3200.00, '2021-12-01', 'OWN0008', 'TEN0008', 'MMT00008', 'SMT00008', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A09', 5, 'apartment', 850.00, 'occupied', 'active', 2, 2, TRUE, 1, 3300.00, '2021-12-01', NULL, 'TEN0009', 'MMT00009', 'SMT00009', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A10', 5, 'studio', 450.00, 'vacant', 'active', 0, 1, FALSE, 1, 3400.00, '2021-12-01', 'OWN0010', NULL, 'MMT00010', 'SMT00010', '["AC","Furnished","Modular Kitchen"]', 'Modern studio apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A11', 6, 'apartment', 850.00, 'occupied', 'active', 2, 2, TRUE, 1, 3500.00, '2021-12-01', 'OWN0011', 'TEN0011', 'MMT00011', 'SMT00011', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A12', 6, 'apartment', 850.00, 'occupied', 'active', 2, 2, FALSE, 1, 3600.00, '2021-12-01', 'OWN0012', 'TEN0012', 'MMT00012', 'SMT00012', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A13', 7, 'studio', 450.00, 'vacant', 'active', 0, 1, TRUE, 1, 3700.00, '2021-12-01', NULL, NULL, 'MMT00013', 'SMT00013', '["AC","Furnished","Modular Kitchen"]', 'Modern studio apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A14', 7, 'apartment', 850.00, 'occupied', 'active', 2, 2, FALSE, 1, 3800.00, '2021-12-01', 'OWN0014', 'TEN0014', 'MMT00014', 'SMT00014', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A15', 8, 'apartment', 850.00, 'occupied', 'active', 2, 2, TRUE, 1, 3900.00, '2021-12-01', 'OWN0015', 'TEN0015', 'MMT00015', 'SMT00015', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A16', 8, 'studio', 450.00, 'vacant', 'active', 0, 1, FALSE, 1, 4000.00, '2021-12-01', 'OWN0016', NULL, 'MMT00016', 'SMT00016', '["AC","Furnished","Modular Kitchen"]', 'Modern studio apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A17', 9, 'apartment', 850.00, 'occupied', 'active', 2, 2, TRUE, 1, 4100.00, '2021-12-01', NULL, 'TEN0017', 'MMT00017', 'SMT00017', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A18', 9, 'apartment', 850.00, 'occupied', 'active', 2, 2, FALSE, 1, 4200.00, '2021-12-01', 'OWN0018', 'TEN0018', 'MMT00018', 'SMT00018', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A19', 10, 'studio', 450.00, 'vacant', 'active', 0, 1, TRUE, 1, 4300.00, '2021-12-01', 'OWN0019', NULL, 'MMT00019', 'SMT00019', '["AC","Furnished","Modular Kitchen"]', 'Modern studio apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A20', 10, 'apartment', 850.00, 'occupied', 'active', 2, 2, FALSE, 1, 4400.00, '2021-12-01', 'OWN0020', 'TEN0020', 'MMT00020', 'SMT00020', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A21', 11, 'apartment', 850.00, 'occupied', 'active', 2, 2, TRUE, 1, 4500.00, '2021-12-01', NULL, 'TEN0021', 'MMT00021', 'SMT00021', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A22', 11, 'studio', 450.00, 'vacant', 'active', 0, 1, FALSE, 1, 4600.00, '2021-12-01', 'OWN0022', NULL, 'MMT00022', 'SMT00022', '["AC","Furnished","Modular Kitchen"]', 'Modern studio apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A23', 12, 'apartment', 850.00, 'occupied', 'active', 2, 2, TRUE, 1, 4700.00, '2021-12-01', 'OWN0023', 'TEN0023', 'MMT00023', 'SMT00023', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T01'), 'A24', 12, 'apartment', 850.00, 'occupied', 'active', 2, 2, FALSE, 1, 4800.00, '2021-12-01', 'OWN0024', 'TEN0024', 'MMT00024', 'SMT00024', '["AC","Furnished","Modular Kitchen"]', 'Modern 2-bedroom apartment with city views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B01', 1, 'apartment', 900.00, 'vacant', 'active', 2, 2, TRUE, 1, 2800.00, '2022-01-15', 'OWN0100', NULL, 'MMT00025', 'SMT00025', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B02', 1, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 2850.00, '2022-01-15', 'OWN0101', 'TEN0101', 'MMT00026', 'SMT00026', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B03', 2, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 2900.00, '2022-01-15', 'OWN0102', 'TEN0102', 'MMT00027', 'SMT00027', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B04', 2, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 2950.00, '2022-01-15', 'OWN0103', NULL, 'MMT00028', 'SMT00028', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B05', 3, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3000.00, '2022-01-15', 'OWN0104', 'TEN0104', 'MMT00029', 'SMT00029', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B06', 3, 'apartment', 900.00, 'vacant', 'active', 2, 2, TRUE, 1, 3050.00, '2022-01-15', 'OWN0105', 'TEN0105', 'MMT00030', 'SMT00030', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B07', 4, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3100.00, '2022-01-15', 'OWN0106', NULL, 'MMT00031', 'SMT00031', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B08', 4, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3150.00, '2022-01-15', 'OWN0107', 'TEN0107', 'MMT00032', 'SMT00032', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B09', 5, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3200.00, '2022-01-15', 'OWN0108', 'TEN0108', 'MMT00033', 'SMT00033', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B10', 5, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3250.00, '2022-01-15', 'OWN0109', NULL, 'MMT00034', 'SMT00034', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B11', 6, 'apartment', 900.00, 'vacant', 'active', 2, 2, TRUE, 1, 3300.00, '2022-01-15', 'OWN0110', 'TEN0110', 'MMT00035', 'SMT00035', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B12', 6, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3350.00, '2022-01-15', 'OWN0111', 'TEN0111', 'MMT00036', 'SMT00036', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B13', 7, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3400.00, '2022-01-15', 'OWN0112', NULL, 'MMT00037', 'SMT00037', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B14', 7, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3450.00, '2022-01-15', 'OWN0113', 'TEN0113', 'MMT00038', 'SMT00038', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B15', 8, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3500.00, '2022-01-15', 'OWN0114', 'TEN0114', 'MMT00039', 'SMT00039', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B16', 8, 'apartment', 900.00, 'vacant', 'active', 2, 2, TRUE, 1, 3550.00, '2022-01-15', 'OWN0115', NULL, 'MMT00040', 'SMT00040', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B17', 9, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3600.00, '2022-01-15', 'OWN0116', 'TEN0116', 'MMT00041', 'SMT00041', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B18', 9, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3650.00, '2022-01-15', 'OWN0117', 'TEN0117', 'MMT00042', 'SMT00042', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B19', 10, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3700.00, '2022-01-15', 'OWN0118', NULL, 'MMT00043', 'SMT00043', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T02'), 'B20', 10, 'apartment', 900.00, 'occupied', 'active', 2, 2, TRUE, 1, 3750.00, '2022-01-15', 'OWN0119', 'TEN0119', 'MMT00044', 'SMT00044', '["AC","Balcony","Parking"]', 'Spacious 2-bedroom family apartment with garden views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C01', 1, 'apartment', 950.00, 'vacant', 'active', 2, 2, TRUE, 1, 3000.00, '2022-12-15', 'OWN0200', NULL, 'MMT00045', 'SMT00045', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C02', 1, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 3075.00, '2022-12-15', 'OWN0201', 'TEN0201', 'MMT00046', 'SMT00046', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C03', 2, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 3150.00, '2022-12-15', 'OWN0202', 'TEN0202', 'MMT00047', 'SMT00047', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C04', 2, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 3225.00, '2022-12-15', 'OWN0203', NULL, 'MMT00048', 'SMT00048', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C05', 3, 'apartment', 950.00, 'vacant', 'active', 2, 2, TRUE, 1, 3300.00, '2022-12-15', 'OWN0204', 'TEN0204', 'MMT00049', 'SMT00049', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C06', 3, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 3375.00, '2022-12-15', 'OWN0205', 'TEN0205', 'MMT00050', 'SMT00050', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C07', 4, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 3450.00, '2022-12-15', 'OWN0206', NULL, 'MMT00051', 'SMT00051', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C08', 4, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 3525.00, '2022-12-15', 'OWN0207', 'TEN0207', 'MMT00052', 'SMT00052', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C09', 5, 'apartment', 950.00, 'vacant', 'active', 2, 2, TRUE, 1, 3600.00, '2022-12-15', 'OWN0208', 'TEN0208', 'MMT00053', 'SMT00053', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C10', 5, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 3675.00, '2022-12-15', 'OWN0209', NULL, 'MMT00054', 'SMT00054', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C11', 6, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 3750.00, '2022-12-15', 'OWN0210', 'TEN0210', 'MMT00055', 'SMT00055', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C12', 6, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 3825.00, '2022-12-15', 'OWN0211', 'TEN0211', 'MMT00056', 'SMT00056', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C13', 7, 'apartment', 950.00, 'vacant', 'active', 2, 2, TRUE, 1, 3900.00, '2022-12-15', 'OWN0212', NULL, 'MMT00057', 'SMT00057', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C14', 7, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 3975.00, '2022-12-15', 'OWN0213', 'TEN0213', 'MMT00058', 'SMT00058', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C15', 8, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 4050.00, '2022-12-15', 'OWN0214', 'TEN0214', 'MMT00059', 'SMT00059', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C16', 8, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 4125.00, '2022-12-15', 'OWN0215', NULL, 'MMT00060', 'SMT00060', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C17', 9, 'apartment', 950.00, 'vacant', 'active', 2, 2, TRUE, 1, 4200.00, '2022-12-15', 'OWN0216', 'TEN0216', 'MMT00061', 'SMT00061', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C18', 9, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 4275.00, '2022-12-15', 'OWN0217', 'TEN0217', 'MMT00062', 'SMT00062', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C19', 10, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 4350.00, '2022-12-15', 'OWN0218', NULL, 'MMT00063', 'SMT00063', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'C20', 10, 'apartment', 950.00, 'occupied', 'active', 2, 2, TRUE, 1, 4425.00, '2022-12-15', 'OWN0219', 'TEN0219', 'MMT00064', 'SMT00064', '["AC","Modern Kitchen","Parking"]', 'Premium mixed-use apartment'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP01', 11, 'shop', 1200.00, 'vacant', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0220', 'TEN0220', 'MMT00065', 'SMT00065', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP02', 11, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0221', NULL, 'MMT00066', 'SMT00066', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP03', 12, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0222', 'TEN0222', 'MMT00067', 'SMT00067', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP04', 12, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0223', 'TEN0223', 'MMT00068', 'SMT00068', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP05', 13, 'shop', 1200.00, 'vacant', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0224', NULL, 'MMT00069', 'SMT00069', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP06', 13, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0225', 'TEN0225', 'MMT00070', 'SMT00070', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP07', 14, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0226', 'TEN0226', 'MMT00071', 'SMT00071', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP08', 14, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0227', NULL, 'MMT00072', 'SMT00072', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP09', 15, 'shop', 1200.00, 'vacant', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0228', 'TEN0228', 'MMT00073', 'SMT00073', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP10', 15, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0229', 'TEN0229', 'MMT00074', 'SMT00074', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP11', 16, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0230', NULL, 'MMT00075', 'SMT00075', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP12', 16, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0231', 'TEN0231', 'MMT00076', 'SMT00076', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP13', 17, 'shop', 1200.00, 'vacant', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0232', 'TEN0232', 'MMT00077', 'SMT00077', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP14', 17, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0233', NULL, 'MMT00078', 'SMT00078', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T03'), 'SHP15', 18, 'shop', 1200.00, 'occupied', 'active', NULL, NULL, FALSE, 2, 5000.00, '2022-12-15', 'OWN0234', 'TEN0234', 'MMT00079', 'SMT00079', '["Display Area","Storage","Parking"]', 'Retail shop space with visibility'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D01', 1, 'apartment', 1100.00, 'vacant', 'active', 3, 2, TRUE, 2, 2600.00, '2021-11-01', 'OWN0300', NULL, 'MMT00080', 'SMT00080', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D02', 1, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 2700.00, '2021-11-01', 'OWN0301', 'TEN0301', 'MMT00081', 'SMT00081', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D03', 1, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 2800.00, '2021-11-01', 'OWN0302', 'TEN0302', 'MMT00082', 'SMT00082', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D04', 1, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 2900.00, '2021-11-01', 'OWN0303', 'TEN0303', 'MMT00083', 'SMT00083', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D05', 2, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 3000.00, '2021-11-01', 'OWN0304', NULL, 'MMT00084', 'SMT00084', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D06', 2, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 3100.00, '2021-11-01', 'OWN0305', 'TEN0305', 'MMT00085', 'SMT00085', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D07', 2, 'apartment', 1100.00, 'vacant', 'active', 3, 2, TRUE, 2, 3200.00, '2021-11-01', 'OWN0306', 'TEN0306', 'MMT00086', 'SMT00086', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D08', 2, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 3300.00, '2021-11-01', 'OWN0307', 'TEN0307', 'MMT00087', 'SMT00087', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D09', 3, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 3400.00, '2021-11-01', 'OWN0308', NULL, 'MMT00088', 'SMT00088', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D10', 3, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 3500.00, '2021-11-01', 'OWN0309', 'TEN0309', 'MMT00089', 'SMT00089', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D11', 3, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 3600.00, '2021-11-01', 'OWN0310', 'TEN0310', 'MMT00090', 'SMT00090', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D12', 3, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 3700.00, '2021-11-01', 'OWN0311', 'TEN0311', 'MMT00091', 'SMT00091', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D13', 4, 'apartment', 1100.00, 'vacant', 'active', 3, 2, TRUE, 2, 3800.00, '2021-11-01', 'OWN0312', NULL, 'MMT00092', 'SMT00092', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D14', 4, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 3900.00, '2021-11-01', 'OWN0313', 'TEN0313', 'MMT00093', 'SMT00093', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D15', 4, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 4000.00, '2021-11-01', 'OWN0314', 'TEN0314', 'MMT00094', 'SMT00094', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T04'), 'D16', 4, 'apartment', 1100.00, 'occupied', 'active', 3, 2, TRUE, 2, 4100.00, '2021-11-01', 'OWN0315', 'TEN0315', 'MMT00095', 'SMT00095', '["AC","Large Balcony","Dual Parking"]', 'Spacious 3-bedroom unit with garden access'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E01', 1, 'apartment', 1050.00, 'vacant', 'active', 3, 2, TRUE, 1, 2550.00, '2021-11-15', 'OWN0320', NULL, 'MMT00096', 'SMT00096', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E02', 1, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 2630.00, '2021-11-15', 'OWN0321', 'TEN0321', 'MMT00097', 'SMT00097', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E03', 1, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 2710.00, '2021-11-15', 'OWN0322', 'TEN0322', 'MMT00098', 'SMT00098', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E04', 1, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 2790.00, '2021-11-15', 'OWN0323', NULL, 'MMT00099', 'SMT00099', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E05', 2, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 2870.00, '2021-11-15', 'OWN0324', 'TEN0324', 'MMT00100', 'SMT00100', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E06', 2, 'apartment', 1050.00, 'vacant', 'active', 3, 2, TRUE, 1, 2950.00, '2021-11-15', 'OWN0325', 'TEN0325', 'MMT00101', 'SMT00101', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E07', 2, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 3030.00, '2021-11-15', 'OWN0326', NULL, 'MMT00102', 'SMT00102', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E08', 2, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 3110.00, '2021-11-15', 'OWN0327', 'TEN0327', 'MMT00103', 'SMT00103', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E09', 3, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 3190.00, '2021-11-15', 'OWN0328', 'TEN0328', 'MMT00104', 'SMT00104', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E10', 3, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 3270.00, '2021-11-15', 'OWN0329', NULL, 'MMT00105', 'SMT00105', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E11', 3, 'apartment', 1050.00, 'vacant', 'active', 3, 2, TRUE, 1, 3350.00, '2021-11-15', 'OWN0330', 'TEN0330', 'MMT00106', 'SMT00106', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E12', 3, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 3430.00, '2021-11-15', 'OWN0331', 'TEN0331', 'MMT00107', 'SMT00107', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E13', 4, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 3510.00, '2021-11-15', 'OWN0332', NULL, 'MMT00108', 'SMT00108', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E14', 4, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 3590.00, '2021-11-15', 'OWN0333', 'TEN0333', 'MMT00109', 'SMT00109', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E15', 4, 'apartment', 1050.00, 'occupied', 'active', 3, 2, TRUE, 1, 3670.00, '2021-11-15', 'OWN0334', 'TEN0334', 'MMT00110', 'SMT00110', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views'),
  ((SELECT id FROM properties WHERE property_code = 'AZR-T05'), 'E16', 4, 'apartment', 1050.00, 'vacant', 'active', 3, 2, TRUE, 1, 3750.00, '2021-11-15', 'OWN0335', NULL, 'MMT00111', 'SMT00111', '["AC","Balcony","Storage Room"]', 'Premium 3-bedroom unit with orchard views');

-- ---------------------------------------------------------------------------
-- Step 4: Backfill business_code for any row still missing one — identical
-- logic to BusinessCodeMigrationService.onApplicationBootstrap(). Scoped to
-- IS NULL only, so this never touches rows that already have a code.
-- ---------------------------------------------------------------------------

UPDATE communities SET business_code = CONCAT('COM-', LPAD(id, 6, '0')) WHERE business_code IS NULL;
UPDATE properties  SET business_code = CONCAT('PRP-', LPAD(id, 6, '0')) WHERE business_code IS NULL;
UPDATE units       SET business_code = CONCAT('UNT-', LPAD(id, 6, '0')) WHERE business_code IS NULL;

COMMIT;

-- ---------------------------------------------------------------------------
-- Step 5: Verify — communities and their property counts.
-- ---------------------------------------------------------------------------

SELECT
  c.business_code, c.name, c.code, c.community_status,
  COUNT(DISTINCT p.id) AS property_count,
  COUNT(u.id) AS unit_count
FROM communities c
LEFT JOIN properties p ON p.community_id = c.id
LEFT JOIN units u ON u.property_id = p.id
WHERE c.code IN ('AZR','AZP','AZS','AZG','AZH','AZJ','AZC','AZV')
GROUP BY c.id
ORDER BY c.id;
