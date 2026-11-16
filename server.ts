import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3';

const SUPPORTED_MIME_TYPES = [
  'application/vnd.google-apps.document',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'text/csv',
  'application/json',
  'text/html',
];

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured on the server.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function sanitizeFilenameStem(raw: string): string {
  return raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);
}

function formatFilename(
  rawTopicTitle: string,
  originalName: string,
  mimeType: string,
  namingStyle: 'title-case' | 'kebab-case' | 'snake_case'
): string {
  const isGoogleDoc = mimeType === 'application/vnd.google-apps.document';
  const extMatch = !isGoogleDoc ? originalName.match(/(\.[a-zA-Z0-9]{1,8})$/) : null;
  const extension = extMatch ? extMatch[1].toLowerCase() : '';

  const cleaned = sanitizeFilenameStem(rawTopicTitle)
    .replace(/\.[a-zA-Z0-9]{1,8}$/, '')
    .trim();

  const words = cleaned
    .split(/[\s_-]+/)
    .map((w) => w.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return originalName;
  }

  let stem = '';
  if (namingStyle === 'kebab-case') {
    stem = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean).join('-');
  } else if (namingStyle === 'snake_case') {
    stem = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean).join('_');
  } else {
    stem = words
      .map((w) => {
        if (/^[A-Z0-9]{2,5}$/.test(w)) return w;
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(' ');
  }

  return `${stem || 'Untitled Document'}${extension}`;
}

async function fetchDriveSnippet(
  accessToken: string,
  fileId: string,
  mimeType: string
): Promise<string> {
  const isGoogleDoc = mimeType === 'application/vnd.google-apps.document';
  const url = isGoogleDoc
    ? `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`
    : `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Drive content fetch failed (${response.status}): ${errText.slice(0, 200)}`);
  }

  const text = await response.text();
  return text.replace(/\r\n/g, '\n').trim().slice(0, 4500);
}

async function analyzeSnippetWithGemini(
  ai: GoogleGenAI,
  originalName: string,
  mimeType: string,
  snippet: string,
  namingStyle: 'title-case' | 'kebab-case' | 'snake_case'
): Promise<{
  coreTopic: string;
  summary: string;
  proposedName: string;
  confidence: 'high' | 'medium' | 'low';
  keywords: string[];
}> {
  if (!snippet || snippet.length < 10) {
    return {
      coreTopic: 'Empty Document',
      summary: 'This file contains little or no extractable text content.',
      proposedName: originalName,
      confidence: 'low',
      keywords: ['empty'],
    };
  }

  const prompt = [
    `Analyze the following document snippet from a file currently named "${originalName}".`,
    `Determine its core topic, write a concise 1-2 sentence factual summary, extract 3-4 topic keywords, and propose a clean, descriptive document title (4 to 7 words, no file extension, no dates unless central to the document).`,
    '',
    'Document Snippet:',
    '---',
    snippet,
    '---',
  ].join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'You are a precision document archivist. Extract the core topic and produce a clear, descriptive filename title from the document content. Avoid vague words like Notes, Document, File, or Draft unless genuinely essential.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          coreTopic: {
            type: Type.STRING,
            description: 'Short 2-4 word core topic label.',
          },
          summary: {
            type: Type.STRING,
            description: 'Concise 1-2 sentence summary of the document content.',
          },
          proposedTitle: {
            type: Type.STRING,
            description: 'Descriptive 4-7 word document title without file extension.',
          },
          confidence: {
            type: Type.STRING,
            description: 'Confidence level: high, medium, or low.',
          },
          keywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '3 to 4 concise topic keywords.',
          },
        },
        required: ['coreTopic', 'summary', 'proposedTitle', 'confidence', 'keywords'],
      },
    },
  });

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText) as {
    coreTopic?: string;
    summary?: string;
    proposedTitle?: string;
    confidence?: string;
    keywords?: string[];
  };

  const confidenceNormalized =
    parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
      ? parsed.confidence
      : 'medium';

  const proposedName = formatFilename(
    parsed.proposedTitle || parsed.coreTopic || originalName,
    originalName,
    mimeType,
    namingStyle
  );

  return {
    coreTopic: (parsed.coreTopic || 'General Topic').trim(),
    summary: (parsed.summary || 'Summary unavailable.').trim(),
    proposedName,
    confidence: confidenceNormalized,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, 4) : [],
  };
}

