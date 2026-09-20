import type { Address } from 'viem';

export interface PaymentRequest {
  amount: string;
  symbol: string;
  chain?: string;
  chainId?: number;
  to: string;
  note?: string;
}

export interface SplitRequest {
  total: string;
  share: string;
  people: number;
  symbol: string;
  chainId: number;
  to: Address;
  note?: string;
}

export interface PaymentReceipt {
  hash: string;
  chain?: string;
  chainId?: number;
  amount: string;
  symbol: string;
  to: string;
}

export const CONTENT_TYPE_PAYMENT_REQUEST = 'eth.payment.request';
export const CONTENT_TYPE_PAYMENT_RECEIPT = 'eth.payment.receipt';
export const CONTENT_TYPE_PAYMENT_SPLIT = 'eth.payment.split';
