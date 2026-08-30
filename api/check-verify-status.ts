import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const ID_ANALYZER_API_URL = "https://api2.idanalyzer.com";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const idAnalyzerApiKey = process.env.ID_ANALYZER_API_KEY;
    if (!idAnalyzerApiKey) {
      return res.status(500).json({
        error: "ID Analyzer API key is not configured",
      });
    }

    const { sessionId, taskId } = req.query;

    if (!sessionId && !taskId) {
      return res.status(400).json({
        error: "sessionId or taskId is required",
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let query = supabase.from("verify_tasks").select("*");
    if (sessionId) {
      query = query.eq("session_id", sessionId as string);
    } else {
      query = query.eq("id", taskId as string);
    }

    const { data: task, error: taskError } = await query.maybeSingle();

    if (taskError || !task) {
      return res.status(404).json({ error: "Verification task not found" });
    }

    if (task.status !== "待核验") {
      return res.status(200).json({
        success: true,
        status: task.status,
        finishedAt: task.finished_at,
        imageUrl: task.image_url,
        sessionId: task.session_id,
        transactionId: task.transaction_id,
      });
    }

    const sessionResp = await fetch(
      `${ID_ANALYZER_API_URL}/docupass/${task.session_id}`,
      {
        method: "GET",
        headers: { "X-API-KEY": idAnalyzerApiKey },
      },
    );

    const sessionData = await sessionResp.json();

    if (!sessionResp.ok) {
      console.error("DocuPass session lookup failed:", sessionData);
      return res.status(502).json({
        error: "Failed to check session status",
        details: sessionData,
      });
    }

    const decision: string | undefined = sessionData.decision;
    const transactionId: string | undefined = sessionData.transactionId;
    const finalTransaction: Record<string, unknown> | undefined =
      sessionData.finalTransaction;

    if (!decision && !transactionId) {
      return res.status(200).json({
        success: true,
        status: "待核验",
        sessionId: task.session_id,
      });
    }

    let newStatus: string = "待核验";
    const decisionLower = (decision || "").toLowerCase();
    if (decisionLower === "pass" || decisionLower === "approved") {
      newStatus = "通过";
    } else if (
      decisionLower === "reject" ||
      decisionLower === "rejected" ||
      decisionLower === "review"
    ) {
      newStatus = "未通过";
    } else if (transactionId) {
      newStatus = "通过";
    }

    let imageUrl: string | null = task.image_url;

    const txId = transactionId || (finalTransaction?.id as string | undefined);
    if (txId && !imageUrl) {
      try {
        const txResp = await fetch(
          `${ID_ANALYZER_API_URL}/transaction/${txId}`,
          {
            method: "GET",
            headers: { "X-API-KEY": idAnalyzerApiKey },
          },
        );
        const txData = await txResp.json();

        if (txResp.ok && txData.outputImage) {
          const faceToken =
            txData.outputImage.face || txData.outputImage.front;
          if (faceToken) {
            const imgResp = await fetch(
              `${ID_ANALYZER_API_URL}/imagevault/${faceToken}`,
              {
                method: "GET",
                headers: { "X-API-KEY": idAnalyzerApiKey },
              },
            );

            if (imgResp.ok) {
              const imgBuffer = await imgResp.arrayBuffer();
              const imgBytes = new Uint8Array(imgBuffer);
              const fileName = `verify/${task.id}/face_${Date.now()}.jpg`;
              const uploadResp = await supabase.storage
                .from("person-documents")
                .upload(fileName, imgBytes, {
                  contentType: "image/jpeg",
                  upsert: true,
                });

              if (!uploadResp.error) {
                imageUrl = fileName;
              }
            }
          }
        }
      } catch (imgErr) {
        console.error("Failed to download face image:", imgErr);
      }
    }

    const updateData: Record<string, unknown> = {
      status: newStatus,
      finished_at: new Date().toISOString(),
      transaction_id: txId || null,
    };
    if (imageUrl) {
      updateData.image_url = imageUrl;
    }

    const { error: updateError } = await supabase
      .from("verify_tasks")
      .update(updateData)
      .eq("id", task.id);

    if (updateError) {
      console.error("Failed to update verify_tasks:", updateError);
    }

    return res.status(200).json({
      success: true,
      status: newStatus,
      finishedAt: updateData.finished_at,
      imageUrl: imageUrl,
      sessionId: task.session_id,
      transactionId: txId || null,
      decision: decision || null,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
}
