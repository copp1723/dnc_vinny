import { TaskResult } from '../../../priority3-orchestration/TaskOrchestrator';
import { VinSolutionsCredentials } from '../../adapters/vinsolutions-customer-extractor/types';
import { PossibleNOWConfig } from '../../api-clients/possiblenow/types';

// Re-export TaskResult for services that need it
export { TaskResult };

/**
 * Dealership configuration
 */
export interface DealershipConfig {
  id: string;
  name: string;
  credentials: VinSolutionsCredentials;
  settings: {
    markDNCInCRM: boolean;
    addDNCTag: boolean;
    updateContactPreferences: boolean;
    dncFieldName?: string;
    dncTagName?: string;
  };
}

/**
 * Workflow configuration
 */
export interface WorkflowConfig {
  // Dealerships to process
  dealerships: DealershipConfig[];
  
  // PossibleNOW API configuration
  possibleNow: PossibleNOWConfig;
  
  // Workflow settings
  batchSize: number;
  parallelWorkers: number;
  checkpointDir: string;
  
  // Browser settings
  headless: boolean;
  slowMo: number;
  screenshotOnError: boolean;
  
  // Retry policies
  retryAttempts: number;
  retryDelay: number;
  
  // Error handling
  stopOnError: boolean;
  partialCompletionAllowed: boolean;
  
  // Reporting
  reporting: ReportingConfig;
  
  // Scheduling
  scheduling?: SchedulingConfig;
}

/**
 * Reporting configuration
 */
export interface ReportingConfig {
  outputDir: string;
  formats: ('pdf' | 'excel' | 'json' | 'html')[];
  includeScreenshots: boolean;
  emailRecipients?: string[];
  emailOnCompletion: boolean;
  emailOnError: boolean;
  retentionDays: number;
}

/**
 * Scheduling configuration
 */
export interface SchedulingConfig {
  enabled: boolean;
  cronExpression: string; // e.g., "0 0 1 * *" for monthly
  timezone: string;
  maxConcurrentRuns: number;
  notifyBeforeRun: boolean;
  notificationLeadTime: number; // minutes
}

/**
 * Workflow execution result
 */
export interface WorkflowExecutionResult {
  dealershipId: string;
  dealershipName: string;
  success: boolean;
  startTime: Date;
  endTime: Date;
  duration: number;
  taskResults: Map<string, TaskResult>;
  summary?: string;
  error?: string;
  stats?: WorkflowStats;
}

/**
 * Workflow statistics
 */
export interface WorkflowStats {
  totalCustomersProcessed: number;
  totalPhoneNumbersChecked: number;
  dncNumbersFound: number;
  successfullyMarked: number;
  failedToMark: number;
  processingRate: number; // customers per minute
  apiCallsMade: number;
  apiCreditsUsed: number;
}

/**
 * Checkpoint data for resume capability
 */
export interface CheckpointData {
  dealershipId: string;
  stage: string;
  timestamp: Date;
  lastProcessedCustomer?: number;
  lastProcessedBatch?: number;
  batchId?: string;
  customData?: any;
}

/**
 * Progress information
 */
export interface ProgressInfo {
  stage: string;
  current: number;
  total: number;
  percentage: number;
  estimatedTimeRemaining: number; // milliseconds
  processingRate: number; // items per second
}

/**
 * DNC marking options
 */
export interface DNCMarkingOptions {
  updateMethod: 'tag' | 'field' | 'both';
  tagName?: string;
  fieldName?: string;
  addNote: boolean;
  noteTemplate?: string;
  updateContactPreferences: boolean;
  optOutFromMarketing: boolean;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  timestamp: Date;
  dealershipId: string;
  action: string;
  details: any;
  userId?: string;
  success: boolean;
  error?: string;
}

/**
 * Monitoring metrics
 */
export interface MonitoringMetrics {
  workflowId: string;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'failed' | 'aborted';
  currentStage: string;
  progress: ProgressInfo;
  resourceUsage: {
    cpuUsage: number;
    memoryUsage: number;
    apiCallsPerMinute: number;
  };
  errors: Array<{
    timestamp: Date;
    stage: string;
    error: string;
    recoverable: boolean;
  }>;
}

/**
 * Error recovery options
 */
export interface ErrorRecoveryOptions {
  maxRetries: number;
  backoffMultiplier: number;
  maxBackoffDelay: number;
  retryableErrors: string[];
  fallbackStrategies: {
    [errorType: string]: () => Promise<void>;
  };
}

/**
 * Batch processing result
 */
export interface BatchProcessingResult {
  batchIndex: number;
  batchSize: number;
  successCount: number;
  failureCount: number;
  errors: Array<{
    recordId: string;
    error: string;
  }>;
  duration: number;
}

/**
 * Customer DNC result
 */
export interface CustomerDNCResult {
  customerId: string;
  customerName: string;
  phoneNumbers: string[];
  dncResults: Array<{
    phoneNumber: string;
    isDNC: boolean;
    dncType?: 'federal' | 'state' | 'internal';
    checkedDate: Date;
    expirationDate?: Date;
  }>;
  overallDNCStatus: boolean;
  markedInCRM: boolean;
  markingError?: string;
}