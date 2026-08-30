import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ID_ANALYZER_API_URL = "https://api2.idanalyzer.com";
const ID_ANALYZER_API_KEY = Deno.env.get("ID_ANALYZER_API_KEY");

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (!ID_ANALYZER_API_KEY) {
      return jsonResponse(
        { error: "ID Analyzer API key is not configured" },
        500,
      );
    }

    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    const taskId = url.searchParams.get("taskId");

    if (!sessionId && !taskId) {
      return jsonResponse(
        { error: "sessionId or taskId is required" },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find the verify_tasks row
    let query = supabase.from("verify_tasks").select("*");
    if (sessionId) {
      query = query.eq("session_id", sessionId);
    } else {
      query = query.eq("id", taskId);
    }

    const { data: task, error: taskError } = await query.maybeSingle();

    if (taskError || !task) {
      return jsonResponse({ error: "Verification task not found" }, 404);
    }

    // If already finished, return current state
    if (task.status !== "待核验") {
      return jsonResponse({
        success: true,
        status: task.status,
        finishedAt: task.finished_at,
        imageUrl: task.image_url,
        sessionId: task.session_id,
        transactionId: task.transaction_id,
      });
    }

    // Query ID Analyzer DocuPass session status
    const sessionResp = await fetch(
      `${ID_ANALYZER_API_URL}/docupass/${task.session_id}`,
      {
        method: "GET",
        headers: { "X-API-KEY": ID_ANALYZER_API_KEY },
      },
    );

    const sessionData = await sessionResp.json();

    if (!sessionResp.ok) {
      console.error("DocuPass session lookup failed:", sessionData);
      return jsonResponse(
        { error: "Failed to check session status", details: sessionData },
        502,
      );
    }

    // Check if the session has a decision
    const decision: string | undefined = sessionData.decision;
    const transactionId: string | undefined = sessionData.transactionId;
    const finalTransaction: Record<string, unknown> | undefined =
      sessionData.finalTransaction;

    if (!decision && !transactionId) {
      // Still pending — user hasn't completed verification yet
      return jsonResponse({
        success: true,
        status: "待核验",
        sessionId: task.session_id,
      });
    }

    // Map ID Analyzer decision to our status
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
      // Transaction exists but no explicit decision — treat as completed
      newStatus = "通过";
    }

    let imageUrl: string | null = task.image_url;

    // If we have a transaction ID, try to fetch the captured face image
    const txId = transactionId || (finalTransaction?.id as string | undefined);
    if (txId && !imageUrl) {
      try {
        const txResp = await fetch(
          `${ID_ANALYZER_API_URL}/transaction/${txId}`,
          {
            method: "GET",
            headers: { "X-API-KEY": ID_ANALYZER_API_KEY },
          },
        );
        const txData = await txResp.json();

        if (txResp.ok && txData.outputImage) {
          // outputImage may contain face, front, back tokens
          const faceToken =
            txData.outputImage.face || txData.outputImage.front;
          if (faceToken) {
            // Download the face image from ID Analyzer image vault
            const imgResp = await fetch(
              `${ID_ANALYZER_API_URL}/imagevault/${faceToken}`,
              {
                method: "GET",
                headers: { "X-API-KEY": ID_ANALYZER_API_KEY },
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

    // Update the verify_tasks row
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

    return jsonResponse({
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
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Internal server error" },
      500,
    );
  }
});
