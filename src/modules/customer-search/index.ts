export * from './types';
export * from './CustomerSearchService';
export * from './CustomerNavigationService';
export * from './DNCStatusService';

import { CustomerSearchService } from './CustomerSearchService';
import { CustomerNavigationService } from './CustomerNavigationService';
import { DNCStatusService } from './DNCStatusService';
import { Logger } from '../../../priority5-compliance/logger';

/**
 * Factory function to create all customer search services
 */
export function createCustomerSearchModule(logger: Logger) {
  return {
    searchService: new CustomerSearchService(logger),
    navigationService: new CustomerNavigationService(logger),
    dncStatusService: new DNCStatusService(logger)
  };
}