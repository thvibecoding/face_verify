import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const ID_ANALYZER_API_URL = "https://api2.idanalyzer.com";

interface PersonRecord {
  id: string;
  full_name: string;
  document_no: string;
  document_face_img_url: string;
}

function buildKycProfilePayload(person: PersonRecord): Record<string, unknown> {
  return {
    crop: false,
    name: `face-verify-${person.document_no}-${Date.now()}`,
    obscure: [],
    webhook: "",
    docupass: {
      expiry: 0,
      qrSize: 8,
      logoURL: "",
      qrColor: "000000",
      qrMargin: 8,
      trackGps: false,
      acceptUrl: "",
      expireUrl: "",
      qrBGColor: "FFFFFF",
      rejectUrl: "",
      reviewUrl: "",
      cameraMode: 1,
      maxAttempt: 3,
      reviewData: false,
      smsContent: "",
      allowIframe: true,
      companyName: "",
      customField: [],
      documentSide: 0,
      restrictDevice: 0,
      welcomeMessage: "",
      allowFileUpload: false,
      faceCaptureMode: 1,
      customDocuPassURL: "",
      phoneVerification: 0,
      documentCaptureMode: 0,
      docupassAuditReport: false,
    },
    timezone: "Asia/Shanghai",
    decisions: {
      FAKE_ID: { reject: -1, review: -1, weight: 1, enabled: false },
      UNKNOWN: { reject: -1, review: -1, weight: 1, enabled: false },
      IMAGE_EDITED: { reject: -1, review: -1, weight: 1, enabled: false },
      MISSING_NAME: { reject: -1, review: -1, weight: 1, enabled: false },
      TEXT_FORGERY: { reject: -1, review: -1, weight: 1, enabled: false },
      FACE_MISMATCH: { reject: 0, review: -1, weight: 1, enabled: true },
      IMAGE_FORGERY: { reject: -1, review: -1, weight: 1, enabled: false },
      FACE_IDENTICAL: { reject: -1, review: -1, weight: 1, enabled: false },
      GLARE_DETECTED: { reject: -1, review: -1, weight: 1, enabled: false },
      MISSING_GENDER: { reject: -1, review: -1, weight: 1, enabled: false },
      MISSING_DOB: { reject: -1, review: -1, weight: 1, enabled: false },
      MISSING_EXPIRY: { reject: -1, review: -1, weight: 1, enabled: false },
      MISSING_DOCUMENT: { reject: -1, review: -1, weight: 1, enabled: false },
      DOCUMENT_EXPIRED: { reject: -1, review: -1, weight: 1, enabled: false },
      EXPIRY_WARNING: { reject: -1, review: -1, weight: 1, enabled: false },
      UNDER_18: { reject: -1, review: -1, weight: 1, enabled: false },
      UNDER_19: { reject: -1, review: -1, weight: 1, enabled: false },
      UNDER_20: { reject: -1, review: -1, weight: 1, enabled: false },
      UNDER_21: { reject: -1, review: -1, weight: 1, enabled: false },
      AML_PEP: { reject: -1, review: 0, weight: 1, enabled: false },
      AML_CRIME: { reject: -1, review: 0, weight: 1, enabled: false },
      AML_SANCTION: { reject: -1, review: 0, weight: 1, enabled: false },
      NAME_MISMATCH: { reject: -1, review: -1, weight: 1, enabled: false },
      DOB_MISMATCH: { reject: -1, review: -1, weight: 1, enabled: false },
      ADDRESS_MISMATCH: { reject: -1, review: -1, weight: 1, enabled: false },
      DOCUMENT_NUMBER_MISMATCH: {
        reject: -1,
        review: -1,
        weight: 1,
        enabled: false,
      },
      POSTCODE_MISMATCH: { reject: -1, review: -1, weight: 1, enabled: false },
    },
    saveImage: true,
    canvasSize: 1000,
    outputSize: 1000,
    outputType: "url",
    saveResult: true,
    thresholds: {
      AML_PEP: 0,
      AML_CRIME: 0,
      AML_SANCTION: 0,
      face_similarity: 0.6,
      face_liveness: 0.3,
      text_check: 0,
      image_check: 0,
      document_authentication: 0,
    },
    outputImage: true,
    advancedCrop: false,
    inferFullName: false,
    splitFirstName: false,
    decisionTrigger: { maxReview: 3 },
    objectDetection: false,
    acceptedDocuments: {},
    AAMVABarcodeParsing: false,
    orientationCorrection: false,
    transactionAuditReport: false,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const idAnalyzerApiKey = process.env.ID_ANALYZER_API_KEY;
    if (!idAnalyzerApiKey) {
      return res.status(500).json({
        error:
          "ID Analyzer API key is not configured. Set the ID_ANALYZER_API_KEY environment variable in Vercel.",
      });
    }

    const { personId, referenceFaceBase64 } = req.body ?? {};

    if (!personId || !referenceFaceBase64) {
      return res.status(400).json({
        error: "personId and referenceFaceBase64 are required",
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: person, error: personError } = await supabase
      .from("person_records")
      .select("id, full_name, document_no, document_face_img_url")
      .eq("id", personId)
      .maybeSingle();

    if (personError || !person) {
      return res.status(404).json({ error: "Person record not found" });
    }

    const profilePayload = buildKycProfilePayload(person);

    const profileResp = await fetch(`${ID_ANALYZER_API_URL}/profile`, {
      method: "POST",
      headers: {
        "X-API-KEY": idAnalyzerApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(profilePayload),
    });

    const profileData = await profileResp.json();

    if (!profileResp.ok || !profileData.id) {
      console.error("KYC profile creation failed:", profileData);
      return res.status(502).json({
        error: "Failed to create KYC profile",
        details: profileData,
      });
    }

    const kycProfileId: string = profileData.id;

    const docupassPayload = {
      mode: 2,
      profile: kycProfileId,
      version: "3",
      language: "cn",
      referenceFace: referenceFaceBase64,
      customData: person.id,
      profileOverride: {
        saveImage: true,
        saveResult: true,
      },
    };

    const docupassResp = await fetch(`${ID_ANALYZER_API_URL}/docupass`, {
      method: "POST",
      headers: {
        "X-API-KEY": idAnalyzerApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(docupassPayload),
    });

    const docupassData = await docupassResp.json();

    if (!docupassResp.ok || !docupassData.url || !docupassData.reference) {
      console.error("DocuPass session creation failed:", docupassData);
      return res.status(502).json({
        error: "Failed to create verification session",
        details: docupassData,
      });
    }

    const sessionUrl: string = docupassData.url;
    const sessionId: string = docupassData.reference;

    const { data: taskRow, error: insertError } = await supabase
      .from("verify_tasks")
      .insert({
        person_id: person.id,
        session_id: sessionId,
        session_kycid: kycProfileId,
        session_url: sessionUrl,
        status: "待核验",
      })
      .select()
      .single();

    if (insertError || !taskRow) {
      console.error("Failed to insert verify_tasks row:", insertError);
      return res.status(500).json({
        error: "Failed to create verification task record",
      });
    }

    return res.status(200).json({
      success: true,
      taskId: taskRow.id,
      sessionId,
      sessionUrl,
      kycProfileId,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