async function createMultipartDriveFile(
  accessToken: string,
  metadata: { name: string; mimeType: string },
  content: string,
  sourceMimeType = 'text/plain'
) {
  const boundary = `drivetopic_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${sourceMimeType}; charset=UTF-8\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--`;

  const response = await fetch(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Drive upload failed (${response.status}): ${errText}`);
  }

  return response.json();
}

const SAMPLE_DRIVE_FILES = [
  {
    name: 'untitled_export_04.txt',
    mimeType: 'text/plain',
    sourceMimeType: 'text/plain',
    content: `Q4 Cloud Infrastructure Cost Audit & Optimization Plan

Prepared by Platform Engineering
Summary of Compute & Storage Spend:
1. Unattached EBS volumes and idle staging clusters accounted for $14,200/month in wasted spend across us-west-2 and eu-central-1.
2. Migrating batch ETL pipelines to spot instances and enabling S3 Intelligent-Tiering is projected to reduce monthly cloud billing by 28%.
3. Action items: Decommission legacy Kubernetes node pools by November 30, enforce automated tagging policies on Terraform modules, and set budget threshold alerts at 80% utilization.`,
  },
  {
    name: 'raw_meeting_dump_v2',
    mimeType: 'application/vnd.google-apps.document',
    sourceMimeType: 'text/plain',
    content: `Engineering Onboarding Checklist & First 30 Days Guide

Welcome to the Product Engineering Team.
Week 1 Setup:
- Provision SSO credentials, GitHub organization access, and local Docker development containers.
- Pair with your onboarding mentor to deploy a small documentation or bugfix pull request to staging.
Week 2-4 Milestones:
- Shadow one production on-call rotation and review incident response runbooks.
- Complete security awareness training and attend the architecture deep-dive session on our event-driven billing pipeline.`,
  },
  {
    name: 'notes_temp_991.md',
    mimeType: 'text/markdown',
    sourceMimeType: 'text/markdown',
    content: `# Customer Churn Exit Interview Synthesis (October)

We interviewed 18 churned mid-market accounts between September 15 and October 28.
Key Findings:
- 61% cited slow initial CSV data import speeds for datasets over 250k rows.
- 44% requested native SSO SAML integration on the Growth tier rather than Enterprise-only gating.
- 33% experienced confusion configuring webhook retry backoff intervals.
Recommended Product Roadmap Priorities:
Streamline the bulk importer with streaming validation and publish prebuilt Terraform/Webhook starter templates.`,
  },
  {
    name: 'doc_scan_final_REAL.txt',
    mimeType: 'text/plain',
    sourceMimeType: 'text/plain',
    content: `Mediterranean Roasted Eggplant & Chickpea Bowl Recipe

Prep time: 15 minutes | Cook time: 30 minutes | Servings: 4
Ingredients:
- 2 medium eggplants, cubed into 1-inch pieces
- 1 can chickpeas, drained and patted dry
- 3 tbsp extra virgin olive oil, 1 tsp smoked paprika, 1 tsp ground cumin
- Lemon-tahini dressing: 1/3 cup tahini, juice of 1 lemon, 1 minced garlic clove, cold water to thin
Instructions:
Roast seasoned eggplant and chickpeas at 425°F for 25 minutes until caramelized and crisp. Serve over warm farro with pickled red onions, fresh parsley, and lemon-tahini drizzle.`,
  },
];

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // List text & Google Doc files accessible via Google Drive API
  app.get('/api/drive/files', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing Google Drive access token.' });
      return;
    }

    try {
      const mimeQuery = SUPPORTED_MIME_TYPES.map((m) => `mimeType='${m}'`).join(' or ');
      const q = `trashed = false and (${mimeQuery})`;
      const params = new URLSearchParams({
        q,
        fields: 'files(id,name,mimeType,modifiedTime,size,webViewLink)',
        orderBy: 'modifiedTime desc',
        pageSize: '50',
      });

      const driveRes = await fetch(`${DRIVE_API_BASE}/files?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await driveRes.json()) as {
        files?: Array<{
          id: string;
          name: string;
          mimeType: string;
          modifiedTime?: string;
          size?: string;
          webViewLink?: string;
        }>;
        error?: { message?: string; code?: number };
      };

      if (!driveRes.ok) {
        res.status(driveRes.status).json({
          error: data.error?.message || 'Failed to fetch files from Google Drive.',
        });
        return;
      }

      res.json({ files: data.files || [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to communicate with Google Drive.';
      res.status(500).json({ error: message });
    }
  });

  // Read file snippets from Drive and analyze core topic with Gemini
  app.post('/api/drive/analyze', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing Google Drive access token.' });
      return;
    }

    const { files, namingStyle = 'title-case' } = req.body as {
      files?: Array<{ id: string; name: string; mimeType: string }>;
      namingStyle?: 'title-case' | 'kebab-case' | 'snake_case';
    };

    if (!Array.isArray(files) || files.length === 0) {
      res.status(400).json({ error: 'No files provided for analysis.' });
      return;
    }

    try {
      const ai = getGeminiClient();
      const analyses = [];

      // Process in small batches of 3 to avoid Drive/Gemini rate spikes
      const batchSize = 3;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (file) => {
            try {
              const snippet = await fetchDriveSnippet(token, file.id, file.mimeType);
              const result = await analyzeSnippetWithGemini(
                ai,
                file.name,
                file.mimeType,
                snippet,
                namingStyle
              );
              return {
                fileId: file.id,
                snippet: snippet.slice(0, 600),
                ...result,
              };
            } catch (fileErr) {
              const errMsg = fileErr instanceof Error ? fileErr.message : 'Analysis failed';
              return {
                fileId: file.id,
                snippet: '',
                coreTopic: 'Analysis Failed',
                summary: errMsg,
                proposedName: file.name,
                confidence: 'low' as const,
                keywords: [],
                error: errMsg,
              };
            }
          })
        );
        analyses.push(...batchResults);
      }

      res.json({ analyses });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Content analysis failed.';
      res.status(500).json({ error: message });
    }
  });

  // Execute Drive API files.update to rename a file
  app.post('/api/drive/rename', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing Google Drive access token.' });
      return;
    }

    const { fileId, newName } = req.body as { fileId?: string; newName?: string };
    const cleanName = typeof newName === 'string' ? sanitizeFilenameStem(newName) : '';

    if (!fileId || !cleanName) {
      res.status(400).json({ error: 'Both fileId and a valid newName are required.' });
      return;
    }

    try {
      const driveRes = await fetch(
        `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size,webViewLink`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: cleanName }),
        }
      );

      const data = (await driveRes.json()) as {
        id?: string;
        name?: string;
        mimeType?: string;
        modifiedTime?: string;
        size?: string;
        webViewLink?: string;
        error?: { message?: string };
      };

      if (!driveRes.ok) {
        res.status(driveRes.status).json({
          error: data.error?.message || 'Google Drive rename request failed.',
        });
        return;
      }

      res.json({ file: data });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Rename execution failed.';
      res.status(500).json({ error: message });
    }
  });

  // Seed realistic messy-named files into the user's Google Drive (works seamlessly with drive.file scope)
  app.post('/api/drive/seed', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing Google Drive access token.' });
      return;
    }

    try {
      const created = [];
      for (const sample of SAMPLE_DRIVE_FILES) {
        const file = await createMultipartDriveFile(
          token,
          { name: sample.name, mimeType: sample.mimeType },
          sample.content,
          sample.sourceMimeType
        );
        created.push(file);
      }
      res.json({ files: created });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create sample Drive files.';
      res.status(500).json({ error: message });
    }
  });

  // Upload a local text/markdown/csv file directly to Google Drive
  app.post('/api/drive/upload', async (req: Request, res: Response) => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing Google Drive access token.' });
      return;
    }

    const { name, content, mimeType, convertToGoogleDoc } = req.body as {
      name?: string;
      content?: string;
      mimeType?: string;
      convertToGoogleDoc?: boolean;
    };

    if (!name || typeof content !== 'string') {
      res.status(400).json({ error: 'File name and text content are required.' });
      return;
    }

    try {
      const sourceMime = mimeType && mimeType.startsWith('text/') ? mimeType : 'text/plain';
      const targetMime = convertToGoogleDoc ? 'application/vnd.google-apps.document' : sourceMime;
      const file = await createMultipartDriveFile(
        token,
        { name: sanitizeFilenameStem(name) || 'uploaded_note.txt', mimeType: targetMime },
        content,
        sourceMime
      );
      res.json({ file });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload file to Google Drive.';
      res.status(500).json({ error: message });
    }
  });

  // Serve Vite middleware in development or static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
