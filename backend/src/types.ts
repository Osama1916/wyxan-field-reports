export type ChaosConfig = {
  latencyMs: number;
  failNextN: number;
  failRate: number;
  hang: boolean;
};

export type ReportImage = {
  id: string;
  reportId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sortOrder: number;
  url: string;
};

export type Report = {
  id: string;
  idempotencyKey: string;
  description: string;
  createdAt: string;
  images: ReportImage[];
};

export type ReportSummary = {
  id: string;
  description: string;
  createdAt: string;
  imageCount: number;
};
