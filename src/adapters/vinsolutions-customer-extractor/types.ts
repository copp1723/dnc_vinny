export interface CustomerData {
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  customerId?: string;
  dealershipId?: string;
  lastContactDate?: Date;
  source?: string;
  status?: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

export interface VinSolutionsCredentials {
  username: string;
  password: string;
  url: string;
  dealershipId?: string;
}

export interface CustomerExtractionOptions {
  dateRangeDays: number;
  reportType: CustomerReportType;
  includeInactive?: boolean;
  phoneNumbersOnly?: boolean;
  batchSize?: number;
  maxRecords?: number;
}

export enum CustomerReportType {
  CUSTOMER_CONTACT_LIST = 'customer_contact_list',
  SALES_ACTIVITY_REPORT = 'sales_activity_report',
  CRM_CONTACT_EXPORT = 'crm_contact_export',
  SERVICE_CUSTOMER_LIST = 'service_customer_list',
  MARKETING_LIST = 'marketing_list'
}

export interface ExtractionResult {
  success: boolean;
  reportName: string;
  reportType: CustomerReportType;
  filePath?: string;
  recordCount?: number;
  error?: string;
  screenshots?: string[];
  extractionTime?: number;
  metadata?: {
    dateRange?: {
      start: Date;
      end: Date;
    };
    dealershipInfo?: any;
  };
}

export interface CSVParseOptions {
  delimiter?: string;
  quote?: string;
  escape?: string;
  skipEmptyLines?: boolean;
  skipHeader?: boolean;
  maxRows?: number;
  encoding?: BufferEncoding;
}

export interface PhoneValidationResult {
  isValid: boolean;
  normalizedNumber?: string;
  type?: 'mobile' | 'landline' | 'voip' | 'unknown';
  carrier?: string;
  location?: string;
  error?: string;
}