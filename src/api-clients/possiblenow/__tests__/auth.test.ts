/**
 * Unit tests for OAuth2Client
 */

import axios from 'axios';
import { OAuth2Client } from '../auth';
import { createConfig } from '../config';
import { OAuth2Token, PossibleNOWAPIError } from '../types';

jest.mock('axios');
jest.mock('../../../../priority5-compliance/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

describe('OAuth2Client', () => {
  let client: OAuth2Client;
  let mockAxios: jest.Mocked<typeof axios>;

  const testConfig = createConfig({
    environment: 'sandbox',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret'
  });

  const mockToken: OAuth2Token = {
    access_token: 'test-access-token',
    token_type: 'Bearer',
    expires_in: 3600,
    refresh_token: 'test-refresh-token',
    created_at: Date.now()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios = axios as jest.Mocked<typeof axios>;
    client = new OAuth2Client(testConfig);
  });

  describe('authenticate', () => {
    it('should successfully authenticate and store token', async () => {
      mockAxios.post.mockResolvedValueOnce({ data: mockToken });

      await client.authenticate();

      expect(mockAxios.post).toHaveBeenCalledWith(
        testConfig.authUrl,
        expect.stringContaining('grant_type=client_credentials'),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        })
      );
    });

    it('should handle authentication failure', async () => {
      mockAxios.post.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 401,
          data: { error: 'invalid_client' }
        }
      });

      await expect(client.authenticate()).rejects.toThrow(PossibleNOWAPIError);
    });

    it('should handle network errors', async () => {
      mockAxios.post.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.authenticate()).rejects.toThrow();
    });
  });

  describe('getAccessToken', () => {
    beforeEach(async () => {
      mockAxios.post.mockResolvedValueOnce({ data: mockToken });
      await client.authenticate();
    });

    it('should return valid token without refresh', async () => {
      const token = await client.getAccessToken();
      expect(token).toBe('test-access-token');
      expect(mockAxios.post).toHaveBeenCalledTimes(1); // Only initial auth
    });

    it('should refresh expired token', async () => {
      // Fast-forward time to expire the token
      jest.spyOn(Date, 'now').mockReturnValue(
        mockToken.created_at + (mockToken.expires_in * 1000) + 1000
      );

      const newToken = { ...mockToken, access_token: 'new-access-token' };
      mockAxios.post.mockResolvedValueOnce({ data: newToken });

      const token = await client.getAccessToken();
      
      expect(token).toBe('new-access-token');
      expect(mockAxios.post).toHaveBeenCalledTimes(2); // Initial + refresh
    });

    it('should use refresh token when available', async () => {
      // Expire the current token
      jest.spyOn(Date, 'now').mockReturnValue(
        mockToken.created_at + (mockToken.expires_in * 1000) + 1000
      );

      const newToken = { ...mockToken, access_token: 'refreshed-token' };
      mockAxios.post.mockResolvedValueOnce({ data: newToken });

      await client.getAccessToken();

      const lastCall = mockAxios.post.mock.calls[mockAxios.post.mock.calls.length - 1];
      expect(lastCall[1]).toContain('grant_type=refresh_token');
      expect(lastCall[1]).toContain(`refresh_token=${mockToken.refresh_token}`);
    });

    it('should handle concurrent token refresh requests', async () => {
      // Expire the token
      jest.spyOn(Date, 'now').mockReturnValue(
        mockToken.created_at + (mockToken.expires_in * 1000) + 1000
      );

      const newToken = { ...mockToken, access_token: 'new-token' };
      let resolveRefresh: (value: any) => void;
      const refreshPromise = new Promise(resolve => {
        resolveRefresh = resolve;
      });

      mockAxios.post.mockReturnValueOnce(refreshPromise as any);

      // Make multiple concurrent requests
      const requests = Promise.all([
        client.getAccessToken(),
        client.getAccessToken(),
        client.getAccessToken()
      ]);

      // Resolve the refresh
      resolveRefresh!({ data: newToken });

      const tokens = await requests;
      
      // All should get the same token
      expect(tokens).toEqual(['new-token', 'new-token', 'new-token']);
      
      // Only one refresh request should be made
      expect(mockAxios.post).toHaveBeenCalledTimes(2); // Initial + 1 refresh
    });
  });

  describe('clearToken', () => {
    it('should clear stored token', async () => {
      mockAxios.post.mockResolvedValueOnce({ data: mockToken });
      await client.authenticate();

      client.clearToken();

      // Should need to re-authenticate
      mockAxios.post.mockResolvedValueOnce({ data: mockToken });
      await client.getAccessToken();
      
      expect(mockAxios.post).toHaveBeenCalledTimes(2); // Initial + re-auth
    });
  });

  describe('getTokenInfo', () => {
    it('should return token information when valid', async () => {
      mockAxios.post.mockResolvedValueOnce({ data: mockToken });
      await client.authenticate();

      const info = client.getTokenInfo();
      
      expect(info.isValid).toBe(true);
      expect(info.expiresAt).toBeDefined();
      expect(info.remainingTime).toBeGreaterThan(0);
    });

    it('should return invalid when no token', () => {
      const info = client.getTokenInfo();
      
      expect(info.isValid).toBe(false);
      expect(info.expiresAt).toBeUndefined();
      expect(info.remainingTime).toBeUndefined();
    });

    it('should return invalid when token expired', async () => {
      mockAxios.post.mockResolvedValueOnce({ data: mockToken });
      await client.authenticate();

      // Fast-forward time to expire the token
      jest.spyOn(Date, 'now').mockReturnValue(
        mockToken.created_at + (mockToken.expires_in * 1000) + 1000
      );

      const info = client.getTokenInfo();
      
      expect(info.isValid).toBe(false);
      expect(info.remainingTime).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle 400 Bad Request', async () => {
      mockAxios.post.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 400,
          data: { error: 'invalid_request' }
        }
      });

      await expect(client.authenticate()).rejects.toThrow(
        expect.objectContaining({
          code: 'AUTH_INVALID_REQUEST',
          statusCode: 400
        })
      );
    });

    it('should handle 401 Unauthorized', async () => {
      mockAxios.post.mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 401,
          data: { error: 'invalid_client' }
        }
      });

      await expect(client.authenticate()).rejects.toThrow(
        expect.objectContaining({
          code: 'AUTH_INVALID_CREDENTIALS',
          statusCode: 401
        })
      );
    });

    it('should handle non-Axios errors', async () => {
      const error = new Error('Unexpected error');
      mockAxios.post.mockRejectedValueOnce(error);

      await expect(client.authenticate()).rejects.toThrow(
        expect.objectContaining({
          code: 'AUTH_UNEXPECTED_ERROR'
        })
      );
    });
  });
});