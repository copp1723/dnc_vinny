import { z } from 'zod';

// VinSolutions Configuration Schema
export const VinSolutionsConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  apiSecret: z.string().min(1),
  dealershipId: z.string().min(1),
  timeout: z.number().positive().default(30000),
  retryAttempts: z.number().int().positive().default(3),
  retryDelay: z.number().positive().default(1000),
});

// PossibleNOW Configuration Schema
export const PossibleNOWConfigSchema = z.object({
  baseUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  accountId: z.string().min(1),
  apiVersion: z.string().default('v1'),
  timeout: z.number().positive().default(30000),
  retryAttempts: z.number().int().positive().default(3),
  webhookUrl: z.string().url().optional(),
});

// Workflow Configuration Schema
export const WorkflowConfigSchema = z.object({
  batchSize: z.number().int().positive().default(100),
  maxConcurrent: z.number().int().positive().default(5),
  processingDelay: z.number().nonnegative().default(1000),
  errorThreshold: z.number().int().positive().default(10),
  retryPolicy: z.object({
    maxRetries: z.number().int().nonnegative().default(3),
    backoffMultiplier: z.number().positive().default(2),
    maxBackoffMs: z.number().positive().default(60000),
  }),
  timeout: z.object({
    job: z.number().positive().default(300000), // 5 minutes
    batch: z.number().positive().default(600000), // 10 minutes
    total: z.number().positive().default(3600000), // 1 hour
  }),
});

// Report Configuration Schema
export const ReportConfigSchema = z.object({
  outputDirectory: z.string().default('./reports'),
  format: z.enum(['json', 'csv', 'html', 'pdf']).default('json'),
  includeMetrics: z.boolean().default(true),
  compression: z.boolean().default(false),
  retention: z.object({
    enabled: z.boolean().default(true),
    days: z.number().int().positive().default(30),
  }),
  notifications: z.object({
    enabled: z.boolean().default(false),
    email: z.string().email().optional(),
    webhook: z.string().url().optional(),
  }),
});

// Schedule Configuration Schema
export const ScheduleConfigSchema = z.object({
  enabled: z.boolean().default(false),
  timezone: z.string().default('America/Los_Angeles'),
  jobs: z.array(z.object({
    name: z.string().min(1),
    type: z.enum(['dnc_sync', 'report_generation', 'cleanup', 'health_check']),
    cron: z.string(),
    enabled: z.boolean().default(true),
    config: z.record(z.any()).optional(),
  })).default([]),
});

// Dealership Configuration Schema
export const DealershipConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  active: z.boolean().default(true),
  vinSolutions: VinSolutionsConfigSchema,
  possibleNOW: PossibleNOWConfigSchema,
  workflow: WorkflowConfigSchema.optional(),
  reports: ReportConfigSchema.optional(),
  schedule: ScheduleConfigSchema.optional(),
  metadata: z.record(z.any()).optional(),
});

// Security Configuration Schema
export const SecurityConfigSchema = z.object({
  encryption: z.object({
    algorithm: z.enum(['aes-256-gcm', 'aes-256-cbc']).default('aes-256-gcm'),
    keyDerivation: z.enum(['pbkdf2', 'scrypt', 'argon2']).default('pbkdf2'),
    saltLength: z.number().int().positive().default(32),
    iterations: z.number().int().positive().default(100000),
  }),
  authentication: z.object({
    required: z.boolean().default(true),
    type: z.enum(['api_key', 'jwt', 'oauth2']).default('api_key'),
    sessionTimeout: z.number().positive().default(3600000), // 1 hour
  }),
  audit: z.object({
    enabled: z.boolean().default(true),
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    retentionDays: z.number().int().positive().default(90),
  }),
});

// Main Configuration Schema
export const ConfigSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  environment: z.enum(['development', 'staging', 'production']).default('development'),
  dealerships: z.array(DealershipConfigSchema),
  security: SecurityConfigSchema,
  global: z.object({
    logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
    tempDirectory: z.string().default('./temp'),
    dataDirectory: z.string().default('./data'),
    healthCheck: z.object({
      enabled: z.boolean().default(true),
      interval: z.number().positive().default(60000), // 1 minute
      timeout: z.number().positive().default(10000),
    }),
  }),
  features: z.object({
    autoSync: z.boolean().default(true),
    webhooks: z.boolean().default(true),
    reporting: z.boolean().default(true),
    scheduling: z.boolean().default(true),
  }),
});

// Type exports
export type VinSolutionsConfig = z.infer<typeof VinSolutionsConfigSchema>;
export type PossibleNOWConfig = z.infer<typeof PossibleNOWConfigSchema>;
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;
export type ReportConfig = z.infer<typeof ReportConfigSchema>;
export type ScheduleConfig = z.infer<typeof ScheduleConfigSchema>;
export type DealershipConfig = z.infer<typeof DealershipConfigSchema>;
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;