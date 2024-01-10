import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { DamonJsPlugin, SpotifyOptions } from './Plugin';
import { DamonJsError } from 'damonjs';
const BASE_URL = 'https://api.spotify.com/v1';

export class SpotifyRequest {
  private token: string = '';
  private authorization: string = '';
  private nextRenew: number = 0;
  private axios = axios;
  public stats: { requests: number; rateLimited: boolean } = { requests: 0, rateLimited: false };

  constructor(private client: { clientId: string; clientSecret: string }) {
    this.authorization = `Basic ${Buffer.from(`${this.client.clientId}:${this.client.clientSecret}`).toString(
      'base64',
    )}`;
  }

  public async makeRequest<T>(endpoint: string, disableBaseUri: boolean = false): Promise<T> {
    await this.renew();

    const requestConfig: AxiosRequestConfig = {
      headers: { Authorization: this.token },
      url: disableBaseUri ? endpoint : `${BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`,
      method: 'GET',
    };

    try {
      const response = await this.axios.request(requestConfig);
      const data = response.data as T;
      this.stats.requests++;
      return data;
    } catch (error: AxiosError | any) {
      if (
        error instanceof AxiosError &&
        error?.response?.headers &&
        error.response.headers['x-ratelimit-remaining'] === '0'
      ) {
        const resetTime = Number(error.response.headers['x-ratelimit-reset']) * 1000;
        this.handleRateLimited(resetTime);
        throw new DamonJsError(2, 'Rate limited by spotify');
      } else {
        throw error;
      }
    }
  }

  private handleRateLimited(time: number): void {
    this.stats.rateLimited = true;
    setTimeout(() => {
      this.stats.rateLimited = false;
    }, time);
  }

  private async renewToken(): Promise<void> {
    const requestData = new URLSearchParams();
    requestData.append('grant_type', 'client_credentials');

    const config = {
      headers: {
        Authorization: this.authorization,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };

    let res;
    try {
      res = await this.axios.post('https://accounts.spotify.com/api/token', requestData, config);
    } catch (error) {
      throw new DamonJsError(3, 'Failed to get access token due to invalid spotify client');
    }

    const { access_token, expires_in } = res.data as { access_token?: string; expires_in: number };

    if (!access_token) {
      throw new DamonJsError(3, 'Failed to get access token due to invalid spotify client');
    }

    this.token = `Bearer ${access_token}`;
    this.nextRenew = Date.now() + expires_in * 1000;
  }

  private async renew(): Promise<void> {
    if (Date.now() >= this.nextRenew) {
      await this.renewToken();
    }
  }
}
