import express from "express";
import type { Request, Response } from "express";
import { generateWebsite, generateWebsiteStream } from "./geminiService.ts";
import type { GenerationOptions } from "./geminiService.ts";

export const apiRouter = express.Router();

apiRouter.use(express.json({ limit: "10mb" }));

// Status check
apiRouter.get("/status", (_req: Request, res: Response) => {
  const hasKey = Boolean(process.env.GEMINI_API_KEY);
  res.json({
    status: "ok",
    hasApiKey: hasKey,
    defaultModel: "gemini-3.8-flash",
    models: [
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (سريع ومثالي للويب)", free: true },
      { id: "gemini-4-argon", name: "Gemini 4 Argon (استدلال برمجي فائق)", free: false },
    ],
  });
});

// Stream generation (SSE)
apiRouter.post("/generate-stream", async (req: Request, res: Response) => {
  try {
    const { prompt, currentCode, action, model, language } = req.body as GenerationOptions;

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "Missing prompt parameter" });
      return;
    }

    // Set headers for Server-Sent Events
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    await generateWebsiteStream(
      { prompt, currentCode, action, model, language },
      (chunkText) => {
        res.write(`data: ${JSON.stringify({ chunk: chunkText })}\n\n`);
      }
    );

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("Error in generate-stream:", error);
    // If headers were already sent, send an SSE error event
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: error.message || "Failed to generate code" })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  }
});

// Standard non-streaming generation
apiRouter.post("/generate", async (req: Request, res: Response) => {
  try {
    const { prompt, currentCode, action, model, language } = req.body as GenerationOptions;

    if (!prompt || typeof prompt !== "string") {
      res.status(400).json({ error: "Missing prompt parameter" });
      return;
    }

    const result = await generateWebsite({
      prompt,
      currentCode,
      action,
      model,
      language,
    });

    res.json({ result });
  } catch (error: any) {
    console.error("Error in generate:", error);
    res.status(500).json({ error: error.message || "Internal server error" });
  }
});
