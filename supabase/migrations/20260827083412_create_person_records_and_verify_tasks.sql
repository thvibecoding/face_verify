/*
# Create person_records and verify_tasks tables

1. New Tables
- `person_records` — 预存人员档案表 (pre-loaded person records / ID document archive)
  - `id` uuid PK
  - `mrz_text` text nullable — 证件机读码 MRZ
  - `full_name` text NOT NULL — 姓名
  - `document_no` text NOT NULL — 证件编号
  - `date_of_birth` text NOT NULL — 出生日期
  - `document_face_img_url` text NOT NULL — 证件照 URL (relative path in private storage bucket)
  - `name_en` text nullable — 英文姓名
  - `issue_org` text NOT NULL — 发证机关
  - `issue_date` text NOT NULL — 发证日期
  - `sex` text NOT NULL — 性别
  - `country` text NOT NULL — 国籍
- `verify_tasks` — 核验任务表 (face verification tasks)
  - `id` uuid PK
  - `person_id` uuid NOT NULL FK → person_records.id
  - `session_id` text NOT NULL UNIQUE — ID Analyzer DocuPass reference code
  - `session_kycid` text NOT NULL — ID Analyzer KYC profile ID
  - `session_url` text NOT NULL — ID Analyzer DocuPass verification URL
  - `status` text NOT NULL DEFAULT '待核验' — 核验状态 (待核验/通过/未通过)
  - `created_at` timestamptz DEFAULT now()
  - `finished_at` timestamptz nullable
  - `image_url` text nullable — 现场拍摄的人脸照片相对 URL (in private storage bucket)
  - `transaction_id` text nullable — ID Analyzer transaction ID (filled when verification completes)

2. Security
- Enable RLS on both tables.
- No login / auth screen in this app → policies use `TO anon, authenticated`.
- `person_records` is read-only (SELECT only for anon/authenticated); no INSERT/UPDATE/DELETE policies.
- `verify_tasks` allows full CRUD for anon/authenticated (shared internal tool, no user isolation).

3. Indexes
- Index on `person_records.document_no` for fast lookup by document number (扫码枪扫描).
- Index on `verify_tasks.person_id` for listing tasks per person.
- Index on `verify_tasks.session_id` for status lookups.
*/

CREATE TABLE IF NOT EXISTS person_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mrz_text text,
  full_name text NOT NULL,
  document_no text NOT NULL,
  date_of_birth text NOT NULL,
  document_face_img_url text NOT NULL,
  name_en text,
  issue_org text NOT NULL,
  issue_date text NOT NULL,
  sex text NOT NULL,
  country text NOT NULL
);

CREATE TABLE IF NOT EXISTS verify_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES person_records(id) ON DELETE CASCADE,
  session_id text NOT NULL UNIQUE,
  session_kycid text NOT NULL,
  session_url text NOT NULL,
  status text NOT NULL DEFAULT '待核验',
  created_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  image_url text,
  transaction_id text
);

ALTER TABLE person_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE verify_tasks ENABLE ROW LEVEL SECURITY;

-- person_records: read-only for anon/authenticated (this table is pre-loaded, no writes from app)
DROP POLICY IF EXISTS "anon_select_person_records" ON person_records;
CREATE POLICY "anon_select_person_records"
  ON person_records FOR SELECT
  TO anon, authenticated USING (true);

-- verify_tasks: full CRUD for anon/authenticated (shared internal tool)
DROP POLICY IF EXISTS "anon_select_verify_tasks" ON verify_tasks;
CREATE POLICY "anon_select_verify_tasks"
  ON verify_tasks FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_verify_tasks" ON verify_tasks;
CREATE POLICY "anon_insert_verify_tasks"
  ON verify_tasks FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_verify_tasks" ON verify_tasks;
CREATE POLICY "anon_update_verify_tasks"
  ON verify_tasks FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_verify_tasks" ON verify_tasks;
CREATE POLICY "anon_delete_verify_tasks"
  ON verify_tasks FOR DELETE
  TO anon, authenticated USING (true);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_person_records_document_no ON person_records(document_no);
CREATE INDEX IF NOT EXISTS idx_verify_tasks_person_id ON verify_tasks(person_id);
CREATE INDEX IF NOT EXISTS idx_verify_tasks_session_id ON verify_tasks(session_id);
