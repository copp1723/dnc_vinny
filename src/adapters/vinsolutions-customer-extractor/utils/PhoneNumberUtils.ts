export class PhoneNumberUtils {
  // Common US phone number patterns
  private static readonly PHONE_PATTERNS = [
    /^\+?1?[\s.-]?\(?(\d{3})\)?[\s.-]?(\d{3})[\s.-]?(\d{4})$/,  // Various US formats
    /^(\d{3})[\s.-]?(\d{3})[\s.-]?(\d{4})$/,                      // 10 digits
    /^\+?1?(\d{10})$/,                                             // 10 or 11 digits no formatting
  ];

  /**
   * Normalize a phone number to E.164 format (+1XXXXXXXXXX)
   */
  static normalize(phone: string): string | null {
    if (!phone) return null;

    // Remove all non-numeric characters except + at the beginning
    let cleaned = phone.replace(/[^\d+]/g, '');
    
    // Handle + at beginning
    if (cleaned.startsWith('+')) {
      cleaned = '+' + cleaned.substring(1).replace(/\+/g, '');
    } else {
      cleaned = cleaned.replace(/\+/g, '');
    }

    // If it's a 10-digit number, add US country code
    if (cleaned.length === 10) {
      cleaned = '1' + cleaned;
    }

    // If it's an 11-digit number starting with 1, it's likely US
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      // Valid US number
    } else if (cleaned.length !== 11) {
      // Invalid length for US number
      return null;
    }

    // Validate area code (first 3 digits after country code)
    const areaCode = cleaned.substring(1, 4);
    if (areaCode.startsWith('0') || areaCode.startsWith('1')) {
      return null; // Invalid US area code
    }

    // Format as E.164
    return '+' + cleaned;
  }

  /**
   * Validate if a phone number is valid
   */
  static isValid(phone: string): boolean {
    const normalized = this.normalize(phone);
    return normalized !== null;
  }

  /**
   * Format phone number for display
   */
  static formatForDisplay(phone: string): string {
    const normalized = this.normalize(phone);
    if (!normalized) return phone;

    // Remove + and country code for US numbers
    const digits = normalized.substring(2);
    
    // Format as (XXX) XXX-XXXX
    return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
  }

  /**
   * Extract all phone numbers from text
   */
  static extractFromText(text: string): string[] {
    if (!text) return [];

    const phones: string[] = [];
    
    // Split by common delimiters
    const tokens = text.split(/[\s,;|\/\\]+/);
    
    for (const token of tokens) {
      // Check each token against phone patterns
      for (const pattern of this.PHONE_PATTERNS) {
        if (pattern.test(token)) {
          const normalized = this.normalize(token);
          if (normalized) {
            phones.push(normalized);
          }
          break;
        }
      }
    }

    // Remove duplicates
    return [...new Set(phones)];
  }

  /**
   * Check if phone number is potentially invalid (common test numbers, etc.)
   */
  static isPotentiallyInvalid(phone: string): boolean {
    const normalized = this.normalize(phone);
    if (!normalized) return true;

    // Common test/invalid patterns
    const invalidPatterns = [
      /^\+1[0-9]{3}0{7}$/,      // XXX-000-0000
      /^\+1[0-9]{3}1234567$/,   // XXX-123-4567
      /^\+1[0-9]{3}1111111$/,   // XXX-111-1111
      /^\+1[0-9]{3}9999999$/,   // XXX-999-9999
      /^\+1555[0-9]{7}$/,       // 555 numbers (except 555-01XX)
    ];

    for (const pattern of invalidPatterns) {
      if (pattern.test(normalized)) {
        // Check for valid 555-01XX information numbers
        if (normalized.startsWith('+1555') && normalized.substring(5, 7) === '01') {
          return false;
        }
        return true;
      }
    }

    // Check for repeated digits
    const digits = normalized.substring(2); // Remove +1
    const uniqueDigits = new Set(digits.split('')).size;
    if (uniqueDigits <= 2) {
      return true; // Too many repeated digits
    }

    return false;
  }

  /**
   * Compare two phone numbers to see if they match
   */
  static matches(phone1: string, phone2: string): boolean {
    const normalized1 = this.normalize(phone1);
    const normalized2 = this.normalize(phone2);
    
    return normalized1 !== null && normalized2 !== null && normalized1 === normalized2;
  }

  /**
   * Remove country code from normalized number
   */
  static removeCountryCode(phone: string): string {
    const normalized = this.normalize(phone);
    if (!normalized) return phone;
    
    // Remove +1 for US numbers
    return normalized.substring(2);
  }
}