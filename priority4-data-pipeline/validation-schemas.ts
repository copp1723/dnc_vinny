import { z } from 'zod';

// User schemas
export const userRegistrationSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long'),
  role: z.enum(['user', 'admin', 'agent']).optional().default('user'),
});

export const userLoginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const userUpdateSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100, 'Name too long').optional(),
  email: z.string().email('Invalid email format').optional(),
  role: z.enum(['user', 'admin', 'agent']).optional(),
}).strict();

// Campaign schemas
export const campaignCreateSchema = z.object({
  name: z.string().min(3, 'Campaign name must be at least 3 characters').max(200, 'Campaign name too long'),
  description: z.string().min(10, 'Description must be at least 10 characters').max(2000, 'Description too long'),
  type: z.enum(['email', 'social', 'search', 'display']),
  status: z.enum(['draft', 'active', 'paused', 'completed']).optional().default('draft'),
  budget: z.number().positive('Budget must be positive').max(1000000, 'Budget too large'),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  targetAudience: z.object({
    demographics: z.array(z.string()).optional(),
    interests: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
  }).optional(),
  settings: z.record(z.any()).optional(),
});

export const campaignUpdateSchema = z.object({
  name: z.string().min(3, 'Campaign name must be at least 3 characters').max(200, 'Campaign name too long').optional(),
  description: z.string().min(10, 'Description must be at least 10 characters').max(2000, 'Description too long').optional(),
  type: z.enum(['email', 'social', 'search', 'display']).optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed']).optional(),
  budget: z.number().positive('Budget must be positive').max(1000000, 'Budget too large').optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  targetAudience: z.object({
    demographics: z.array(z.string()).optional(),
    interests: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
  }).optional(),
  settings: z.record(z.any()).optional(),
}).strict();

// Agent schemas
export const agentCreateSchema = z.object({
  name: z.string().min(2, 'Agent name must be at least 2 characters').max(100, 'Agent name too long'),
  type: z.enum(['email', 'social', 'content', 'analytics']),
  configuration: z.record(z.any()),
  status: z.enum(['active', 'inactive', 'training']).optional().default('inactive'),
  permissions: z.array(z.string()).optional().default([]),
});

export const agentUpdateSchema = z.object({
  name: z.string().min(2, 'Agent name must be at least 2 characters').max(100, 'Agent name too long').optional(),
  type: z.enum(['email', 'social', 'content', 'analytics']).optional(),
  configuration: z.record(z.any()).optional(),
  status: z.enum(['active', 'inactive', 'training']).optional(),
  permissions: z.array(z.string()).optional(),
}).strict();

// Email schemas
export const emailTemplateSchema = z.object({
  name: z.string().min(2, 'Template name must be at least 2 characters').max(100, 'Template name too long'),
  subject: z.string().min(5, 'Subject must be at least 5 characters').max(200, 'Subject too long'),
  body: z.string().min(10, 'Body must be at least 10 characters').max(10000, 'Body too long'),
  variables: z.array(z.string()).optional().default([]),
  type: z.enum(['transactional', 'marketing', 'notification']).optional().default('transactional'),
});

export const emailSendSchema = z.object({
  to: z.array(z.string().email()).min(1, 'At least one recipient is required'),
  subject: z.string().min(1, 'Subject is required').max(200, 'Subject too long'),
  body: z.string().min(1, 'Body is required').max(10000, 'Body too long'),
  templateId: z.string().uuid().optional(),
  variables: z.record(z.string()).optional(),
  priority: z.enum(['low', 'normal', 'high']).optional().default('normal'),
});

// API key schemas
export const apiKeyCreateSchema = z.object({
  name: z.string().min(2, 'Key name must be at least 2 characters').max(100, 'Key name too long'),
  permissions: z.array(z.string()).min(1, 'At least one permission is required'),
  expiresAt: z.string().datetime().optional(),
});

// Query parameter schemas
export const paginationSchema = z.object({
  page: z.string().transform(Number).pipe(z.number().min(1).optional()).optional(),
  limit: z.string().transform(Number).pipe(z.number().min(1).max(100).optional()).optional(),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
});

export const searchSchema = z.object({
  q: z.string().min(1, 'Search query is required').max(200, 'Search query too long'),
  ...paginationSchema.shape,
});

// ID parameter schemas
export const idParamSchema = z.object({
  id: z.string().uuid('Invalid UUID format'),
});

export const campaignIdParamSchema = z.object({
  campaignId: z.string().uuid('Invalid campaign ID format'),
});

export const agentIdParamSchema = z.object({
  agentId: z.string().uuid('Invalid agent ID format'),
});

// Settings schemas
export const settingsUpdateSchema = z.object({
  notifications: z.object({
    email: z.boolean().optional(),
    push: z.boolean().optional(),
    sms: z.boolean().optional(),
  }).optional(),
  privacy: z.object({
    shareData: z.boolean().optional(),
    publicProfile: z.boolean().optional(),
  }).optional(),
  theme: z.enum(['light', 'dark', 'auto']).optional(),
  language: z.string().length(2, 'Language code must be 2 characters').optional(),
}).strict();

// File upload schemas
export const fileUploadSchema = z.object({
  file: z.any().refine((file) => file instanceof File, 'Must be a file'),
  type: z.enum(['image', 'document', 'video', 'audio']).optional(),
  maxSize: z.number().max(10 * 1024 * 1024, 'File too large').optional(), // 10MB default
});

// Webhook schemas
export const webhookSchema = z.object({
  url: z.string().url('Invalid webhook URL'),
  events: z.array(z.string()).min(1, 'At least one event is required'),
  secret: z.string().min(10, 'Secret must be at least 10 characters').optional(),
  active: z.boolean().optional().default(true),
});

// Rate limiting schemas
export const rateLimitSchema = z.object({
  windowMs: z.number().positive().optional().default(15 * 60 * 1000), // 15 minutes
  max: z.number().positive().optional().default(100),
  message: z.string().optional().default('Too many requests from this IP'),
  standardHeaders: z.boolean().optional().default(true),
  legacyHeaders: z.boolean().optional().default(false),
});

// Common response schemas
export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  details: z.any().optional(),
});

export const successResponseSchema = z.object({
  success: z.literal(true),
  data: z.any(),
  message: z.string().optional(),
});

// Validation helper types
export type UserRegistrationInput = z.infer<typeof userRegistrationSchema>;
export type UserLoginInput = z.infer<typeof userLoginSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;
export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;
export type AgentCreateInput = z.infer<typeof agentCreateSchema>;
export type AgentUpdateInput = z.infer<typeof agentUpdateSchema>;
export type EmailTemplateInput = z.infer<typeof emailTemplateSchema>;
export type EmailSendInput = z.infer<typeof emailSendSchema>;
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;
export type PaginationInput = z.infer<typeof paginationSchema>;
export type SearchInput = z.infer<typeof searchSchema>;
export type SettingsUpdateInput = z.infer<typeof settingsUpdateSchema>;
export type WebhookInput = z.infer<typeof webhookSchema>;
export type RateLimitInput = z.infer<typeof rateLimitSchema>;
