/**
 * PossibleNOW OAuth 2.0 Authentication
 * Handles token acquisition, refresh, and management
 */

import axios, { AxiosError } from 'axios';
import { OAuth2Token, PossibleNOWConfig, PossibleNOWAPIError } from './types';
import { logger } from '../../../priority5-compliance/logger';

export class OAuth2Client {
  private token: OAuth2Token | null = null;
  private tokenRefreshPromise: Promise<OAuth2Token> | null = null;

  constructor(private config: PossibleNOWConfig) {}

  /**
   * Gets a valid access token, refreshing if necessary
   */
  async getAccessToken(): Promise<string> {
    if (this.isTokenValid()) {
      return this.token!.access_token;
    }

    // If refresh is already in progress, wait for it
    if (this.tokenRefreshPromise) {
      await this.tokenRefreshPromise;
      return this.token!.access_token;
    }

    // Refresh the token
    await this.refreshToken();
    return this.token!.access_token;
  }

  /**
   * Authenticates and obtains initial token
   */
  async authenticate(): Promise<void> {
    try {
      logger.info('Authenticating with PossibleNOW API', {
        environment: this.config.environment
      });

      this.tokenRefreshPromise = this.requestToken();
      this.token = await this.tokenRefreshPromise;
      this.tokenRefreshPromise = null;

      logger.info('Successfully authenticated with PossibleNOW API', {
        expiresIn: this.token.expires_in
      });
    } catch (error) {
      this.tokenRefreshPromise = null;
      throw this.handleAuthError(error);
    }
  }

  /**
   * Refreshes the access token
   */
  private async refreshToken(): Promise<void> {
    try {
      logger.debug('Refreshing PossibleNOW access token');

      // If we have a refresh token, use it
      if (this.token?.refresh_token) {
        this.tokenRefreshPromise = this.requestTokenWithRefresh(this.token.refresh_token);
      } else {
        // Otherwise, get a new token with client credentials
        this.tokenRefreshPromise = this.requestToken();
      }

      this.token = await this.tokenRefreshPromise;
      this.tokenRefreshPromise = null;

      logger.debug('Successfully refreshed PossibleNOW access token');
    } catch (error) {
      this.tokenRefreshPromise = null;
      throw this.handleAuthError(error);
    }
  }

  /**
   * Requests a new token using client credentials
   */
  private async requestToken(): Promise<OAuth2Token> {
    const params = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.credentials.clientId,
      client_secret: this.config.credentials.clientSecret,
      scope: this.config.credentials.scope || 'dnc:read dnc:write'
    });

    const response = await axios.post(
      this.config.authUrl,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: this.config.timeout
      }
    );

    return {
      ...response.data,
      created_at: Date.now()
    };
  }

  /**
   * Requests a new token using refresh token
   */
  private async requestTokenWithRefresh(refreshToken: string): Promise<OAuth2Token> {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.credentials.clientId,
      client_secret: this.config.credentials.clientSecret
    });

    const response = await axios.post(
      this.config.authUrl,
      params.toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: this.config.timeout
      }
    );

    return {
      ...response.data,
      created_at: Date.now()
    };
  }

  /**
   * Checks if the current token is valid
   */
  private isTokenValid(): boolean {
    if (!this.token) {
      return false;
    }

    // Check if token has expired (with 5 minute buffer)
    const expiryTime = this.token.created_at + (this.token.expires_in * 1000) - 300000;
    return Date.now() < expiryTime;
  }

  /**
   * Handles authentication errors
   */
  private handleAuthError(error: any): Error {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      
      logger.error('OAuth authentication failed', {
        status: axiosError.response?.status,
        message: axiosError.message,
        data: axiosError.response?.data
      });

      if (axiosError.response?.status === 401) {
        return new PossibleNOWAPIError(
          'Invalid OAuth credentials',
          'AUTH_INVALID_CREDENTIALS',
          401,
          axiosError.response.data
        );
      }

      if (axiosError.response?.status === 400) {
        return new PossibleNOWAPIError(
          'Invalid OAuth request',
          'AUTH_INVALID_REQUEST',
          400,
          axiosError.response.data
        );
      }

      return new PossibleNOWAPIError(
        'OAuth authentication failed',
        'AUTH_FAILED',
        axiosError.response?.status,
        axiosError.response?.data
      );
    }

    logger.error('Unexpected authentication error', { error });
    return new PossibleNOWAPIError(
      'Unexpected authentication error',
      'AUTH_UNEXPECTED_ERROR',
      undefined,
      error
    );
  }

  /**
   * Clears the stored token
   */
  clearToken(): void {
    this.token = null;
    this.tokenRefreshPromise = null;
  }

  /**
   * Gets token expiry information
   */
  getTokenInfo(): {
    isValid: boolean;
    expiresAt?: Date;
    remainingTime?: number;
  } {
    if (!this.token) {
      return { isValid: false };
    }

    const expiresAt = new Date(this.token.created_at + (this.token.expires_in * 1000));
    const remainingTime = expiresAt.getTime() - Date.now();

    return {
      isValid: this.isTokenValid(),
      expiresAt,
      remainingTime: remainingTime > 0 ? remainingTime : 0
    };
  }
}