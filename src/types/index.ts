export interface PersonRecord {
  id: string;
  mrz_text: string | null;
  full_name: string;
  document_no: string;
  date_of_birth: string;
  document_face_img_url: string;
  name_en: string | null;
  issue_org: string;
  issue_date: string;
  sex: string;
  country: string;
}

export interface VerifyTask {
  id: string;
  person_id: string;
  session_id: string;
  session_kycid: string;
  session_url: string;
  status: string;
  created_at: string;
  finished_at: string | null;
  image_url: string | null;
  transaction_id: string | null;
}
