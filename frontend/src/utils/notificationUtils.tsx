import React from 'react';
import { Notification } from '@/hooks/useNotifications';

/**
 * Format time ago string
 */
export function formatTimeAgo(date: string | Date): string {
  const now = new Date();
  let notificationDate: Date;
  
  // Parse the date string properly, handling ISO format and timezone
  if (typeof date === 'string') {
    // If it's an ISO string, parse it directly
    // ISO strings are always in UTC, so this should work correctly
    notificationDate = new Date(date);
    
    // Check if the date is valid
    if (isNaN(notificationDate.getTime())) {
      console.warn('[formatTimeAgo] Invalid date string:', date);
      return 'just now';
    }
  } else if (date instanceof Date) {
    notificationDate = date;
  } else {
    console.warn('[formatTimeAgo] Invalid date type:', typeof date, date);
    return 'just now';
  }
  
  // Both dates are now in JavaScript Date objects (UTC internally)
  // Calculate difference in milliseconds (UTC timestamps)
  let diffInMs = now.getTime() - notificationDate.getTime();
  
  // Check if notification date is in the future (negative difference)
  // This can happen due to server clock being ahead or timezone issues
  if (diffInMs < 0) {
    const futureDiff = Math.abs(diffInMs);
    const futureMinutes = Math.floor(futureDiff / 60000);
    const futureHours = Math.floor(futureDiff / 3600000);
    
    // If it's less than 1 hour in the future, treat as "just now" (likely clock skew)
    if (futureDiff < 3600000) {
      console.log('[formatTimeAgo] Notification is in the future (clock skew), treating as just now:', {
        input: date,
        futureMinutes,
      });
      return 'just now';
    }
    
    // If it's more than 1 hour in the future, there's a serious time issue
    // Still show "just now" to avoid confusing users
    console.error('[formatTimeAgo] Notification is significantly in the future - server time issue:', {
      input: date,
      parsed: notificationDate.toISOString(),
      now: now.toISOString(),
      futureHours,
      futureMinutes,
    });
    return 'just now';
  }
  
  // Check if notification year is unreasonably in the future (more than 1 year ahead)
  // This would indicate a serious clock issue
  const notificationYear = notificationDate.getFullYear();
  const currentYear = now.getFullYear();
  if (notificationYear > currentYear + 1) {
    console.error('[formatTimeAgo] Notification year is unreasonably in the future:', {
      input: date,
      notificationYear,
      currentYear,
    });
    return 'just now';
  }
  
  // Debug logging for timezone issues (only log if difference is suspiciously large)
  if (Math.abs(diffInMs) > 1800000) { // More than 30 minutes difference
    console.log('[formatTimeAgo] Large time difference detected:', {
      input: date,
      parsed: notificationDate.toISOString(),
      now: now.toISOString(),
      diffMs: diffInMs,
      diffMinutes: Math.floor(diffInMs / 60000),
      diffHours: Math.floor(diffInMs / 3600000)
    });
  }
  
  const diffInSeconds = Math.floor(diffInMs / 1000);

  if (diffInSeconds < 60) {
    return 'just now';
  }

  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
  }

  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  }

  const diffInDays = Math.floor(diffInHours / 24);
  if (diffInDays < 7) {
    return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
  }

  const diffInWeeks = Math.floor(diffInDays / 7);
  if (diffInWeeks < 4) {
    return `${diffInWeeks} week${diffInWeeks > 1 ? 's' : ''} ago`;
  }

  const diffInMonths = Math.floor(diffInDays / 30);
  return `${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
}

/**
 * Get notification icon based on type
 */
export function getNotificationIcon(type: string): React.ReactElement {
  switch (type) {
    case 'trade_buy':
    case 'trade_sell':
      return (
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      );
    case 'order_filled':
      return (
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'order_partially_filled':
      return (
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case 'order_cancelled':
      return (
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      );
    case 'liquidation_warning':
    case 'liquidation':
      return (
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
    case 'position_closed':
      return (
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      );
    case 'market_resolved':
      return (
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
        </svg>
      );
    default:
      return (
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      );
  }
}

/**
 * Format notification message for display
 */
export function formatNotificationMessage(notification: Notification): string {
  const { type, message, data } = notification;

  // Helper to get outcome type
  const getOutcomeType = (outcomeId?: number): string => {
    return outcomeId !== undefined ? `Outcome ${outcomeId}` : '';
  };

  // Helper to format with market name
  const formatWithMarket = (baseMessage: string, marketTitle?: string): string => {
    if (marketTitle) {
      return `${baseMessage} on "${marketTitle}"`;
    }
    return baseMessage;
  };

  // If message is already well-formatted from backend, use it
  if (message && message.includes('YES') || message.includes('NO') || message.includes('shares')) {
    return message;
  }

  // Helper to get token type label
  const getTokenLabel = (tokenType?: string): string => {
    if (!tokenType) return '';
    return ` ${tokenType.toUpperCase()}`;
  };

  // Format based on type and data
  switch (type) {
    case 'trade_buy':
      if (data?.marketId && data?.price && data?.size) {
        const priceCents = Math.round(data.price / 100);
        const outcome = getOutcomeType(data.outcomeId);
        const tokenLabel = getTokenLabel(data.tokenType);
        const baseMessage = `Your buy order for ${formatNumber(data.size)}${tokenLabel} ${outcome} shares has been executed at ${priceCents}¢`;
        return formatWithMarket(baseMessage, data.marketTitle);
      }
      return message || 'Your buy order was executed';

    case 'trade_sell':
      if (data?.marketId && data?.price && data?.size) {
        const priceCents = Math.round(data.price / 100);
        const outcome = getOutcomeType(data.outcomeId);
        const tokenLabel = getTokenLabel(data.tokenType);
        const baseMessage = `Your sell order for ${formatNumber(data.size)}${tokenLabel} ${outcome} shares has been executed at ${priceCents}¢`;
        return formatWithMarket(baseMessage, data.marketTitle);
      }
      return message || 'Your sell order was executed';

    case 'order_filled':
      if (data?.side && data?.price && data?.size) {
        const priceCents = Math.round(data.price / 100);
        const side = data.side === 'buy' ? 'buy' : 'sell';
        const outcome = getOutcomeType(data.outcomeId);
        const tokenLabel = getTokenLabel(data.tokenType);
        const baseMessage = `Your ${side} order for ${formatNumber(data.size)}${tokenLabel} ${outcome} shares has been filled at ${priceCents}¢`;
        return formatWithMarket(baseMessage, data.marketTitle);
      }
      return message || 'Your order was filled';

    case 'order_partially_filled':
      if (data?.side && data?.price && data?.filledSize && data?.totalSize) {
        const priceCents = Math.round(data.price / 100);
        const fillPercentage = ((data.filledSize / data.totalSize) * 100).toFixed(1);
        const side = data.side === 'buy' ? 'buy' : 'sell';
        const outcome = getOutcomeType(data.outcomeId);
        const tokenLabel = getTokenLabel(data.tokenType);
        const baseMessage = `Your ${side} order for ${formatNumber(data.totalSize)}${tokenLabel} ${outcome} shares was ${fillPercentage}% filled (${formatNumber(data.filledSize)}/${formatNumber(data.totalSize)}) at ${priceCents}¢`;
        return formatWithMarket(baseMessage, data.marketTitle);
      }
      return message || 'Your order was partially filled';

    default:
      return message || 'New notification';
  }
}

/**
 * Format share amounts - converts lamports (raw) to real share count (÷ 1e6)
 */
function formatNumber(num: number | string): string {
  const raw = typeof num === 'string' ? parseFloat(num) : num;
  // Convert from lamports to actual shares (USDC has 6 decimals)
  const shares = raw / 1e6;
  if (shares >= 1000000) {
    return (shares / 1000000).toFixed(1) + 'M';
  }
  if (shares >= 1000) {
    return (shares / 1000).toFixed(1) + 'K';
  }
  return shares.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

