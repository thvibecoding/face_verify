/*
# Create private storage bucket for face/ID photos

1. Storage
- Create bucket `person-documents` (private) for storing 证件照 and 现场拍摄的人脸照片.
- Add storage policies so anon/authenticated can read and upload objects.

2. Security
- The bucket is private (not public).
- Policies allow anon/authenticated to read and upload (no login screen in this app).
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('person-documents', 'person-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Allow anon/authenticated to read objects
DROP POLICY IF EXISTS "anon_read_person_documents" ON storage.objects;
CREATE POLICY "anon_read_person_documents"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'person-documents');

-- Allow anon/authenticated to upload objects
DROP POLICY IF EXISTS "anon_upload_person_documents" ON storage.objects;
CREATE POLICY "anon_upload_person_documents"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'person-documents');

-- Allow anon/authenticated to update objects
DROP POLICY IF EXISTS "anon_update_person_documents" ON storage.objects;
CREATE POLICY "anon_update_person_documents"
  ON storage.objects FOR UPDATE
  TO anon, authenticated
  USING (bucket_id = 'person-documents')
  WITH CHECK (bucket_id = 'person-documents');

-- Allow anon/authenticated to delete objects
DROP POLICY IF EXISTS "anon_delete_person_documents" ON storage.objects;
CREATE POLICY "anon_delete_person_documents"
  ON storage.objects FOR DELETE
  TO anon, authenticated
  USING (bucket_id = 'person-documents');
