import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { Transform, pipeline } from 'stream';
import { promisify } from 'util';
import { CustomerData, CSVParseOptions } from '../types';
import { PhoneNumberUtils } from './PhoneNumberUtils';

const pipelineAsync = promisify(pipeline);

export class CSVStreamParser {
  private processedCount = 0;
  private validRecordCount = 0;
  private errorCount = 0;
  private skippedCount = 0;

  constructor(private options: CSVParseOptions = {}) {
    this.options = {
      delimiter: ',',
      quote: '"',
      escape: '"',
      skipEmptyLines: true,
      skipHeader: false,
      encoding: 'utf-8',
      ...options
    };
  }

  /**
   * Parse CSV file and stream customer data
   */
  async *parseCustomerData(filePath: string): AsyncGenerator<CustomerData, void, unknown> {
    const readStream = createReadStream(filePath, { encoding: this.options.encoding });
    
    const parser = parse({
      delimiter: this.options.delimiter,
      quote: this.options.quote,
      escape: this.options.escape,
      skip_empty_lines: this.options.skipEmptyLines,
      from_line: this.options.skipHeader ? 2 : 1,
      relax_column_count: true,
      skip_records_with_error: true
    });

    let headers: string[] | null = null;
    let isFirstRow = true;

    const transformStream = new Transform({
      objectMode: true,
      transform: (record: string[], encoding, callback) => {
        try {
          this.processedCount++;

          // Handle headers
          if (isFirstRow && !this.options.skipHeader) {
            headers = record.map(h => h.toLowerCase().trim());
            isFirstRow = false;
            callback();
            return;
          }

          // Check max rows limit
          if (this.options.maxRows && this.validRecordCount >= this.options.maxRows) {
            callback();
            return;
          }

          // Parse record into customer data
          const customer = this.parseRecord(record, headers);
          
          if (customer) {
            this.validRecordCount++;
            callback(null, customer);
          } else {
            this.skippedCount++;
            callback();
          }
        } catch (error) {
          this.errorCount++;
          console.error(`Error parsing record ${this.processedCount}:`, error);
          callback();
        }
      }
    });

    const customers: CustomerData[] = [];

    try {
      await pipelineAsync(
        readStream,
        parser,
        transformStream,
        new Transform({
          objectMode: true,
          transform: (customer: CustomerData, encoding, callback) => {
            customers.push(customer);
            callback();
          }
        })
      );

      // Yield all collected customers
      for (const customer of customers) {
        yield customer;
      }
    } catch (error) {
      console.error('CSV parsing error:', error);
      throw error;
    }
  }

  /**
   * Parse CSV in batches for memory efficiency
   */
  async *parseInBatches(filePath: string, batchSize: number = 1000): AsyncGenerator<CustomerData[], void, unknown> {
    let batch: CustomerData[] = [];

    for await (const customer of this.parseCustomerData(filePath)) {
      batch.push(customer);

      if (batch.length >= batchSize) {
        yield [...batch];
        batch = [];
      }
    }

    // Yield remaining records
    if (batch.length > 0) {
      yield batch;
    }
  }

