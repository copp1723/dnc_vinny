// Validation Middleware
// Centralized validation middleware with mass assignment protection

import { z } from 'zod';
import { Request, Response, NextFunction } from 'express';

// Enhanced validation middleware with mass assignment protection
export function validateRequest(schema: {
  body?: z.ZodSchema;
  query?: z.ZodSchema;
  params?: z.ZodSchema;
}) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate body
      if (schema.body) {
        const validated = await schema.body.parseAsync(req.body);
        // Replace body with validated data to prevent mass assignment
        req.body = validated;
      }
      
      // Validate query
      if (schema.query) {
        const validated = await schema.query.parseAsync(req.query);
        req.query = validated as any;
      }
      
      // Validate params
      if (schema.params) {
        const validated = await schema.params.parseAsync(req.params);
        req.params = validated as any;
      }
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            // Only show details in development
            details: process.env.NODE_ENV === 'development' ? error.errors : undefined
          }
        });
      }
      
      return res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Request validation failed'
        }
      });
    }
  };
}