  /**
   * Parse a single record into CustomerData
   */
  private parseRecord(record: string[], headers: string[] | null): CustomerData | null {
    if (!record || record.length === 0) return null;

    // Map record based on headers or position
    const data: any = {};

    if (headers) {
      // Use headers to map fields
      headers.forEach((header, index) => {
        if (record[index] !== undefined) {
          data[header] = record[index]?.trim() || '';
        }
      });
    } else {
      // Use positional mapping (customize based on VinSolutions format)
      data.firstName = record[0]?.trim() || '';
      data.lastName = record[1]?.trim() || '';
      data.phone = record[2]?.trim() || '';
      data.email = record[3]?.trim() || '';
      data.customerId = record[4]?.trim() || '';
    }

    // Extract customer data with various field name possibilities
    const customer: CustomerData = {
      firstName: this.extractField(data, ['firstname', 'first_name', 'fname', 'first', 'customer_first_name']),
      lastName: this.extractField(data, ['lastname', 'last_name', 'lname', 'last', 'customer_last_name']),
      phone: this.extractPhone(data),
      email: this.extractField(data, ['email', 'email_address', 'customer_email', 'e-mail']),
      customerId: this.extractField(data, ['customer_id', 'customerid', 'id', 'account_number', 'account_id']),
      dealershipId: this.extractField(data, ['dealership_id', 'dealer_id', 'location_id', 'store_id']),
      source: this.extractField(data, ['source', 'lead_source', 'origin', 'channel']),
      status: this.extractField(data, ['status', 'customer_status', 'lead_status', 'active']),
    };

    // Extract last contact date
    const dateField = this.extractField(data, ['last_contact', 'last_contact_date', 'last_activity', 'modified_date']);
    if (dateField) {
      const parsedDate = this.parseDate(dateField);
      if (parsedDate) {
        customer.lastContactDate = parsedDate;
      }
    }

    // Extract tags
    const tagsField = this.extractField(data, ['tags', 'labels', 'categories']);
    if (tagsField) {
      customer.tags = tagsField.split(/[,;|]/).map(t => t.trim()).filter(t => t);
    }

    // Validate required fields
    if (!customer.phone || !PhoneNumberUtils.isValid(customer.phone)) {
      return null;
    }

    // Normalize phone number
    const normalizedPhone = PhoneNumberUtils.normalize(customer.phone);
    if (!normalizedPhone || PhoneNumberUtils.isPotentiallyInvalid(normalizedPhone)) {
      return null;
    }

    customer.phone = normalizedPhone;

    // Skip if no name data
    if (!customer.firstName && !customer.lastName) {
      return null;
    }

    // Store any additional metadata
    customer.metadata = {};
    for (const [key, value] of Object.entries(data)) {
      if (value && !this.isKnownField(key)) {
        customer.metadata[key] = value;
      }
    }

    return customer;
  }

  /**
   * Extract field value from data object with multiple possible field names
   */
  private extractField(data: any, possibleNames: string[]): string {
    for (const name of possibleNames) {
      if (data[name]) {
        return String(data[name]).trim();
      }
    }
    return '';
  }

  /**
   * Extract phone number from various possible fields
   */
  private extractPhone(data: any): string {
    const phoneFields = [
      'phone', 'phone_number', 'mobile', 'mobile_phone', 'cell', 'cell_phone',
      'primary_phone', 'home_phone', 'work_phone', 'contact_phone', 'telephone',
      'phone1', 'phone_1', 'customer_phone'
    ];

    // Try each phone field
    for (const field of phoneFields) {
      if (data[field]) {
        const phone = String(data[field]).trim();
        if (phone && PhoneNumberUtils.isValid(phone)) {
          return phone;
        }
      }
    }

    // Try to extract from combined fields
    const contactField = this.extractField(data, ['contact', 'contact_info', 'contact_details']);
    if (contactField) {
      const phones = PhoneNumberUtils.extractFromText(contactField);
      if (phones.length > 0) {
        return phones[0];
      }
    }

    return '';
  }

  /**
   * Parse date string into Date object
   */
  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }
    } catch {
      // Try other date formats
    }

    // Try common date formats
    const formats = [
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,  // MM/DD/YYYY
      /(\d{4})-(\d{2})-(\d{2})/,         // YYYY-MM-DD
      /(\d{1,2})-(\d{1,2})-(\d{4})/,     // MM-DD-YYYY
    ];

    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        try {
          let date: Date;
          if (format.source.includes('YYYY')) {
            date = new Date(`${match[1]}-${match[2]}-${match[3]}`);
          } else {
            date = new Date(`${match[3]}-${match[1]}-${match[2]}`);
          }
          if (!isNaN(date.getTime())) {
            return date;
          }
        } catch {
          continue;
        }
      }
    }

    return null;
  }

  /**
   * Check if field name is a known customer field
   */
  private isKnownField(fieldName: string): boolean {
    const knownFields = [
      'firstname', 'first_name', 'fname', 'first', 'customer_first_name',
      'lastname', 'last_name', 'lname', 'last', 'customer_last_name',
      'phone', 'phone_number', 'mobile', 'mobile_phone', 'cell', 'cell_phone',
      'email', 'email_address', 'customer_email', 'e-mail',
      'customer_id', 'customerid', 'id', 'account_number',
      'dealership_id', 'dealer_id', 'location_id',
      'source', 'lead_source', 'origin', 'channel',
      'status', 'customer_status', 'lead_status',
      'last_contact', 'last_contact_date', 'last_activity',
      'tags', 'labels', 'categories'
    ];

    return knownFields.includes(fieldName.toLowerCase());
  }

  /**
   * Get parsing statistics
   */
  getStats() {
    return {
      processed: this.processedCount,
      valid: this.validRecordCount,
      skipped: this.skippedCount,
      errors: this.errorCount
    };
  }
}